import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import type { Role } from "@/lib/auth/roles";
import { SESSION_COOKIE, signSession } from "@/lib/auth/session";
import { middleware } from "@/middleware";

async function request(path: string, opts: { role?: Role; method?: string; origin?: string } = {}) {
  const headers = new Headers();
  if (opts.role) headers.set("cookie", `${SESSION_COOKIE}=${await signSession({ userId: "u-1", role: opts.role })}`);
  if (opts.origin) headers.set("origin", opts.origin);
  return middleware(new NextRequest(new URL(path, "http://localhost:3000"), { method: opts.method ?? "GET", headers }));
}

const rewriteTarget = (res: Response) => res.headers.get("x-middleware-rewrite");
const passedThrough = (res: Response) => res.headers.get("x-middleware-next") === "1";

describe("page routing", () => {
  it("sends signed-out visitors to login and remembers where they were going", async () => {
    const res = await request("/admin/batches?status=ordered");
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/admin/batches?status=ordered");
  });

  it("requires sign-in for orders, checkout, account and invoices", async () => {
    for (const path of ["/orders", "/orders/abc", "/checkout", "/account", "/invoices/xyz"]) {
      expect((await request(path)).status).toBe(307);
    }
  });

  it("leaves public pages alone", async () => {
    expect(passedThrough(await request("/products/abc"))).toBe(true);
  });

  it("lets admin reach /admin", async () => {
    expect(passedThrough(await request("/admin", { role: "admin" }))).toBe(true);
  });

  it("shows customers a 403 page on /admin", async () => {
    const res = await request("/admin", { role: "customer" });
    expect(res.status).toBe(403);
    expect(rewriteTarget(res)).toContain("/forbidden");
  });

  it("keeps ops out of settings but lets them into batches", async () => {
    expect(rewriteTarget(await request("/admin/settings", { role: "ops" }))).toContain("/forbidden");
    expect(passedThrough(await request("/admin/batches", { role: "ops" }))).toBe(true);
  });

  it("moves signed-in users off the login page", async () => {
    expect(new URL((await request("/login", { role: "finance" })).headers.get("location")!).pathname).toBe("/admin");
    expect(new URL((await request("/login", { role: "customer" })).headers.get("location")!).pathname).toBe("/");
  });
});

describe("API protection", () => {
  it("returns 401 JSON for signed-out admin API calls and 403 for customers", async () => {
    const anon = await request("/api/admin/batches", { method: "POST" });
    expect(anon.status).toBe(401);
    expect(await anon.json()).toMatchObject({ error: { code: "unauthenticated" } });

    const customer = await request("/api/admin/batches", { method: "POST", role: "customer" });
    expect(customer.status).toBe(403);
  });

  it("blocks cross-site mutations but not the payment webhook", async () => {
    const res = await request("/api/orders", { method: "POST", role: "customer", origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect(passedThrough(await request("/api/orders", { method: "POST", role: "customer", origin: "http://localhost:3000" }))).toBe(true);
    expect(passedThrough(await request("/api/payments/webhook", { method: "POST", origin: "https://api.paystack.co" }))).toBe(true);
  });
});

describe("API rate limit", () => {
  it("allows 100 API calls a minute per user, then 429 with Retry-After, and never limits the webhook", async () => {
    const { resetRateLimits } = await import("@/lib/rate-limit");
    resetRateLimits();
    const token = await signSession({ userId: "rate-user", role: "customer" });
    const call = (path: string) =>
      middleware(new NextRequest(new URL(path, "http://localhost:3000"), { headers: { cookie: `${SESSION_COOKIE}=${token}` } }));

    for (let i = 0; i < 100; i++) expect(passedThrough(await call("/api/orders"))).toBe(true);
    const limited = await call("/api/orders");
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);

    // Other users and machine callbacks are unaffected.
    const other = await signSession({ userId: "someone-else", role: "customer" });
    expect(passedThrough(await middleware(new NextRequest("http://localhost:3000/api/orders", { headers: { cookie: `${SESSION_COOKIE}=${other}` } })))).toBe(true);
    expect(passedThrough(await call("/api/payments/webhook"))).toBe(true);
    resetRateLimits();
  });
});
