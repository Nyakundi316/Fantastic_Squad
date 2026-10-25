import { NextResponse } from "next/server";
import { z } from "zod";
import { normalizeEmail, normalizePhone } from "@/lib/contact";
import { homeFor } from "@/lib/auth/roles";
import { SESSION_COOKIE, safeNextPath, sessionCookieOptions, signSession } from "@/lib/auth/session";
import { verifyOtp, type OtpTarget } from "@/server/auth/otp";
import { HttpError, readJson, route } from "@/server/http";

const bodySchema = z.object({
  phone: z.string().max(32).optional(),
  email: z.string().max(254).optional(),
  code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code."),
  next: z.string().max(512).optional(),
});

export const POST = route(async (req) => {
  const body = await readJson(req, bodySchema);

  let target: OtpTarget | null = null;
  if (body.phone && !body.email) {
    const phone = normalizePhone(body.phone);
    if (phone) target = { channel: "sms", phone };
  } else if (body.email && !body.phone) {
    const email = normalizeEmail(body.email);
    if (email) target = { channel: "email", email };
  }
  if (!target) throw new HttpError(422, "validation_failed", "Send either a valid phone number or email.");

  const { user, isNew } = await verifyOtp(target, body.code);
  const token = await signSession({ userId: user.id, role: user.role });

  const res = NextResponse.json({
    token,
    isNew,
    user: { id: user.id, name: user.name, role: user.role },
    redirectTo: safeNextPath(body.next) ?? homeFor(user.role),
  });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  return res;
});
