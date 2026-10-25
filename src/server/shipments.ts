import type { Prisma, ShipmentStatus, User } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { writeAudit } from "@/server/audit";
import { HttpError } from "@/server/http";
import { queueNotification } from "@/server/notifications/queue";

const NEXT_STATUS: Record<ShipmentStatus, ShipmentStatus | null> = {
  pending: "in_transit",
  in_transit: "arrived",
  arrived: "delivered",
  delivered: null,
};

export const shipmentDetailsSchema = z.object({
  carrier: z.string().trim().max(80).nullish(),
  trackingNumber: z.string().trim().max(80).nullish(),
  estimatedDays: z.number().int().positive().max(120).nullish(),
});

export type ShipmentDetails = z.infer<typeof shipmentDetailsSchema>;

async function lockBatch(tx: Prisma.TransactionClient, batchId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM batches WHERE id = ${batchId}::uuid FOR UPDATE`;
  if (rows.length === 0) throw new HttpError(404, "batch_not_found", "Batch not found.");
  return tx.batch.findUniqueOrThrow({ where: { id: batchId } });
}

/** One shipment per batch, created once shipping invoices have gone out. */
export async function createShipment(batchId: string, details: ShipmentDetails, actor: Pick<User, "id">) {
  return db.$transaction(async (tx) => {
    const batch = await lockBatch(tx, batchId);
    if (batch.status !== "invoiced") {
      throw new HttpError(409, "batch_not_invoiced", "Approve the shipping split and send invoices before booking the shipment.");
    }
    if ((await tx.shipment.count({ where: { batchId } })) > 0) {
      throw new HttpError(409, "shipment_exists", "This batch already has a shipment.");
    }
    const shipment = await tx.shipment.create({
      data: { batchId, method: batch.defaultShipMethod, carrier: details.carrier ?? null, trackingNumber: details.trackingNumber ?? null, estimatedDays: details.estimatedDays ?? null },
    });
    await writeAudit(tx, { actorId: actor.id, action: "shipment.created", entityType: "shipment", entityId: shipment.id, after: { batchId, ...details } });
    return shipment;
  });
}

/**
 * Advances a shipment one step, or edits carrier details. Dispatch ships paid
 * orders and holds unpaid ones at the destination; delivery completes paid ones.
 */
export async function updateShipment(shipmentId: string, change: ShipmentDetails & { status?: ShipmentStatus }, actor: Pick<User, "id">) {
  return db.$transaction(async (tx) => {
    const existing = await tx.shipment.findUnique({ where: { id: shipmentId } });
    if (!existing) throw new HttpError(404, "shipment_not_found", "Shipment not found.");
    const batch = await lockBatch(tx, existing.batchId);
    const shipment = await tx.shipment.findUniqueOrThrow({ where: { id: shipmentId } });

    const details: ShipmentDetails = {};
    if (change.carrier !== undefined) details.carrier = change.carrier;
    if (change.trackingNumber !== undefined) details.trackingNumber = change.trackingNumber;
    if (change.estimatedDays !== undefined) details.estimatedDays = change.estimatedDays;
    if (shipment.status === "delivered" && Object.keys(details).length > 0) {
      throw new HttpError(409, "shipment_closed", "This shipment is delivered and can no longer be edited.");
    }

    const summary: Record<string, number> = {};
    const data: Prisma.ShipmentUpdateInput = { ...details };

    if (change.status && change.status !== shipment.status) {
      if (NEXT_STATUS[shipment.status] !== change.status) {
        throw new HttpError(409, "invalid_transition", `A shipment can't move from ${shipment.status.replace("_", " ")} to ${change.status.replace("_", " ")}.`);
      }
      data.status = change.status;
      const now = new Date();
      const carrierDetails = { ...shipment, ...details };

      if (change.status === "in_transit") {
        data.departedAt = now;
        const paid = await tx.order.findMany({ where: { batchId: batch.id, status: "shipping_paid" }, include: { user: { select: { id: true, name: true } } } });
        await tx.order.updateMany({ where: { id: { in: paid.map((o) => o.id) } }, data: { status: "shipped" } });
        for (const order of paid) {
          await queueNotification(tx, {
            userId: order.user.id,
            template: "shipment_dispatched",
            vars: {
              name: order.user.name ?? "there",
              orderNumber: order.orderNumber,
              shipMethod: shipment.method,
              estimatedDays: carrierDetails.estimatedDays ?? (shipment.method === "air" ? "7–14" : "30–45"),
              trackingNumber: carrierDetails.trackingNumber ?? "to follow",
            },
            link: `/orders/${order.id}`,
          });
        }
        await tx.batch.update({ where: { id: batch.id }, data: { status: "shipped" } });
        summary.shipped = paid.length;
        summary.held = await tx.order.count({ where: { batchId: batch.id, status: "invoiced" } });
      }

      if (change.status === "delivered") {
        data.deliveredAt = now;
        const arrived = await tx.order.findMany({ where: { batchId: batch.id, status: "shipped" }, include: { user: { select: { id: true, name: true } } } });
        await tx.order.updateMany({ where: { id: { in: arrived.map((o) => o.id) } }, data: { status: "delivered" } });
        for (const order of arrived) {
          await queueNotification(tx, {
            userId: order.user.id,
            template: "shipment_delivered",
            vars: { name: order.user.name ?? "there", orderNumber: order.orderNumber },
            link: `/orders/${order.id}`,
          });
        }
        await tx.batch.update({ where: { id: batch.id }, data: { status: "delivered" } });
        summary.delivered = arrived.length;
        summary.held = await tx.order.count({ where: { batchId: batch.id, status: "invoiced" } });
      }
    }

    const updated = await tx.shipment.update({ where: { id: shipmentId }, data });
    await writeAudit(tx, {
      actorId: actor.id,
      action: change.status && change.status !== shipment.status ? "shipment.status_changed" : "shipment.updated",
      entityType: "shipment",
      entityId: shipmentId,
      before: { status: shipment.status, carrier: shipment.carrier, trackingNumber: shipment.trackingNumber, estimatedDays: shipment.estimatedDays },
      after: { status: updated.status, carrier: updated.carrier, trackingNumber: updated.trackingNumber, estimatedDays: updated.estimatedDays, ...summary },
    });
    return { shipment: updated, summary };
  });
}

/** Releases a held order (paid after its batch was delivered) to the customer. */
export async function deliverHeldOrder(orderId: string, actor: Pick<User, "id">) {
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM orders WHERE id = ${orderId}::uuid FOR UPDATE`;
    if (rows.length === 0) throw new HttpError(404, "order_not_found", "Order not found.");
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { batch: true, user: { select: { id: true, name: true } } } });
    if (order.status !== "shipped" || order.batch?.status !== "delivered") {
      throw new HttpError(409, "not_releasable", "Only paid orders waiting at the destination can be marked delivered here.");
    }
    const updated = await tx.order.update({ where: { id: orderId }, data: { status: "delivered" } });
    await queueNotification(tx, {
      userId: order.user.id,
      template: "shipment_delivered",
      vars: { name: order.user.name ?? "there", orderNumber: order.orderNumber },
      link: `/orders/${orderId}`,
    });
    await writeAudit(tx, { actorId: actor.id, action: "order.delivered", entityType: "order", entityId: orderId, before: { status: "shipped" }, after: { status: "delivered" } });
    return updated;
  });
}
