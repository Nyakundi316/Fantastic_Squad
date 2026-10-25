import { Prisma, type Batch } from "@prisma/client";
import { db } from "@/lib/db";

export type BatchSummary = Batch & {
  orderCount: number;
  itemCount: number;
  measuredItems: number;
  measuredWeightG: number;
  productTotal: string;
  approved: boolean;
};

/** One row per batch with live-order totals, computed in SQL. */
export async function listBatchSummaries(limit = 100): Promise<BatchSummary[]> {
  const batches = await db.batch.findMany({ orderBy: [{ cutoffAt: "desc" }], take: limit });
  if (batches.length === 0) return [];
  const ids = batches.map((b) => b.id);

  const [itemStats, orderStats, approvals] = await Promise.all([
    db.$queryRaw<Array<{ batch_id: string; items: bigint; measured: bigint; weight_g: bigint | null }>>`
      SELECT o.batch_id, COUNT(oi.id) AS items, COUNT(m.id) AS measured, SUM(m.weight_g::bigint * oi.quantity) AS weight_g
      FROM orders o
      JOIN order_items oi ON oi.order_id = o.id
      LEFT JOIN measurements m ON m.order_item_id = oi.id
      WHERE o.batch_id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))}) AND o.status <> 'cancelled'
      GROUP BY o.batch_id`,
    db.order.groupBy({
      by: ["batchId"],
      where: { batchId: { in: ids }, status: { not: "cancelled" } },
      _count: { _all: true },
      _sum: { productTotal: true },
    }),
    db.shippingAllocation.groupBy({ by: ["batchId"], where: { batchId: { in: ids }, approvedAt: { not: null } }, _count: { _all: true } }),
  ]);

  return batches.map((batch) => {
    const items = itemStats.find((s) => s.batch_id === batch.id);
    const orders = orderStats.find((s) => s.batchId === batch.id);
    return {
      ...batch,
      orderCount: orders?._count._all ?? 0,
      itemCount: Number(items?.items ?? 0),
      measuredItems: Number(items?.measured ?? 0),
      measuredWeightG: Number(items?.weight_g ?? 0),
      productTotal: (orders?._sum.productTotal ?? new Prisma.Decimal(0)).toFixed(2),
      approved: approvals.some((a) => a.batchId === batch.id),
    };
  });
}
