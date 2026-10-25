import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { User } from "@prisma/client";
import { isStaff } from "@/lib/auth/roles";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { userFromToken } from "./api-user";

// Server components only. API routes use ./api-user.

export const getViewer = cache(async (): Promise<User | null> => {
  return userFromToken(cookies().get(SESSION_COOKIE)?.value);
});

export async function requireViewer(nextPath: string): Promise<User> {
  const viewer = await getViewer();
  if (!viewer) redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  return viewer;
}

export async function requireStaffViewer(nextPath = "/admin"): Promise<User> {
  const viewer = await requireViewer(nextPath);
  if (!isStaff(viewer.role)) redirect("/forbidden");
  return viewer;
}
