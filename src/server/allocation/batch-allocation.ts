import { createHash } from "node:crypto";
import { Prisma, type User } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { writeAudit } from "@/server/audit";
import { HttpError } from "@/server/http";
import { queueNotification } from "@/server/notifications/queue";
import { getSettings } from "@/server/settings";
import { AllocationError, allocateShipping, type AllocationResult } from "./allocate";

const SHIPPING_INVOICE_DUE_DAYS = 7;

type Client = Prisma.TransactionClient | typeof db;

const ordersInclude = {
  user: { select: { id: true, name: true, phone: true } },
  items: {
    orderBy: { createdAt: "asc" },
    include: { product: { select: { title: true } }, variant: { select: { label: true } }, measurement: true },
  },
} satisfies Prisma.OrderInclude;

type LoadedOrder = Prisma.OrderGetPayload<{ include: typeof ordersInclude }>;

async function loadBatch(client: Client, batchId: string) {
  const batch = await client.batch.findUnique({ where: { id: batchId } });
  if (!batch) throw new HttpError(404, "batch_not_found", "Batch not found.");
  const [orders, settings] = await Promise.all([
    client.order.findMany({ where: { batchId, status: { not: "cancelled" } }, include: ordersInclude, orderBy: { orderNumber: "asc" } }),
    getSettings(client),
  ]);
  return { batch, orders, settings };
}

function compute(batch: { shippingQuote: Prisma.Decimal | null; allocationMethod: AllocationResult["method"] | null }, orders: LoadedOrder[], divisor: number) {
  return allocateShipping({
    quote: batch.shippingQuote,
    method: batch.allocationMethod,
    volumetricDivisor: divisor,
    orders: orders.map((o) => ({
      orderId: o.id,
      items: o.items.map((i) => ({
        orderItemId: i.id,
        quantity: i.quantity,
        measurement: i.measurement && {
          weightG: i.measurement.weightG,
          lengthMm: i.measurement.lengthMm,
          widthMm: i.measurement.widthMm,
          heightMm: i.measurement.heightMm,
        },
      })),
    })),
  });
}

/** Identifies exactly what ops saw, so approval fails if anything changed after the preview. */
export function allocationFingerprint(result: AllocationResult): string {
  const material = JSON.stringify([
    result.version,
    result.method,
    result.quote,
    result.volumetricDivisor,
    result.orders.map((o) => [o.orderId, o.chargeableWeightG, o.allocatedAmount]),
  ]);
  return createHash("sha256").update(material).digest("hex").slice(0, 32);
}

export type PreviewRow = {
  orderId: string;
  orderNumber: string;
  customer: string;
  units: number;
  chargeableWeightG: number;
  productTotal: string;
  shippingShare: string;
  grandTotal: string;
  residualApplied: string | null;
};

function previewRows(orders: LoadedOrder[], result: AllocationResult): PreviewRow[] {
  return result.orders.map((line) => {
    const order = orders.find((o) => o.id === line.orderId)!;
    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      customer: order.user.name ?? order.user.phone ?? "Customer",
      units: line.units,
      chargeableWeightG: line.chargeableWeightG,
      productTotal: order.productTotal.toFixed(2),
      shippingShare: line.allocatedAmount,
      grandTotal: order.productTotal.add(line.allocatedAmount).toFixed(2),
      residualApplied: line.residualApplied,
    };
  });
}

/** Never persisted. Returns either the computed split or the reason it can't be computed yet. */
export async function previewAllocation(batchId: string) {
  const { batch, orders, settings } = await loadBatch(db, batchId);
  const approved = await db.shippingAllocation.count({ where: { batchId, approvedAt: { not: null } } });
  try {
    const result = compute(batch, orders, settings.volumetricDivisor);
    const allocated = result.orders.reduce((sum, o) => sum.add(o.allocatedAmount), new Prisma.Decimal(0));
    return {
      batch,
      approved: approved > 0,
      result,
      rows: previewRows(orders, result),
      allocatedTotal: allocated.toFixed(2),
      fingerprint: allocationFingerprint(result),
      error: null,
    };
  } catch (err) {
    if (!(err instanceof AllocationError)) throw err;
    return { batch, approved: approved > 0, result: null, rows: [], allocatedTotal: null, fingerprint: null, error: { code: err.code, message: err.message, details: err.details } };
  }
}

function invoiceBreakdown(batch: { id: string; name: string; defaultShipMethod: string }, order: LoadedOrder, result: AllocationResult) {
  const line = result.orders.find((o) => o.orderId === order.id)!;
  const shareBasis =
    result.method === "quantity"
      ? `${result.quote} × ${line.units} units ÷ ${result.totalUnits} units`
      : result.method === "equal"
        ? `${result.quote} ÷ ${result.orderCount} orders`
        : `${result.quote} × ${line.chargeableWeightG} g ÷ ${result.totalChargeableWeightG} g`;

  return {
    kind: "shipping",
    algorithmVersion: result.version,
    batch: { id: batch.id, name: batch.name },
    shipMethod: batch.defaultShipMethod,
    method: result.method,
    batchQuote: result.quote,
    volumetricDivisor: result.volumetricDivisor,
    totalBatchWeightG: result.totalChargeableWeightG,
    totalUnits: result.totalUnits,
    orderCount: result.orderCount,
    order: { units: line.units, actualWeightG: line.actualWeightG, chargeableWeightG: line.chargeableWeightG },
    items: line.items.map((item) => {
      const source = order.items.find((i) => i.id === item.orderItemId)!;
      return {
        title: source.product.title,
        variant: source.variant.label,
        quantity: item.quantity,
        weightG: item.weightG,
        volumetricG: item.volumetricG,
        chargeableG: item.chargeableG,
        lineChargeableG: item.lineChargeableG,
      };
    }),
    formula: shareBasis,
    exactShare: line.exactAmount,
    residualApplied: line.residualApplied,
    amount: line.allocatedAmount,
  };
}

/**
 * Hard rule 5, in one transaction: lock the batch, refuse a second approval (409),
 * recompute, check it matches the preview, then write allocations, invoices,
 * order totals, notifications and the audit entry.
 */
export async function approveAllocation(batchId: string, actor: Pick<User, "id">, expectedFingerprint: string) {
  return db.$transaction(
    async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM batches WHERE id = ${batchId}::uuid FOR UPDATE`;
      if (locked.length === 0) throw new HttpError(404, "batch_not_found", "Batch not found.");

      if ((await tx.shippingAllocation.count({ where: { batchId } })) > 0) {
        throw new HttpError(409, "already_approved", "Shipping for this batch has already been approved. Invoices were not sent again.");
      }

      const { batch, orders, settings } = await loadBatch(tx, batchId);
      if (batch.status !== "measured") {
        throw new HttpError(409, "batch_not_measured", "Mark the batch as measured before approving the shipping split.");
      }

      let result: AllocationResult;
      try {
        result = compute(batch, orders, settings.volumetricDivisor);
      } catch (err) {
        if (err instanceof AllocationError) throw new HttpError(422, err.code, err.message, err.details);
        throw err;
      }
      if (allocationFingerprint(result) !== expectedFingerprint) {
        throw new HttpError(409, "preview_stale", "The quote or measurements changed after this preview. Reload and check the new split before approving.");
      }

      const now = new Date();
      const dueAt = new Date(now.getTime() + SHIPPING_INVOICE_DUE_DAYS * 86_400_000);
      const quote = new Prisma.Decimal(result.quote);

      await tx.shippingAllocation.createMany({
        data: result.orders.map((line) => ({
          batchId,
          orderId: line.orderId,
          method: result.method,
          shippingQuote: quote,
          totalBatchWeightG: result.totalChargeableWeightG,
          orderWeightG: line.chargeableWeightG,
          allocatedAmount: new Prisma.Decimal(line.allocatedAmount),
          calculatedAt: now,
          approvedById: actor.id,
          approvedAt: now,
        })),
      });

      for (const order of orders) {
        const line = result.orders.find((o) => o.orderId === order.id)!;
        const amount = new Prisma.Decimal(line.allocatedAmount);
        const free = amount.isZero();

        const invoice = await tx.invoice.create({
          data: {
            orderId: order.id,
            kind: "shipping",
            version: 1,
            amount,
            currency: settings.currency,
            breakdown: invoiceBreakdown(batch, order, result),
            status: free ? "paid" : "issued",
            issuedAt: now,
            dueAt,
            paidAt: free ? now : null,
          },
        });
        await tx.order.update({ where: { id: order.id }, data: { shippingTotal: amount, status: free ? "shipping_paid" : "invoiced" } });

        if (!free) {
          await queueNotification(tx, {
            userId: order.user.id,
            template: "shipping_invoice_ready",
            vars: {
              name: order.user.name ?? "there",
              orderNumber: order.orderNumber,
              amount: formatMoney(amount, settings.currency),
              shipMethod: batch.defaultShipMethod,
              dueDate: formatDate(dueAt),
              invoiceUrl: new URL(`/invoices/${invoice.id}`, env().APP_URL).toString(),
            },
            link: `/invoices/${invoice.id}`,
          });
        }
      }

      await tx.batch.update({ where: { id: batchId }, data: { status: "invoiced" } });
      await writeAudit(tx, {
        actorId: actor.id,
        action: "allocation.approved",
        entityType: "batch",
        entityId: batchId,
        before: { status: "measured" },
        after: {
          status: "invoiced",
          algorithmVersion: result.version,
          method: result.method,
          quote: result.quote,
          volumetricDivisor: result.volumetricDivisor,
          totalChargeableWeightG: result.totalChargeableWeightG,
          orders: result.orderCount,
          fingerprint: expectedFingerprint,
        },
      });

      return { result, invoices: orders.length };
    },
    { timeout: 30_000 },
  );
}
