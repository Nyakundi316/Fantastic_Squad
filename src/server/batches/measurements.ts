import type { User } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { MEASURABLE_STATUSES } from "@/lib/batch-status";
import { writeAudit } from "@/server/audit";
import { HttpError } from "@/server/http";

const MAX_WEIGHT_G = 1_000_000; // 1 tonne per unit
const MAX_DIMENSION_MM = 10_000;

const positiveInt = (max: number) => z.number().int("Whole numbers only.").positive("Must be more than 0.").max(max);

export const measurementRowSchema = z
  .object({
    orderItemId: z.string().uuid(),
    weightG: positiveInt(MAX_WEIGHT_G),
    lengthMm: positiveInt(MAX_DIMENSION_MM).nullish(),
    widthMm: positiveInt(MAX_DIMENSION_MM).nullish(),
    heightMm: positiveInt(MAX_DIMENSION_MM).nullish(),
  })
  .refine((r) => [r.lengthMm, r.widthMm, r.heightMm].filter((d) => d != null).length % 3 === 0, {
    message: "Enter all three dimensions or none.",
    path: ["lengthMm"],
  });

export const measurementUpsertSchema = z.object({ rows: z.array(measurementRowSchema).min(1).max(2000) });

export type MeasurementRow = z.infer<typeof measurementRowSchema>;

type Snapshot = { weightG: number; lengthMm: number | null; widthMm: number | null; heightMm: number | null };

const snapshot = (m: Snapshot): Snapshot => ({ weightG: m.weightG, lengthMm: m.lengthMm, widthMm: m.widthMm, heightMm: m.heightMm });
const sameMeasurement = (a: Snapshot, b: Snapshot) =>
  a.weightG === b.weightG && a.lengthMm === b.lengthMm && a.widthMm === b.widthMm && a.heightMm === b.heightMm;

/**
 * Bulk upsert, all-or-nothing. Every create or change is written to audit_log
 * with before/after; unchanged rows are skipped and not logged.
 */
export async function upsertMeasurements(batchId: string, rows: MeasurementRow[], actor: Pick<User, "id">) {
  const ids = rows.map((r) => r.orderItemId);
  if (new Set(ids).size !== ids.length) throw new HttpError(422, "duplicate_rows", "The same item appears more than once.");

  return db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ status: string; name: string }>>`
      SELECT status, name FROM batches WHERE id = ${batchId}::uuid FOR UPDATE`;
    const batch = locked[0];
    if (!batch) throw new HttpError(404, "batch_not_found", "Batch not found.");
    if (!MEASURABLE_STATUSES.includes(batch.status as never)) {
      throw new HttpError(409, "not_measurable", "Measurements can be entered once the batch is ordered and until shipping is approved.");
    }
    if ((await tx.shippingAllocation.count({ where: { batchId, approvedAt: { not: null } } })) > 0) {
      throw new HttpError(409, "allocation_approved", "Shipping is approved for this batch, so measurements are locked.");
    }

    const items = await tx.orderItem.findMany({
      where: { id: { in: ids }, order: { batchId, status: { not: "cancelled" } } },
      include: { measurement: true, order: { select: { orderNumber: true } } },
    });
    if (items.length !== ids.length) {
      throw new HttpError(422, "unknown_items", "Some rows don't match live items in this batch. Download a fresh template and try again.");
    }
    const byId = new Map(items.map((i) => [i.id, i]));

    let created = 0;
    let updated = 0;
    let unchanged = 0;

    for (const row of rows) {
      const item = byId.get(row.orderItemId)!;
      const next: Snapshot = { weightG: row.weightG, lengthMm: row.lengthMm ?? null, widthMm: row.widthMm ?? null, heightMm: row.heightMm ?? null };
      const context = { batchId, orderNumber: item.order.orderNumber, orderItemId: item.id };

      if (!item.measurement) {
        const m = await tx.measurement.create({ data: { orderItemId: item.id, ...next, measuredById: actor.id } });
        await writeAudit(tx, { actorId: actor.id, action: "measurement.created", entityType: "measurement", entityId: m.id, after: { ...context, ...next } });
        created += 1;
      } else if (!sameMeasurement(snapshot(item.measurement), next)) {
        await tx.measurement.update({ where: { id: item.measurement.id }, data: { ...next, measuredById: actor.id } });
        await writeAudit(tx, {
          actorId: actor.id,
          action: "measurement.updated",
          entityType: "measurement",
          entityId: item.measurement.id,
          before: { ...context, ...snapshot(item.measurement) },
          after: { ...context, ...next },
        });
        updated += 1;
      } else {
        unchanged += 1;
      }
    }

    return { created, updated, unchanged };
  });
}
