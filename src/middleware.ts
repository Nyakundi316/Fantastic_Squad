import { NextResponse, type NextRequest } from "next/server";
import { canOpenAdminPath, homeFor, isStaff } from "@/lib/auth/roles";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import { rateLimit } from "@/lib/rate-limit";

// Coarse gate on the JWT role. Pages and API handlers re-check against the
// database, so a stale token can't escalate privileges.

const SIGNED_IN_ONLY = ["/orders", "/checkout", "/account", "/invoices"];
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const ORIGIN_CHECK_EXEMPT = ["/api/payments/webhook"];
// Provider and scheduler callbacks are machine traffic with their own authentication.
const RATE_LIMIT_EXEMPT = ["/api/payments/webhook", "/api/cron"];
const API_LIMIT_PER_MINUTE = 100;

const matchesPrefix = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

function apiError(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);

  if (pathname.startsWith("/api/")) {
    if (!RATE_LIMIT_EXEMPT.some((p) => matchesPrefix(pathname, p))) {
      const client = session ? `user:${session.userId}` : `ip:${req.ip ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown"}`;
      const limit = rateLimit(client, API_LIMIT_PER_MINUTE, 60_000);
      if (!limit.ok) {
        const res = apiError(429, "rate_limited", "Too many requests. Please wait a moment and try again.");
        res.headers.set("Retry-After", String(limit.retryAfterSeconds));
        return res;
      }
    }

    const origin = req.headers.get("origin");
    const crossSite = origin !== null && origin !== req.nextUrl.origin;
    if (MUTATING_METHODS.has(req.method) && crossSite && !ORIGIN_CHECK_EXEMPT.some((p) => matchesPrefix(pathname, p))) {
      return apiError(403, "cross_site_blocked", "Cross-site requests are not allowed.");
    }
    if (matchesPrefix(pathname, "/api/admin")) {
      if (!session) return apiError(401, "unauthenticated", "Please sign in to continue.");
      if (!isStaff(session.role)) return apiError(403, "forbidden", "Staff access only.");
    }
    return NextResponse.next();
  }

  if (pathname === "/login") {
    return session ? NextResponse.redirect(new URL(homeFor(session.role), req.url)) : NextResponse.next();
  }

  const adminArea = matchesPrefix(pathname, "/admin");
  if (!adminArea && !SIGNED_IN_ONLY.some((p) => matchesPrefix(pathname, p))) return NextResponse.next();

  if (!session) {
    const login = new URL("/login", req.url);
    login.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(login);
  }

  if (adminArea && !canOpenAdminPath(session.role, pathname)) {
    return NextResponse.rewrite(new URL("/forbidden", req.url), { status: 403 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/orders/:path*",
    "/checkout/:path*",
    "/account/:path*",
    "/invoices/:path*",
    "/login",
    "/api/:path*",
  ],
};
