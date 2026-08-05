export const APP_TIMEZONE = "Asia/Kolkata";
/** +05:30, and no DST — ever. Asia/Kolkata has had exactly one offset for its
 * whole modern history, verified across three years of instants in
 * tests/app-timezone.test.ts. That is what lets every day boundary in this app
 * be fixed-offset arithmetic instead of an Intl round trip, which is roughly
 * thirty times slower per cell and returns strings that must be re-parsed. */
const APP_OFFSET_MS = 330 * 60 * 1000;

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
  return new Intl.DateTimeFormat("en-CA", { timeZone: APP_TIMEZONE }).format(d);
}

/** `<input type="time">` submits "HH:MM" and nothing else. Same
 * treat-it-as-absent contract as parseDateInput: a two-digit hour 00-23 and
 * a two-digit minute 00-59, joined by a colon, or the value is absent
 * rather than guessed at. "9", "9:5", "25:00" and "12:60" are all refused —
 * clamping any of them to something plausible would turn a tampered
 * "25:99" into an instant nobody chose instead of the rejection it earned. */
const TIME_INPUT = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** The only parser for time-input values. Returns minutes since
 * app-midnight, not a Date — there is no calendar day in "15:00" for a Date
 * to attach to, so the caller that has one (appDateTime, below) is the one
 * that combines the two. */
export function parseTimeInput(value: string): number | null {
  const trimmed = value.trim();
  const match = TIME_INPUT.exec(trimmed);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** The only way to repopulate a time input from a stored instant. Same
 * Intl call appTimeLabel makes below — both need the identical zero-padded
 * 24-hour "HH:MM" shape, appTimeLabel because that is the display
 * convention this file has already picked, this one because it is
 * literally what <input type="time"> requires back. A second,
 * separately-configured Intl.DateTimeFormat here was rejected: it would
 * either drift from appTimeLabel's the day someone edits just one of them,
 * or sit beside it as the same four options copied for no reason. Kept as
 * its own export anyway, because the two callers are reading different
 * contracts out of the same string — one a label, one a form value — and a
 * future divergence in either should not have to fight the other's name. */
export function toTimeInputValue(d: Date): string {
  return appTimeLabel(d);
}

/** The write-side pair, and the only place in this app a wall-clock time
 * becomes a stored instant (D5) — no other call site is allowed to do this
 * arithmetic itself. Null if either half fails to parse; never a partial
 * write built from a guessed date or a guessed time.
 *
 * parseDateInput's result is UTC midnight of the calendar day, not app
 * midnight — its own comment above says so. Adding minutes-since-app-
 * midnight straight to that would be wrong by the 5:30 offset for every
 * time before 18:30 IST: "15:00" would land at Aug-5T15:00Z, which reads
 * back as 20:30 IST, not 15:00. Routing the parsed date through
 * startOfAppDay first collapses it to the actual app-midnight instant for
 * that calendar day — 18:30Z on the *previous* UTC day — which is the zero
 * point minutes-since-app-midnight is measured from. */
export function appDateTime(date: string, time: string): Date | null {
  const parsedDate = parseDateInput(date);
  const minutes = parseTimeInput(time);
  if (!parsedDate || minutes === null) return null;
  return new Date(startOfAppDay(parsedDate).getTime() + minutes * 60_000);
}

/** "12 Jun" — locale and timezone pinned so the string is stable everywhere. */
export function shortDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: APP_TIMEZONE });
}

/** "Mar 2024" — same pinning as shortDate. */
export function monthYear(d: Date): string {
  return d.toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: APP_TIMEZONE });
}

/** "15:00" — 24-hour, en-GB, matching every other pinned formatter above.
 * `hour12: false` was chosen over picking a convention and a locale that
 * spells out am/pm: 24-hour sidesteps the question rather than answering it,
 * which is what every other timestamp in this file already does. */
export function appTimeLabel(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: APP_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

/** The first instant of the app day containing `d`.
 *
 * Its RESULT is an app-midnight instant, which is 18:30Z on the previous
 * calendar day — surprising the first time, and the reason getUTCDate() and
 * friends are wrong on anything this returns. Read app-local fields with the
 * accessors below instead. */
export function startOfAppDay(d: Date): Date {
  const DAY = 24 * 60 * 60 * 1000;
  return new Date(Math.floor((d.getTime() + APP_OFFSET_MS) / DAY) * DAY - APP_OFFSET_MS);
}

/** App-local calendar fields. Numbers, deliberately: exporting the shifted
 * Date was rejected because the first person to store one or compare it
 * against a real timestamp gets a five-and-a-half-hour bug with no symptom. */
const shifted = (d: Date) => new Date(d.getTime() + APP_OFFSET_MS);
export const appWeekday = (d: Date) => shifted(d).getUTCDay();
export const appYear = (d: Date) => shifted(d).getUTCFullYear();
export const appMonth = (d: Date) => shifted(d).getUTCMonth();
export const appDayOfMonth = (d: Date) => shifted(d).getUTCDate();

/** Fixed 86 400 000 ms arithmetic — exact here because the app zone has no
 * DST. In a DST zone this line would be the whole problem; here it is the
 * whole saving. */
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
