import type { BatchStatus, Prisma, User } from "@prisma/client";
import { db } from "@/lib/db";
import { BATCH_STATUS, canTransition } from "@/lib/batch-status";
import { writeAudit } from "@/server/audit";
import { HttpError } from "@/server/http";
import { queueNotification } from "@/server/notifications/queue";

async function lockBatch(tx: Prisma.TransactionClient, batchId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM batches WHERE id = ${batchId}::uuid FOR UPDATE`;
  if (rows.length === 0) throw new HttpError(404, "batch_not_found", "Batch not found.");
  return tx.batch.findUniqueOrThrow({ where: { id: batchId } });
}

/**
 * Manual batch transitions. The row lock also blocks new orders joining the batch
 * (order placement takes FOR SHARE on the same row).
 */
export async function transitionBatch(batchId: string, to: BatchStatus, actor: Pick<User, "id">) {
  return db.$transaction(async (tx) => {
    const batch = await lockBatch(tx, batchId);
    if (!canTransition(batch.status, to)) {
      throw new HttpError(409, "invalid_transition", `A batch can't move from ${BATCH_STATUS[batch.status].label} to ${BATCH_STATUS[to].label}.`);
    }

    const orders = await tx.order.findMany({
      where: { batchId, status: { not: "cancelled" } },
      include: { user: { select: { id: true, name: true } }, invoices: true, items: { include: { measurement: true } } },
    });

    const summary: Record<string, unknown> = {};

    if (to === "ordered" || to === "cancelled") {
      const isPaid = (o: (typeof orders)[number]) => o.invoices.some((i) => i.kind === "product" && i.status === "paid");
      const paid = orders.filter(isPaid);
      const unpaid = orders.filter((o) => !isPaid(o));

      if (to === "cancelled" && paid.length > 0) {
        throw new HttpError(409, "batch_has_paid_orders", `${paid.length} orders are paid. Refund or move them before cancelling the batch.`);
      }

      for (const order of unpaid) {
        await tx.order.update({ where: { id: order.id }, data: { status: "cancelled" } });
        await tx.invoice.updateMany({ where: { orderId: order.id, kind: "product", status: "issued" }, data: { status: "voided" } });
        await writeAudit(tx, {
          actorId: actor.id,
          action: "order.cancelled_unpaid",
          entityType: "order",
          entityId: order.id,
          before: { status: order.status },
          after: { status: "cancelled", reason: `Product price unpaid when ${batch.name} closed` },
        });
      }

      if (to === "ordered") {
        for (const order of paid) {
          await tx.order.update({ where: { id: order.id }, data: { status: "batch_confirmed" } });
          await queueNotification(tx, {
            userId: order.user.id,
            template: "batch_closed",
            vars: { name: order.user.name ?? "there", batchName: batch.name, orderNumber: order.orderNumber },
            link: `/orders/${order.id}`,
          });
        }
      }
      summary.confirmed = paid.map((o) => o.orderNumber);
      summary.cancelled = unpaid.map((o) => o.orderNumber);
    }

    if (to === "measured") {
      const unmeasured = orders.flatMap((o) => o.items).filter((i) => !i.measurement).length;
      if (unmeasured > 0) {
        throw new HttpError(409, "measurements_missing", `${unmeasured} ${unmeasured === 1 ? "item still needs" : "items still need"} a measurement.`, { unmeasured });
      }
      await tx.order.updateMany({ where: { batchId, status: "batch_confirmed" }, data: { status: "measured" } });
    }

    const updated = await tx.batch.update({ where: { id: batchId }, data: { status: to } });
    await writeAudit(tx, {
      actorId: actor.id,
      action: "batch.status_changed",
      entityType: "batch",
      entityId: batchId,
      before: { status: batch.status },
      after: { status: to, ...summary } as Prisma.InputJsonObject,
    });
    return { batch: updated, summary };
  });
}

type BatchSettings = { shippingQuote?: Prisma.Decimal; allocationMethod?: "weight" | "volumetric" | "quantity" | "equal" };

/** Quote and allocation method can change until the allocation is approved. */
export async function updateBatchSettings(batchId: string, changes: BatchSettings, actor: Pick<User, "id">) {
  return db.$transaction(async (tx) => {
    const batch = await lockBatch(tx, batchId);
    const approved = await tx.shippingAllocation.count({ where: { batchId, approvedAt: { not: null } } });
    if (approved > 0) throw new HttpError(409, "allocation_approved", "Shipping for this batch is already approved and can't be changed.");
    if (changes.shippingQuote && !["ordered", "measured"].includes(batch.status)) {
      throw new HttpError(409, "quote_not_allowed", "Enter the shipping quote after the batch is ordered.");
    }

    const updated = await tx.batch.update({ where: { id: batchId }, data: changes });
    await writeAudit(tx, {
      actorId: actor.id,
      action: changes.shippingQuote ? "batch.quote_updated" : "batch.settings_updated",
      entityType: "batch",
      entityId: batchId,
      before: { shippingQuote: batch.shippingQuote?.toFixed(2) ?? null, allocationMethod: batch.allocationMethod },
      after: { shippingQuote: updated.shippingQuote?.toFixed(2) ?? null, allocationMethod: updated.allocationMethod },
    });
    return updated;
  });
}
