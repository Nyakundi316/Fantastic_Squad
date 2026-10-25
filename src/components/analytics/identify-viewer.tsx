"use client";

import { useEffect } from "react";
import { identify, startAnalytics } from "@/lib/analytics";

/** Ties analytics events to the signed-in account by id and role only. */
export function IdentifyViewer({ userId, role }: { userId: string; role: string }) {
  useEffect(() => {
    startAnalytics();
    identify(userId, role);
  }, [userId, role]);
  return null;
}
