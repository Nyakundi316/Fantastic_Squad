import { NextResponse } from "next/server";
import { z } from "zod";
import { ROLES } from "@/lib/auth/roles";
import { normalizePhone } from "@/lib/contact";
import { db } from "@/lib/db";
import { requireApiUser } from "@/server/auth/api-user";
import { writeAudit } from "@/server/audit";
import { HttpError, readJson, route } from "@/server/http";

const bodySchema = z.object({ phone: z.string().min(7).max(32), role: z.enum(ROLES) });

/** Admins assign roles by phone number. The person must have signed in once. */
export const POST = route(async (req) => {
  const actor = await requireApiUser(req, "settings.write");
  const { phone: raw, role } = await readJson(req, bodySchema);
  const phone = normalizePhone(raw);
  if (!phone) throw new HttpError(422, "validation_failed", "Enter a valid phone number.", { fields: { phone: ["Enter a valid phone number."] } });

  const user = await db.user.findUnique({ where: { phone } });
  if (!user) throw new HttpError(404, "user_not_found", "No account uses that number yet. Ask them to sign in once first.");
  if (user.id === actor.id) throw new HttpError(409, "own_role", "You can't change your own role. Ask another admin.");
  if (user.role === role) return NextResponse.json({ user: { id: user.id, role } });

  const updated = await db.$transaction(async (tx) => {
    const next = await tx.user.update({ where: { id: user.id }, data: { role } });
    await writeAudit(tx, { actorId: actor.id, action: "user.role_changed", entityType: "user", entityId: user.id, before: { role: user.role }, after: { role } });
    return next;
  });
  return NextResponse.json({ user: { id: updated.id, name: updated.name, role: updated.role } });
});
