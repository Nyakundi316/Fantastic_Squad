import { NextRequest, type NextResponse } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import { db, resetDatabase } from "./db";

vi.mock("@/server/messaging/sms", () => ({ sendSms: vi.fn(async () => ({ provider: "test" })) }));
vi.mock("@/server/messaging/email", () => ({ sendEmail: vi.fn(async () => ({ provider: "test" })) }));

const { sendSms } = await import("@/server/messaging/sms");
const { sendEmail } = await import("@/server/messaging/email");
const { POST: requestRoute } = await import("@/app/api/auth/otp/request/route");
const { POST: verifyRoute } = await import("@/app/api/auth/otp/verify/route");
const { GET: meRoute } = await import("@/app/api/auth/me/route");

const ctx = { params: {} };
const post = (path: string, body: unknown) =>
  new NextRequest(`http://localhost:3000${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

function lastSmsCode(): string {
  const text = vi.mocked(sendSms).mock.calls.at(-1)?.[1] ?? "";
  const match = text.match(/\b(\d{6})\b/);
  if (!match) throw new Error(`No code in SMS: ${text}`);
  return match[1]!;
}

beforeEach(async () => {
  await resetDatabase();
  vi.mocked(sendSms).mockClear();
  vi.mocked(sendEmail).mockClear();
});

afterAll(() => db.$disconnect());

describe("phone OTP sign-up", () => {
  it("creates a customer, sets an httpOnly session cookie and lands on /", async () => {
    const requested = await requestRoute(post("/api/auth/otp/request", { phone: "0803 555 0101" }), ctx);
    expect(requested.status).toBe(200);
    expect(vi.mocked(sendSms).mock.calls[0]?.[0]).toBe("+2348035550101");

    const res = (await verifyRoute(post("/api/auth/otp/verify", { phone: "08035550101", code: lastSmsCode() }), ctx)) as NextResponse;
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ isNew: true, redirectTo: "/", user: { role: "customer" } });

    const cookie = res.cookies.get(SESSION_COOKIE);
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("lax");
    expect(await verifySession(cookie?.value)).toMatchObject({ role: "customer" });

    const user = await db.user.findUniqueOrThrow({ where: { phone: "+2348035550101" } });
    expect(user.phoneVerifiedAt).not.toBeNull();

    const me = await meRoute(
      new NextRequest("http://localhost:3000/api/auth/me", { headers: { cookie: `${SESSION_COOKIE}=${body.token}` } }),
      ctx,
    );
    expect((await me.json()).user).toMatchObject({ id: user.id, phone: "+2348035550101", phoneVerified: true });
  });

  it("signs an existing admin in and sends them to /admin", async () => {
    await db.user.create({ data: { phone: "+2348030000001", role: "admin", name: "Funmi" } });
    await requestRoute(post("/api/auth/otp/request", { phone: "+2348030000001" }), ctx);
    const res = await verifyRoute(post("/api/auth/otp/verify", { phone: "+2348030000001", code: lastSmsCode() }), ctx);
    expect(await res.json()).toMatchObject({ isNew: false, redirectTo: "/admin", user: { role: "admin" } });
  });

  it("honours a safe next path and ignores an external one", async () => {
    await requestRoute(post("/api/auth/otp/request", { phone: "08035550102" }), ctx);
    const code = lastSmsCode();
    const res = await verifyRoute(post("/api/auth/otp/verify", { phone: "08035550102", code, next: "//evil.example" }), ctx);
    expect((await res.json()).redirectTo).toBe("/");
  });

  it("does not accept a code twice", async () => {
    await requestRoute(post("/api/auth/otp/request", { phone: "08035550103" }), ctx);
    const code = lastSmsCode();
    expect((await verifyRoute(post("/api/auth/otp/verify", { phone: "08035550103", code }), ctx)).status).toBe(200);
    const replay = await verifyRoute(post("/api/auth/otp/verify", { phone: "08035550103", code }), ctx);
    expect(replay.status).toBe(400);
    expect((await replay.json()).error.code).toBe("otp_expired");
  });

  it("locks a code after five wrong attempts", async () => {
    await requestRoute(post("/api/auth/otp/request", { phone: "08035550104" }), ctx);
    const real = lastSmsCode();
    const wrong = real === "000000" ? "111111" : "000000";

    for (let i = 0; i < 5; i++) {
      const res = await verifyRoute(post("/api/auth/otp/verify", { phone: "08035550104", code: wrong }), ctx);
      expect(res.status).toBe(400);
      expect((await res.json()).error.details.attemptsLeft).toBe(4 - i);
    }
    const locked = await verifyRoute(post("/api/auth/otp/verify", { phone: "08035550104", code: real }), ctx);
    expect(locked.status).toBe(429);
    expect((await locked.json()).error.code).toBe("otp_locked");
  });

  it("rejects expired codes", async () => {
    await requestRoute(post("/api/auth/otp/request", { phone: "08035550105" }), ctx);
    await db.authChallenge.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    const res = await verifyRoute(post("/api/auth/otp/verify", { phone: "08035550105", code: lastSmsCode() }), ctx);
    expect(res.status).toBe(400);
  });

  it("allows 5 codes per phone per hour, then 429 with Retry-After seconds", async () => {
    for (let i = 0; i < 5; i++) {
      expect((await requestRoute(post("/api/auth/otp/request", { phone: "08035550106" }), ctx)).status).toBe(200);
    }
    const sixth = await requestRoute(post("/api/auth/otp/request", { phone: "08035550106" }), ctx);
    expect(sixth.status).toBe(429);
    const body = await sixth.json();
    expect(body.error.code).toBe("otp_rate_limited");
    expect(body.error.details.retryAfterSeconds).toBeGreaterThan(3500);
    expect(vi.mocked(sendSms)).toHaveBeenCalledTimes(5);
  });

  it("validates input", async () => {
    const bad = await requestRoute(post("/api/auth/otp/request", { phone: "12" }), ctx);
    expect(bad.status).toBe(422);
    expect((await bad.json()).error.details.fields.phone).toBeDefined();

    const both = await requestRoute(post("/api/auth/otp/request", { phone: "08035550107", email: "a@b.co" }), ctx);
    expect(both.status).toBe(422);

    const shortCode = await verifyRoute(post("/api/auth/otp/verify", { phone: "08035550107", code: "123" }), ctx);
    expect(shortCode.status).toBe(422);
  });
});

describe("email magic link", () => {
  it("emails a link carrying the code, and the code signs the user in", async () => {
    await requestRoute(post("/api/auth/otp/request", { email: "Ada@Example.com" }), ctx);
    const message = vi.mocked(sendEmail).mock.calls[0]![0];
    expect(message.to).toBe("ada@example.com");

    const link = new URL(message.text.split("\n").find((l) => l.startsWith("http"))!);
    expect(link.pathname).toBe("/auth/magic");
    expect(link.searchParams.get("email")).toBe("ada@example.com");

    const res = await verifyRoute(
      post("/api/auth/otp/verify", { email: link.searchParams.get("email"), code: link.searchParams.get("code") }),
      ctx,
    );
    expect(res.status).toBe(200);
    const user = await db.user.findUniqueOrThrow({ where: { email: "ada@example.com" } });
    expect(user.emailVerifiedAt).not.toBeNull();
  });
});
