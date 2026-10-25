const LAGOS_TZ = "Africa/Lagos";

export function formatDate(date: Date, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }) {
  return new Intl.DateTimeFormat("en-NG", { timeZone: LAGOS_TZ, ...opts }).format(date);
}

export function formatDateTime(date: Date) {
  return formatDate(date, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

/** Whole days left until `until`, never negative. 0 means "closes today". */
export function daysUntil(until: Date, now = new Date()): number {
  return Math.max(0, Math.ceil((until.getTime() - now.getTime()) / 86_400_000));
}

/** Midnight in Lagos (UTC+1, no DST) for the day containing `now`, as a UTC Date. */
export function startOfLagosDay(now = new Date()): Date {
  const offsetMs = 60 * 60 * 1000;
  const dayMs = 86_400_000;
  return new Date(Math.floor((now.getTime() + offsetMs) / dayMs) * dayMs - offsetMs);
}

export function relativeTime(date: Date, now = new Date()): string {
  const seconds = Math.round((now.getTime() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return formatDate(date, { day: "numeric", month: "short" });
}
