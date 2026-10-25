import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import type { User } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { HttpError } from "@/server/http";
import { sendEmail } from "@/server/messaging/email";
import { sendSms } from "@/server/messaging/sms";

export const OTP_TTL_MINUTES = 10;
export const MAX_CODES_PER_HOUR = 5;
export const MAX_ATTEMPTS_PER_CODE = 5;
const HOUR_MS = 60 * 60 * 1000;

export type OtpTarget = { channel: "sms"; phone: string } | { channel: "email"; email: string };

const targetKey = (t: OtpTarget) => (t.channel === "sms" ? t.phone : t.email);

function hashCode(target: string, code: string): string {
  return createHmac("sha256", env().AUTH_SECRET).update(`${target}:${code}`).digest("hex");
}

function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

function generateCode(): string {
  const { OTP_DEV_CODE, NODE_ENV } = env();
  if (OTP_DEV_CODE && NODE_ENV !== "production") return OTP_DEV_CODE;
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

/**
 * Issues a 6-digit code (SMS) or a code plus magic link (email).
 * Limited to MAX_CODES_PER_HOUR per phone/email; the advisory lock keeps
 * concurrent requests from slipping past the count.
 */
export async function requestOtp(target: OtpTarget, now = new Date()) {
  const key = targetKey(target);
  const code = generateCode();
  const expiresAt = new Date(now.getTime() + OTP_TTL_MINUTES * 60_000);

  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
    const recent = await tx.authChallenge.findMany({
      where: { target: key, createdAt: { gt: new Date(now.getTime() - HOUR_MS) } },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    });
    if (recent.length >= MAX_CODES_PER_HOUR) {
      const oldest = recent[0]!.createdAt.getTime();
      throw new HttpError(429, "otp_rate_limited", "Too many codes requested. Please try again later.", {
        retryAfterSeconds: Math.max(1, Math.ceil((oldest + HOUR_MS - now.getTime()) / 1000)),
      });
    }
    await tx.authChallenge.create({
      data: { channel: target.channel, target: key, codeHash: hashCode(key, code), expiresAt, createdAt: now },
    });
  });

  if (target.channel === "sms") {
    await sendSms(
      target.phone,
      `Your FANTASTICZONE code is ${code}. It expires in ${OTP_TTL_MINUTES} minutes. Do not share it with anyone.`,
    );
  } else {
    const link = new URL("/auth/magic", env().APP_URL);
    link.searchParams.set("email", target.email);
    link.searchParams.set("code", code);
    await sendEmail({
      to: target.email,
      subject: "Your FANTASTICZONE sign-in link",
      text: [
        "Use this link to sign in to FANTASTICZONE:",
        link.toString(),
        "",
        `Or enter this code: ${code}`,
        `The link and code expire in ${OTP_TTL_MINUTES} minutes. If you did not ask to sign in, ignore this email.`,
      ].join("\n"),
    });
  }

  return { channel: target.channel, expiresAt };
}

/**
 * Checks the most recent unexpired code for the target. On success the code
 * is consumed and the user is created on first sign-in.
 */
export async function verifyOtp(target: OtpTarget, code: string, now = new Date()): Promise<{ user: User; isNew: boolean }> {
  const key = targetKey(target);
  const challenge = await db.authChallenge.findFirst({
    where: { target: key, channel: target.channel, consumedAt: null, expiresAt: { gt: now } },
    orderBy: { createdAt: "desc" },
  });

  if (!challenge) {
    throw new HttpError(400, "otp_expired", "That code has expired or was already used. Request a new one.");
  }
  if (challenge.attempts >= MAX_ATTEMPTS_PER_CODE) {
    throw new HttpError(429, "otp_locked", "Too many incorrect attempts. Request a new code.");
  }

  if (!sameHash(challenge.codeHash, hashCode(key, code))) {
    const { attempts } = await db.authChallenge.update({
      where: { id: challenge.id },
      data: { attempts: { increment: 1 } },
      select: { attempts: true },
    });
    throw new HttpError(400, "otp_invalid", "That code is not right. Check the latest message and try again.", {
      attemptsLeft: Math.max(0, MAX_ATTEMPTS_PER_CODE - attempts),
    });
  }

  // Conditional update so two concurrent verifies can't both succeed.
  const consumed = await db.authChallenge.updateMany({
    where: { id: challenge.id, consumedAt: null },
    data: { consumedAt: now },
  });
  if (consumed.count !== 1) {
    throw new HttpError(400, "otp_expired", "That code has expired or was already used. Request a new one.");
  }
  await db.authChallenge.updateMany({ where: { target: key, consumedAt: null }, data: { consumedAt: now } });

  const where = target.channel === "sms" ? { phone: target.phone } : { email: target.email };
  const existing = await db.user.findUnique({ where });
  if (existing) {
    const verifiedField = target.channel === "sms" ? "phoneVerifiedAt" : "emailVerifiedAt";
    const user = existing[verifiedField]
      ? existing
      : await db.user.update({ where: { id: existing.id }, data: { [verifiedField]: now } });
    return { user, isNew: false };
  }

  const user = await db.user.create({
    data:
      target.channel === "sms"
        ? { phone: target.phone, phoneVerifiedAt: now }
        : { email: target.email, emailVerifiedAt: now },
  });
  return { user, isNew: true };
}
