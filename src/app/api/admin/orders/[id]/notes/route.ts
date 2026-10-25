import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireApiUser } from "@/server/auth/api-user";
import { writeAudit } from "@/server/audit";
import { HttpError, assertUuid, readJson, route } from "@/server/http";

const bodySchema = z.object({ notes: z.string().trim().max(2000) });

/** Internal notes on an order. Any staff role, including support. */
export const PATCH = route<{ params: { id: string } }>(async (req, { params }) => {
  const actor = await requireApiUser(req, "notes.write");
  assertUuid(params.id, "Order");
  const { notes } = await readJson(req, bodySchema);

  const order = await db.$transaction(async (tx) => {
    const before = await tx.order.findUnique({ where: { id: params.id }, select: { id: true, notes: true } });
    if (!before) throw new HttpError(404, "order_not_found", "Order not found.");
    const updated = await tx.order.update({ where: { id: params.id }, data: { notes: notes || null } });
    await writeAudit(tx, {
      actorId: actor.id,
      action: "order.notes_updated",
      entityType: "order",
      entityId: params.id,
      before: { notes: before.notes },
      after: { notes: updated.notes },
    });
    return updated;
  });

  return NextResponse.json({ order: { id: order.id, notes: order.notes } });
});
