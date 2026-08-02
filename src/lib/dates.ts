/** `<input type="date">` submits "YYYY-MM-DD" and nothing else. Anything that
 * does not match is treated as absent rather than guessed at. */
const DATE_INPUT = /^\d{4}-\d{2}-\d{2}$/;

/** The only parser for date-input values. Returns UTC midnight so a stored
 * date means the same calendar day in every timezone. */
export function parseDateInput(value: string): Date | null {
  const trimmed = value.trim();
  if (!DATE_INPUT.test(trimmed)) return null;
  const parsed = new Date(`${trimmed}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** The only way to repopulate a date input from a stored value. */
export function toDateInputValue(d: Date | null): string {
  if (!d) return "";
  return d.toISOString().slice(0, 10);
}

/** "12 Jun" — locale and timezone pinned so the string is stable everywhere. */
export function shortDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

/** "Mar 2024" — same pinning as shortDate. */
export function monthYear(d: Date): string {
  return d.toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
}

/** Stored due dates are UTC midnight — parseDateInput guarantees it — so every
 * calendar comparison in the app is a UTC calendar-day comparison. Doing it in
 * local time would put a task due "today" into yesterday for anyone west of
 * UTC, which is the overdue bucket.
 *
 * Lived in dashboard.ts until Phase 4; moved here so the calendar does not
 * import a dashboard module to ask what day it is. */
export function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 24 * 60 * 60 * 1000);
}

/** Instant-granular: a task due at UTC midnight today is "overdue" one
 * millisecond later. Correct for a deadline, wrong for a calendar cell — see
 * isOverdueOnDay in calendar.ts, which compares whole days instead. */
export function isOverdue(due: Date | null, now: Date = new Date()): boolean {
  if (!due) return false;
  return due.getTime() < now.getTime();
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function relativeTime(at: Date, now: Date = new Date()): string {
  const elapsed = now.getTime() - at.getTime();
  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h ago`;
  if (elapsed < 30 * DAY) return `${Math.floor(elapsed / DAY)}d ago`;
  return shortDate(at);
}
