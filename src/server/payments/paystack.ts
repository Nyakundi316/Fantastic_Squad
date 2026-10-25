import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

export function paystackConfigured(): boolean {
  return Boolean(env().PAYSTACK_SECRET_KEY);
}

/** Paystack signs the raw body with HMAC-SHA512 using the secret key (x-paystack-signature). */
export function verifyPaystackSignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature || !/^[0-9a-f]{128}$/i.test(signature)) return false;
  const expected = createHmac("sha512", secret).update(rawBody).digest();
  return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}

export type PaystackInit = { authorizationUrl: string; accessCode: string; reference: string };

/** https://paystack.com/docs/api/transaction/#initialize. Amount is in kobo, as an integer. */
export async function initializeTransaction(input: {
  email: string;
  amountKobo: string;
  reference: string;
  currency: string;
  callbackUrl: string;
  metadata: Record<string, string>;
}): Promise<PaystackInit> {
  const { PAYSTACK_SECRET_KEY, PAYSTACK_BASE_URL } = env();
  const res = await fetch(`${PAYSTACK_BASE_URL}/transaction/initialize`, {
    method: "POST",
    headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      email: input.email,
      amount: input.amountKobo,
      reference: input.reference,
      currency: input.currency,
      callback_url: input.callbackUrl,
      metadata: input.metadata,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    status?: boolean;
    message?: string;
    data?: { authorization_url?: string; access_code?: string; reference?: string };
  };
  if (!res.ok || !body.status || !body.data?.authorization_url) {
    throw new Error(`Paystack initialize failed (${res.status}): ${body.message ?? "no message"}`);
  }
  return { authorizationUrl: body.data.authorization_url, accessCode: body.data.access_code ?? "", reference: body.data.reference ?? input.reference };
}
