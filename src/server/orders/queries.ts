import type { OrderStatus, Prisma, User } from "@prisma/client";
import { db } from "@/lib/db";
import { isStaff } from "@/lib/auth/roles";
import { sortedImages } from "@/server/catalog";

export const orderDetailInclude = {
  items: {
    orderBy: { createdAt: "asc" },
    include: {
      product: { select: { id: true, title: true, images: true } },
      variant: { select: { label: true, sku: true } },
      measurement: true,
    },
  },
  invoices: { orderBy: [{ kind: "asc" }, { version: "desc" }] },
  payments: { orderBy: { createdAt: "desc" } },
  batch: {
    select: {
      id: true,
      name: true,
      cutoffAt: true,
      status: true,
      shipments: { select: { carrier: true, trackingNumber: true, estimatedDays: true, departedAt: true, status: true }, take: 1 },
    },
  },
  shipAddress: true,
  user: { select: { id: true, name: true, phone: true, email: true, role: true } },
} satisfies Prisma.OrderInclude;

export type OrderDetail = Prisma.OrderGetPayload<{ include: typeof orderDetailInclude }>;

/** Owners see their own orders; staff see every order. Anyone else gets null (render as 404). */
export async function getOrderForViewer(id: string, viewer: Pick<User, "id" | "role">): Promise<OrderDetail | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const order = await db.order.findUnique({ where: { id }, include: orderDetailInclude });
  if (!order) return null;
  if (order.userId !== viewer.id && !isStaff(viewer.role)) return null;
  return order;
}

/** The invoice currently in force for a kind (the highest version that isn't superseded). */
export function currentInvoice(order: Pick<OrderDetail, "invoices">, kind: "product" | "shipping") {
  return order.invoices.find((i) => i.kind === kind && i.status !== "adjusted") ?? null;
}

export async function listOrdersForUser(userId: string, statuses: readonly OrderStatus[] | null) {
  return db.order.findMany({
    where: { userId, ...(statuses ? { status: { in: [...statuses] } } : {}) },
    orderBy: { createdAt: "desc" },
    include: {
      items: { take: 1, orderBy: { createdAt: "asc" }, include: { product: { select: { title: true, images: true } } } },
      _count: { select: { items: true } },
      invoices: { where: { status: { not: "adjusted" } }, orderBy: { version: "desc" } },
    },
  });
}

const money = (value: Prisma.Decimal) => value.toFixed(2);

export function serializeOrder(order: OrderDetail) {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    shipMethod: order.shipMethod,
    productTotal: money(order.productTotal),
    shippingTotal: money(order.shippingTotal),
    grandTotal: money(order.grandTotal),
    createdAt: order.createdAt.toISOString(),
    batch: order.batch && { id: order.batch.id, name: order.batch.name, cutoffAt: order.batch.cutoffAt.toISOString() },
    shipAddress: order.shipAddress && {
      id: order.shipAddress.id,
      fullName: order.shipAddress.fullName,
      line1: order.shipAddress.line1,
      line2: order.shipAddress.line2,
      city: order.shipAddress.city,
      state: order.shipAddress.state,
      country: order.shipAddress.country,
    },
    items: order.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      title: item.product.title,
      variant: item.variant.label,
      image: sortedImages(item.product.images)[0] ?? null,
      quantity: item.quantity,
      unitPrice: money(item.unitPrice),
      lineTotal: money(item.lineTotal),
      measured: Boolean(item.measurement),
    })),
    invoices: order.invoices.map((inv) => ({
      id: inv.id,
      kind: inv.kind,
      version: inv.version,
      amount: money(inv.amount),
      currency: inv.currency,
      status: inv.status,
      issuedAt: inv.issuedAt.toISOString(),
      dueAt: inv.dueAt?.toISOString() ?? null,
      paidAt: inv.paidAt?.toISOString() ?? null,
    })),
    payments: order.payments.map((p) => ({
      id: p.id,
      kind: p.kind,
      amount: money(p.amount),
      method: p.method,
      status: p.status,
      paidAt: p.paidAt?.toISOString() ?? null,
    })),
  };
}
