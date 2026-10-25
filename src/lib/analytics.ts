"use client";

import posthog from "posthog-js";

let started = false;

/** PostHog, only when a key is configured. Events carry ids and amounts as strings, never names, phones or emails. */
export function startAnalytics() {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (started || !key || typeof window === "undefined") return;
  posthog.init(key, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://eu.i.posthog.com",
    capture_pageview: false,
    autocapture: false,
    person_profiles: "identified_only",
    mask_all_text: true,
    disable_session_recording: true,
  });
  started = true;
}

export function track(event: string, properties: Record<string, string | number | boolean> = {}) {
  if (started) posthog.capture(event, properties);
}

export function identify(userId: string, role: string) {
  if (started) posthog.identify(userId, { role });
}
