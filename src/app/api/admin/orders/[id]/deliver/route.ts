import { NextResponse } from "next/server";
import { dispatchSoon } from "@/server/notifications/dispatch";
import { requireApiUser } from "@/server/auth/api-user";
import { assertUuid, route } from "@/server/http";
import { deliverHeldOrder } from "@/server/shipments";

export const POST = route<{ params: { id: string } }>(async (req, { params }) => {
  const actor = await requireApiUser(req, "shipments.write");
  const order = await deliverHeldOrder(assertUuid(params.id, "Order"), actor);
  await dispatchSoon();
  return NextResponse.json({ order: { id: order.id, status: order.status } });
});
