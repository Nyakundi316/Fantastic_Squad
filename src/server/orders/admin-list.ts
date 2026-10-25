import type { OrderStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";

const STATUSES: readonly OrderStatus[] = [
  "preorder_placed", "batch_confirmed", "measured", "invoiced", "shipping_paid", "shipped", "delivered", "cancelled",
];

export type AdminOrderFilters = {
  status?: OrderStatus;
  batchId?: string;
  shipMethod?: "sea" | "air";
  payment?: "paid" | "unpaid";
  q?: string;
  page: number;
};

export const ADMIN_ORDERS_PAGE_SIZE = 25;

export function parseAdminOrderFilters(get: (key: string) => string | null | undefined): AdminOrderFilters {
  const status = get("status");
  const batchId = get("batchId");
  const ship = get("shipMethod");
  const payment = get("payment");
  const q = get("q")?.trim();
  return {
    status: STATUSES.includes(status as OrderStatus) ? (status as OrderStatus) : undefined,
    batchId: batchId && /^[0-9a-f-]{36}$/i.test(batchId) ? batchId : undefined,
    shipMethod: ship === "sea" || ship === "air" ? ship : undefined,
    payment: payment === "paid" || payment === "unpaid" ? payment : undefined,
    q: q ? q.slice(0, 80) : undefined,
    page: Math.max(1, Number(get("page")) || 1),
  };
}

export function adminOrderWhere(f: AdminOrderFilters): Prisma.OrderWhereInput {
  const and: Prisma.OrderWhereInput[] = [];
  if (f.status) and.push({ status: f.status });
  if (f.batchId) and.push({ batchId: f.batchId });
  if (f.shipMethod) and.push({ shipMethod: f.shipMethod });
  if (f.payment === "paid") and.push({ invoices: { some: { kind: "product", status: "paid" } } });
  if (f.payment === "unpaid") and.push({ invoices: { some: { kind: "product", status: "issued" } } });
  if (f.q) {
    const digits = f.q.replace(/\D/g, "");
    and.push({
      OR: [
        { orderNumber: { contains: f.q, mode: "insensitive" } },
        { user: { name: { contains: f.q, mode: "insensitive" } } },
        { user: { email: { contains: f.q, mode: "insensitive" } } },
        ...(digits.length >= 4 ? [{ user: { phone: { contains: digits.slice(-10) } } }] : []),
      ],
    });
  }
  return and.length ? { AND: and } : {};
}

export const adminOrderRowInclude = {
  user: { select: { id: true, name: true, phone: true, email: true, role: true } },
  batch: { select: { id: true, name: true } },
  invoices: { where: { status: { not: "adjusted" } }, select: { id: true, kind: true, status: true, amount: true } },
  _count: { select: { items: true } },
} satisfies Prisma.OrderInclude;

export type AdminOrderRow = Prisma.OrderGetPayload<{ include: typeof adminOrderRowInclude }>;

export async function listAdminOrders(f: AdminOrderFilters, opts: { all?: boolean } = {}) {
  const where = adminOrderWhere(f);
  const [rows, total] = await Promise.all([
    db.order.findMany({
      where,
      include: adminOrderRowInclude,
      orderBy: { createdAt: "desc" },
      take: opts.all ? 10_000 : ADMIN_ORDERS_PAGE_SIZE,
      skip: opts.all ? 0 : (f.page - 1) * ADMIN_ORDERS_PAGE_SIZE,
    }),
    db.order.count({ where }),
  ]);
  return { rows, total };
}

export function productPaymentState(row: Pick<AdminOrderRow, "invoices">): "paid" | "pending" | "void" {
  const invoice = row.invoices.find((i) => i.kind === "product");
  if (!invoice) return "void";
  return invoice.status === "paid" ? "paid" : invoice.status === "issued" ? "pending" : "void";
}
