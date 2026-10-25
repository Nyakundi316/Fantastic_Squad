import { Prisma, type User } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { formatDate } from "@/lib/dates";
import { isStaff } from "@/lib/auth/roles";
import { formatMoney } from "@/lib/money";
import { allocateShipping, type AllocationMethod } from "@/server/allocation/allocate";
import { writeAudit } from "@/server/audit";
import { HttpError } from "@/server/http";
import { queueNotification } from "@/server/notifications/queue";

const invoiceInclude = {
  order: {
    select: {
      id: true,
      orderNumber: true,
      userId: true,
      status: true,
      shipMethod: true,
      user: { select: { name: true, phone: true, email: true } },
      shipAddress: true,
      batch: { select: { name: true, status: true } },
    },
  },
  payments: { orderBy: { createdAt: "desc" } },
  supersedes: { select: { id: true, version: true, amount: true } },
} satisfies Prisma.InvoiceInclude;

export type InvoiceRecord = Prisma.InvoiceGetPayload<{ include: typeof invoiceInclude }>;

export async function getInvoiceForViewer(id: string, viewer: Pick<User, "id" | "role">): Promise<InvoiceRecord | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const invoice = await db.invoice.findUnique({ where: { id }, include: invoiceInclude });
  if (!invoice) return null;
  if (invoice.order.userId !== viewer.id && !isStaff(viewer.role)) return null;
  return invoice;
}

type ShippingBreakdown = {
  kind: "shipping";
  method: AllocationMethod;
  shipMethod: string;
  batch: { name: string };
  batchQuote: string;
  volumetricDivisor: number | null;
  totalBatchWeightG: number;
  totalUnits: number;
  orderCount: number;
  order: { units: number; actualWeightG: number; chargeableWeightG: number };
  items: Array<{ title: string; variant: string; quantity: number; weightG: number; volumetricG: number | null; chargeableG: number; lineChargeableG: number }>;
  formula: string;
  exactShare: string;
  residualApplied: string | null;
  amount: string;
  adjustment?: { previousVersion: number; previousAmount: string; reason: string };
};

type ProductBreakdown = {
  kind: "product";
  lines: Array<{ title: string; variant: string; quantity: number; unitPrice: string; lineTotal: string }>;
  total: string;
  note: string;
  adjustment?: { previousVersion: number; previousAmount: string; reason: string };
};

export type ShippingItemRow = ShippingBreakdown["items"][number] & { weightSharePercent: string; cost: string };

/**
 * Splits the invoice amount across the order's items for display, with the same
 * algorithm and rounding as the batch split, so the item costs add up to the invoice exactly.
 */
function itemCosts(b: ShippingBreakdown, amount: Prisma.Decimal): ShippingItemRow[] {
  const byWeight = b.method === "weight" || b.method === "volumetric";
  const share = (g: number) => (b.order.chargeableWeightG > 0 ? new Prisma.Decimal(g).div(b.order.chargeableWeightG).mul(100).toFixed(1) : "0.0");

  if (amount.isZero() || (byWeight && b.order.chargeableWeightG === 0)) {
    return b.items.map((i) => ({ ...i, weightSharePercent: share(i.lineChargeableG), cost: "0.00" }));
  }
  const split = allocateShipping({
    quote: amount,
    method: byWeight ? "weight" : "quantity",
    volumetricDivisor: 1,
    orders: b.items.map((item, idx) => ({
      orderId: String(idx),
      items: [{ orderItemId: String(idx), quantity: byWeight ? 1 : item.quantity, measurement: { weightG: item.lineChargeableG, lengthMm: null, widthMm: null, heightMm: null } }],
    })),
  });
  return b.items.map((item, idx) => ({ ...item, weightSharePercent: share(item.lineChargeableG), cost: split.orders[idx]!.allocatedAmount }));
}

export function invoiceView(invoice: InvoiceRecord) {
  const breakdown = invoice.breakdown as unknown as ShippingBreakdown | ProductBreakdown;
  const base = {
    id: invoice.id,
    kind: invoice.kind,
    version: invoice.version,
    status: invoice.status,
    amount: invoice.amount.toFixed(2),
    currency: invoice.currency,
    issuedAt: invoice.issuedAt,
    dueAt: invoice.dueAt,
    paidAt: invoice.paidAt,
    order: invoice.order,
    supersedes: invoice.supersedes,
    adjustment: breakdown.adjustment ?? null,
    pendingCardPayment: invoice.payments.find((p) => p.status === "pending" && p.provider === "paystack") ?? null,
  };
  if (breakdown.kind === "shipping") {
    return { ...base, kind: "shipping" as const, shipping: breakdown, items: itemCosts(breakdown, invoice.amount) };
  }
  return { ...base, kind: "product" as const, product: breakdown };
}

export type InvoiceView = ReturnType<typeof invoiceView>;

/**
 * Hard rule 3: an issued invoice is never edited. An adjustment is a new row
 * (version + 1, supersedes_id = old.id) and the old one becomes "adjusted".
 */
export async function adjustInvoice(invoiceId: string, input: { amount: string; reason: string }, actor: Pick<User, "id">) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${invoiceId}::uuid FOR UPDATE`;
    const old = await tx.invoice.findUnique({ where: { id: invoiceId }, include: { order: { include: { user: { select: { id: true, name: true } }, batch: true } } } });
    if (!old) throw new HttpError(404, "invoice_not_found", "Invoice not found.");
    if (old.status !== "issued") throw new HttpError(409, "invoice_not_adjustable", "Only unpaid invoices can be adjusted. Paid invoices need a refund.");

    const amount = new Prisma.Decimal(input.amount);
    if (amount.eq(old.amount)) throw new HttpError(422, "validation_failed", "The new amount is the same as the current one.");

    const previous = old.breakdown as Prisma.JsonObject;
    const next = await tx.invoice.create({
      data: {
        orderId: old.orderId,
        kind: old.kind,
        version: old.version + 1,
        amount,
        currency: old.currency,
        breakdown: {
          ...previous,
          amount: amount.toFixed(2),
          ...(old.kind === "product" ? { total: amount.toFixed(2) } : {}),
          adjustment: { previousInvoiceId: old.id, previousVersion: old.version, previousAmount: old.amount.toFixed(2), reason: input.reason, adjustedBy: actor.id },
        },
        status: "issued",
        dueAt: old.dueAt,
        supersedesId: old.id,
      },
    });
    await tx.invoice.update({ where: { id: old.id }, data: { status: "adjusted" } });
    await tx.order.update({
      where: { id: old.orderId },
      data: old.kind === "shipping" ? { shippingTotal: amount } : { productTotal: amount },
    });

    if (old.kind === "shipping") {
      await queueNotification(tx, {
        userId: old.order.user.id,
        template: "shipping_invoice_ready",
        vars: {
          name: old.order.user.name ?? "there",
          orderNumber: old.order.orderNumber,
          amount: formatMoney(amount, old.currency),
          shipMethod: old.order.shipMethod,
          dueDate: next.dueAt ? formatDate(next.dueAt) : "on receipt",
          invoiceUrl: new URL(`/invoices/${next.id}`, env().APP_URL).toString(),
        },
        link: `/invoices/${next.id}`,
      });
    }
    await writeAudit(tx, {
      actorId: actor.id,
      action: "invoice.adjusted",
      entityType: "invoice",
      entityId: next.id,
      before: { invoiceId: old.id, version: old.version, amount: old.amount.toFixed(2) },
      after: { invoiceId: next.id, version: next.version, amount: amount.toFixed(2), reason: input.reason },
    });
    return next;
  });
}

/** Re-sends the "shipping invoice ready" message for unpaid shipping invoices. */
export async function resendInvoices(invoiceIds: string[], actor: Pick<User, "id">) {
  return db.$transaction(async (tx) => {
    const invoices = await tx.invoice.findMany({
      where: { id: { in: invoiceIds } },
      include: { order: { include: { user: { select: { id: true, name: true } } } } },
    });
    let sent = 0;
    for (const invoice of invoices) {
      if (invoice.kind !== "shipping" || invoice.status !== "issued") continue;
      await queueNotification(tx, {
        userId: invoice.order.user.id,
        template: "shipping_invoice_ready",
        vars: {
          name: invoice.order.user.name ?? "there",
          orderNumber: invoice.order.orderNumber,
          amount: formatMoney(invoice.amount, invoice.currency),
          shipMethod: invoice.order.shipMethod,
          dueDate: invoice.dueAt ? formatDate(invoice.dueAt) : "on receipt",
          invoiceUrl: new URL(`/invoices/${invoice.id}`, env().APP_URL).toString(),
        },
        link: `/invoices/${invoice.id}`,
      });
      await writeAudit(tx, { actorId: actor.id, action: "invoice.resent", entityType: "invoice", entityId: invoice.id, after: { orderNumber: invoice.order.orderNumber } });
      sent += 1;
    }
    return { sent, skipped: invoiceIds.length - sent };
  });
}
