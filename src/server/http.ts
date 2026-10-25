import { captureException } from "@sentry/nextjs";
import { NextResponse, type NextRequest } from "next/server";
import type { ZodType, ZodTypeDef } from "zod";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Path ids that aren't UUIDs are treated as not found instead of reaching Postgres. */
export function assertUuid(value: string, what = "Record"): string {
  if (!UUID.test(value)) throw new HttpError(404, "not_found", `${what} not found.`);
  return value;
}

export function errorResponse(status: number, code: string, message: string, details?: Record<string, unknown>) {
  return NextResponse.json({ error: { code, message, ...(details ? { details } : {}) } }, { status });
}

export async function readJson<T>(req: Request, schema: ZodType<T, ZodTypeDef, unknown>): Promise<T> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new HttpError(400, "invalid_json", "Request body must be valid JSON.");
  }
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new HttpError(422, "validation_failed", "Some fields need attention.", {
      fields: result.error.flatten().fieldErrors,
    });
  }
  return result.data;
}

type RouteHandler<Ctx> = (req: NextRequest, ctx: Ctx) => Promise<Response>;

/** Wraps a route handler so thrown HttpErrors become consistent JSON errors. */
export function route<Ctx = { params: Record<string, string> }>(handler: RouteHandler<Ctx>): RouteHandler<Ctx> {
  return async (req, ctx) => {
    try {
      return await handler(req, ctx);
    } catch (err) {
      if (err instanceof HttpError) return errorResponse(err.status, err.code, err.message, err.details);
      // Next.js signals redirects, notFound and dynamic rendering with tagged errors; let them through.
      if (typeof err === "object" && err !== null && "digest" in err) throw err;
      console.error(`[api] ${req.method} ${req.nextUrl.pathname}`, err);
      captureException(err, { tags: { route: req.nextUrl.pathname, method: req.method } });
      return errorResponse(500, "internal_error", "Something went wrong on our side. Please try again.");
    }
  };
}
