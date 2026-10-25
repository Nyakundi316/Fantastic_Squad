import { NextResponse } from "next/server";
import { requireApiUser } from "@/server/auth/api-user";
import { assertUuid, route } from "@/server/http";
import { cancelOrder } from "@/server/orders/cancel-order";

export const POST = route<{ params: { id: string } }>(async (req, { params }) => {
  const user = await requireApiUser(req);
  assertUuid(params.id, "Order");
  const order = await cancelOrder(params.id, user);
  return NextResponse.json({ order: { id: order.id, orderNumber: order.orderNumber, status: order.status } });
});
