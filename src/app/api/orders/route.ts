import { NextResponse } from "next/server";
import type { OrderStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { isStaff } from "@/lib/auth/roles";
import { requireApiUser } from "@/server/auth/api-user";
import { CART_COOKIE, cartCookieOptions } from "@/server/cart";
import { HttpError, readJson, route } from "@/server/http";
import { placeOrder, placeOrderSchema } from "@/server/orders/place-order";
import { orderDetailInclude, serializeOrder } from "@/server/orders/queries";

export const dynamic = "force-dynamic";

const ORDER_STATUSES: OrderStatus[] = [
  "preorder_placed", "batch_confirmed", "measured", "invoiced", "shipping_paid", "shipped", "delivered", "cancelled",
];

export const POST = route(async (req) => {
  const user = await requireApiUser(req);

  const raw = (await req.clone().json().catch(() => null)) as { acknowledgedShippingLater?: unknown } | null;
  // Hard rule 4: refuse before anything else unless the customer ticked the shipping acknowledgement.
  if (raw?.acknowledgedShippingLater !== true) {
    throw new HttpError(
      422,
      "shipping_ack_required",
      "Please confirm you understand shipping is separate and calculated later.",
      { fields: { acknowledgedShippingLater: ["Tick the box to confirm shipping is billed separately."] } },
    );
  }

  const input = await readJson(req, placeOrderSchema);
  const { order, batch } = await placeOrder(user, input);
  const full = await db.order.findUniqueOrThrow({ where: { id: order.id }, include: orderDetailInclude });

  const res = NextResponse.json({ order: serializeOrder(full), batch: { ...batch, cutoffAt: batch.cutoffAt.toISOString() } }, { status: 201 });
  res.cookies.set(CART_COOKIE, "", { ...cartCookieOptions, maxAge: 0 });
  return res;
});

export const GET = route(async (req) => {
  const user = await requireApiUser(req);
  const params = req.nextUrl.searchParams;
  const status = params.get("status");
  const page = Math.max(1, Number(params.get("page")) || 1);
  const pageSize = 25;

  const where: Prisma.OrderWhereInput = {
    ...(isStaff(user.role) ? {} : { userId: user.id }),
    ...(status && ORDER_STATUSES.includes(status as OrderStatus) ? { status: status as OrderStatus } : {}),
    ...(isStaff(user.role) && params.get("batchId") ? { batchId: params.get("batchId")! } : {}),
  };

  const [orders, total] = await Promise.all([
    db.order.findMany({
      where,
      include: orderDetailInclude,
      orderBy: { createdAt: "desc" },
      take: pageSize,
      skip: (page - 1) * pageSize,
    }),
    db.order.count({ where }),
  ]);
  return NextResponse.json({ orders: orders.map(serializeOrder), page, pageSize, total });
});
