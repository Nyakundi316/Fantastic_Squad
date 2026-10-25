import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireApiUser } from "@/server/auth/api-user";
import { route } from "@/server/http";

export const POST = route(async (req) => {
  const user = await requireApiUser(req);
  const { count } = await db.notification.updateMany({
    where: { userId: user.id, channel: "in_app", status: "queued" },
    data: { status: "sent", sentAt: new Date() },
  });
  return NextResponse.json({ marked: count });
});
