import type { NextRequest } from "next/server";
import type { User } from "@prisma/client";
import { db } from "@/lib/db";
import { can, type Capability } from "@/lib/auth/roles";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import { HttpError } from "@/server/http";

// The JWT role only drives coarse routing in middleware. Authorisation here
// always uses the role stored in the database.

export async function userFromToken(token: string | undefined): Promise<User | null> {
  const claims = await verifySession(token);
  if (!claims) return null;
  return db.user.findUnique({ where: { id: claims.userId } });
}

export function optionalApiUser(req: NextRequest): Promise<User | null> {
  return userFromToken(req.cookies.get(SESSION_COOKIE)?.value);
}

/** The signed-in user, or throws 401 (signed out) / 403 (role lacks the capability). */
export async function requireApiUser(req: NextRequest, capability?: Capability): Promise<User> {
  const user = await optionalApiUser(req);
  if (!user) throw new HttpError(401, "unauthenticated", "Please sign in to continue.");
  if (capability && !can(user.role, capability)) {
    throw new HttpError(403, "forbidden", "Your role does not allow this action.");
  }
  return user;
}
