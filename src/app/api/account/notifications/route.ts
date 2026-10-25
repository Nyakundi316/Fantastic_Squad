import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireApiUser } from "@/server/auth/api-user";
import { readJson, route } from "@/server/http";

const prefsSchema = z.object({ whatsapp: z.boolean(), email: z.boolean() });

/** Channel preferences for optional reminders. Order, invoice and shipping updates always go out. */
export const PATCH = route(async (req) => {
  const user = await requireApiUser(req);
  const prefs = await readJson(req, prefsSchema);
  const updated = await db.user.update({ where: { id: user.id }, data: { notificationPrefs: prefs }, select: { notificationPrefs: true } });
  return NextResponse.json({ notificationPrefs: updated.notificationPrefs });
});
