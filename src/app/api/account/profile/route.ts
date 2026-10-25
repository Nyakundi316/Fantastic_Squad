import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireApiUser } from "@/server/auth/api-user";
import { readJson, route } from "@/server/http";

const profileSchema = z.object({ name: z.string().trim().min(2, "Enter your name.").max(120) });

export const PATCH = route(async (req) => {
  const user = await requireApiUser(req);
  const { name } = await readJson(req, profileSchema);
  const updated = await db.user.update({ where: { id: user.id }, data: { name }, select: { id: true, name: true } });
  return NextResponse.json({ user: updated });
});
