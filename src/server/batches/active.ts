import type { Prisma, ShipMethod } from "@prisma/client";
import { db } from "@/lib/db";

export type ActiveBatchSummary = {
  id: string;
  name: string;
  cutoffAt: Date;
  openedAt: Date;
  shipMethod: ShipMethod;
  memberCount: number;
  orderCount: number;
};

/** Batches still collecting with a cutoff in the future. Counts are real, from orders. */
export async function listActiveBatches(now = new Date()): Promise<ActiveBatchSummary[]> {
  const batches = await db.batch.findMany({
    where: { status: "collecting", cutoffAt: { gt: now } },
    orderBy: { cutoffAt: "asc" },
    select: { id: true, name: true, cutoffAt: true, createdAt: true, defaultShipMethod: true },
  });
  if (batches.length === 0) return [];

  const members = await db.order.groupBy({
    by: ["batchId", "userId"],
    where: { batchId: { in: batches.map((b) => b.id) }, status: { not: "cancelled" } },
    _count: { _all: true },
  });

  return batches.map((batch) => {
    const rows = members.filter((m) => m.batchId === batch.id);
    return {
      id: batch.id,
      name: batch.name,
      cutoffAt: batch.cutoffAt,
      openedAt: batch.createdAt,
      shipMethod: batch.defaultShipMethod,
      memberCount: rows.length,
      orderCount: rows.reduce((sum, r) => sum + r._count._all, 0),
    };
  });
}

/** The soonest-closing open batch per ship method. */
export function openBatchByMethod(batches: ActiveBatchSummary[]): Partial<Record<ShipMethod, ActiveBatchSummary>> {
  const result: Partial<Record<ShipMethod, ActiveBatchSummary>> = {};
  for (const batch of batches) result[batch.shipMethod] ??= batch;
  return result;
}

/**
 * Locks (FOR SHARE) the batch a new order should join: the soonest-closing
 * collecting batch for that ship method. The lock stops ops from closing the
 * batch between this check and the order insert.
 */
export async function lockOpenBatchFor(tx: Prisma.TransactionClient, method: ShipMethod) {
  const rows = await tx.$queryRaw<Array<{ id: string; name: string; cutoff_at: Date }>>`
    SELECT id, name, cutoff_at FROM batches
    WHERE status = 'collecting' AND cutoff_at > now() AND default_ship_method = ${method}::"ShipMethod"
    ORDER BY cutoff_at ASC
    LIMIT 1
    FOR SHARE`;
  return rows[0] ?? null;
}
