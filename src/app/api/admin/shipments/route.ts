import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser } from "@/server/auth/api-user";
import { readJson, route } from "@/server/http";
import { createShipment, shipmentDetailsSchema } from "@/server/shipments";

const createSchema = shipmentDetailsSchema.extend({ batchId: z.string().uuid() });

export const POST = route(async (req) => {
  const actor = await requireApiUser(req, "shipments.write");
  const { batchId, ...details } = await readJson(req, createSchema);
  const shipment = await createShipment(batchId, details, actor);
  return NextResponse.json({ shipment }, { status: 201 });
});
