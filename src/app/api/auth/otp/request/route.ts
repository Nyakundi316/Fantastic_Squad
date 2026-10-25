import { NextResponse } from "next/server";
import { z } from "zod";
import { normalizeEmail, normalizePhone } from "@/lib/contact";
import { requestOtp, OTP_TTL_MINUTES } from "@/server/auth/otp";
import { HttpError, readJson, route } from "@/server/http";

const bodySchema = z
  .object({ phone: z.string().max(32).optional(), email: z.string().max(254).optional() })
  .refine((b) => Boolean(b.phone) !== Boolean(b.email), { message: "Send either a phone number or an email." });

export const POST = route(async (req) => {
  const body = await readJson(req, bodySchema);

  let target;
  if (body.phone) {
    const phone = normalizePhone(body.phone);
    if (!phone) throw new HttpError(422, "validation_failed", "Enter a valid phone number.", { fields: { phone: ["Enter a valid phone number, e.g. 0803 000 0000."] } });
    target = { channel: "sms" as const, phone };
  } else {
    const email = normalizeEmail(body.email!);
    if (!email) throw new HttpError(422, "validation_failed", "Enter a valid email address.", { fields: { email: ["Enter a valid email address."] } });
    target = { channel: "email" as const, email };
  }

  const { channel } = await requestOtp(target);
  return NextResponse.json({ ok: true, channel, expiresInSeconds: OTP_TTL_MINUTES * 60 });
});
