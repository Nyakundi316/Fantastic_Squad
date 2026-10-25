import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

export const batchOrdersInclude = {
  user: { select: { id: true, name: true, phone: true, role: true } },
  items: {
    orderBy: { createdAt: "asc" },
    include: {
      product: { select: { title: true } },
      variant: { select: { label: true, sku: true } },
      measurement: true,
    },
  },
  invoices: { where: { status: { not: "adjusted" } }, select: { id: true, kind: true, status: true, amount: true } },
} satisfies Prisma.OrderInclude;

export type BatchOrder = Prisma.OrderGetPayload<{ include: typeof batchOrdersInclude }>;

export type BatchTotals = {
  orderCount: number;
  units: number;
  itemCount: number;
  measuredItems: number;
  /** Σ weight_g × quantity over measured items, integer grams. */
  measuredWeightG: number;
  productTotal: string;
};

export function batchTotals(orders: BatchOrder[]): BatchTotals {
  let units = 0;
  let itemCount = 0;
  let measuredItems = 0;
  let measuredWeightG = 0;
  let productTotal = new Prisma.Decimal(0);

  for (const order of orders) {
    productTotal = productTotal.add(order.productTotal);
    for (const item of order.items) {
      itemCount += 1;
      units += item.quantity;
      if (item.measurement) {
        measuredItems += 1;
        measuredWeightG += item.measurement.weightG * item.quantity;
      }
    }
  }
  return { orderCount: orders.length, units, itemCount, measuredItems, measuredWeightG, productTotal: productTotal.toFixed(2) };
}

/** Live (non-cancelled) orders in a batch with everything the admin screens need. */
export async function getBatchWithOrders(batchId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(batchId)) return null;
  const batch = await db.batch.findUnique({
    where: { id: batchId },
    include: { createdBy: { select: { name: true } }, _count: { select: { allocations: true } } },
  });
  if (!batch) return null;
  const orders = await db.order.findMany({
    where: { batchId, status: { not: "cancelled" } },
    include: batchOrdersInclude,
    orderBy: { orderNumber: "asc" },
  });
  return { batch, orders, totals: batchTotals(orders) };
}

/** What closing a collecting batch would do, shown to ops before they confirm. */
export function closePreview(orders: BatchOrder[]) {
  const paid = orders.filter((o) => o.invoices.some((i) => i.kind === "product" && i.status === "paid"));
  const unpaid = orders.filter((o) => !paid.includes(o));
  return { confirm: paid.map((o) => o.orderNumber), cancel: unpaid.map((o) => o.orderNumber) };
}
