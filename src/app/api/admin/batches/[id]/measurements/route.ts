import { NextResponse } from "next/server";
import { requireApiUser } from "@/server/auth/api-user";
import { measurementUpsertSchema, upsertMeasurements } from "@/server/batches/measurements";
import { assertUuid, readJson, route } from "@/server/http";

/** Bulk upsert of per-unit measurements (weight g, L/W/H mm) for items in the batch. */
export const POST = route<{ params: { id: string } }>(async (req, { params }) => {
  const actor = await requireApiUser(req, "measurements.write");
  const batchId = assertUuid(params.id, "Batch");
  const { rows } = await readJson(req, measurementUpsertSchema);
  const result = await upsertMeasurements(batchId, rows, actor);
  return NextResponse.json(result);
});
