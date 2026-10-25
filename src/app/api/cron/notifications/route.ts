import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { dispatchPending, enqueueDueReminders } from "@/server/notifications/dispatch";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorised(req: NextRequest): boolean {
  const secret = env().CRON_SECRET;
  const header = req.headers.get("authorization") ?? "";
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Vercel Cron, every 5 minutes: queue due reminders, then send what's waiting. */
export async function GET(req: NextRequest) {
  if (!authorised(req)) return NextResponse.json({ error: { code: "unauthorised", message: "Unauthorised." } }, { status: 401 });
  const reminders = await enqueueDueReminders();
  const dispatched = await dispatchPending({ budgetMs: 50_000, limit: 1000 });
  return NextResponse.json({ reminders, ...dispatched });
}
