import { NextResponse } from "next/server";
import { requireApiUser } from "@/server/auth/api-user";
import { HttpError, route } from "@/server/http";
import { getOrderForViewer, serializeOrder } from "@/server/orders/queries";

export const dynamic = "force-dynamic";

export const GET = route<{ params: { id: string } }>(async (req, { params }) => {
  const user = await requireApiUser(req);
  const order = await getOrderForViewer(params.id, user);
  // 404 rather than 403 so order ids can't be probed.
  if (!order) throw new HttpError(404, "order_not_found", "Order not found.");
  return NextResponse.json({ order: serializeOrder(order) });
});
