import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { dispatchSoon } from "@/server/notifications/dispatch";
import { applyPaystackCharge } from "@/server/payments/card";
import { verifyPaystackSignature } from "@/server/payments/paystack";

export const dynamic = "force-dynamic";

/**
 * Paystack webhook. Signature first (hard rule 6), on the exact raw body.
 * Any verified event gets a 200 so Paystack stops retrying; only bad signatures are refused.
 */
export async function POST(req: NextRequest) {
  const secret = env().PAYSTACK_SECRET_KEY;
  const raw = await req.text();

  if (!secret || !verifyPaystackSignature(raw, req.headers.get("x-paystack-signature"), secret)) {
    return NextResponse.json({ error: { code: "invalid_signature", message: "Signature check failed." } }, { status: 401 });
  }

  let event: { event?: string; data?: Record<string, unknown> };
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: { code: "invalid_json", message: "Body is not JSON." } }, { status: 400 });
  }

  if (event.event !== "charge.success" || !event.data) {
    return NextResponse.json({ received: true, outcome: "ignored" });
  }

  try {
    const outcome = await applyPaystackCharge(event.data);
    if (outcome === "settled") await dispatchSoon();
    if (outcome !== "settled" && outcome !== "duplicate") console.warn(`[paystack] charge ${String(event.data.reference)}: ${outcome}`);
    return NextResponse.json({ received: true, outcome });
  } catch (err) {
    // 500 makes Paystack retry later, which is what we want for transient failures.
    console.error("[paystack] webhook", err);
    return NextResponse.json({ error: { code: "internal_error", message: "Could not process event." } }, { status: 500 });
  }
}
