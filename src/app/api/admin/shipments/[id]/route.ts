import { NextResponse } from "next/server";
import { dispatchSoon } from "@/server/notifications/dispatch";
import { z } from "zod";
import { requireApiUser } from "@/server/auth/api-user";
import { assertUuid, readJson, route } from "@/server/http";
import { shipmentDetailsSchema, updateShipment } from "@/server/shipments";

const patchSchema = shipmentDetailsSchema
  .extend({ status: z.enum(["pending", "in_transit", "arrived", "delivered"]).optional() })
  .refine((b) => Object.values(b).some((v) => v !== undefined), { message: "Nothing to update." });

export const PATCH = route<{ params: { id: string } }>(async (req, { params }) => {
  const actor = await requireApiUser(req, "shipments.write");
  const change = await readJson(req, patchSchema);
  const { shipment, summary } = await updateShipment(assertUuid(params.id, "Shipment"), change, actor);
  if (change.status) await dispatchSoon();
  return NextResponse.json({ shipment, summary });
});
