import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireApiUser } from "@/server/auth/api-user";
import { writeAudit } from "@/server/audit";
import { HttpError, readJson, route } from "@/server/http";

const createSchema = z.object({
  name: z.string().trim().min(3, "Give the batch a name.").max(80),
  cutoffAt: z.string().datetime({ offset: true, message: "Choose a cutoff date and time." }),
  defaultShipMethod: z.enum(["sea", "air"]),
});

export const POST = route(async (req) => {
  const actor = await requireApiUser(req, "batches.manage");
  const input = await readJson(req, createSchema);
  const cutoffAt = new Date(input.cutoffAt);
  if (cutoffAt.getTime() <= Date.now()) {
    throw new HttpError(422, "validation_failed", "Cutoff must be in the future.", { fields: { cutoffAt: ["Cutoff must be in the future."] } });
  }

  const batch = await db.$transaction(async (tx) => {
    const batch = await tx.batch.create({
      data: { name: input.name, cutoffAt, defaultShipMethod: input.defaultShipMethod, createdById: actor.id },
    });
    await writeAudit(tx, {
      actorId: actor.id,
      action: "batch.created",
      entityType: "batch",
      entityId: batch.id,
      after: { name: batch.name, cutoffAt: batch.cutoffAt.toISOString(), defaultShipMethod: batch.defaultShipMethod },
    });
    return batch;
  });

  return NextResponse.json({ batch: { id: batch.id, name: batch.name, status: batch.status } }, { status: 201 });
});
