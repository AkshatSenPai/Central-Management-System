import { addDays, startOfUtcDay } from "@/lib/dates";

/** Everything here is pure and UTC. Stored due dates are UTC midnight —
 * `parseDateInput` guarantees it — so a calendar that bucketed in local time
 * would file a task due "today" under yesterday for every reader west of UTC.
 *
 * Nothing in this file slices an ISO string to get a day. The `dueDate` column
 * is a plain timestamp with no constraint forcing midnight, so a row that ever
 * acquires a time component — a future importer, a seed edit, a raw SQL fix —
 * would land in the wrong cell. Comparing `startOfUtcDay(x).getTime()` is
 * immune to that; string slicing is not. */

export const CALENDAR_VIEWS = ["month", "week", "day"] as const;
export type CalendarView = (typeof CALENDAR_VIEWS)[number];

/** Null means "not specified", so the caller applies its own default — the
 * same contract as `parseTaskStatusFilter` and `parseStatusFilter`. */
export function parseCalendarView(raw: string | string[] | undefined): CalendarView | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;
  return (CALENDAR_VIEWS as readonly string[]).includes(value) ? (value as CalendarView) : null;
}

/** Weeks run Monday to Sunday. `getUTCDay()` is 0 for Sunday, so the shift is
 * `(day + 6) % 7` rather than `day - 1`, which would put Sunday at -1 and pull
 * the grid a week backwards. */
export function startOfUtcWeek(d: Date): Date {
  const day = startOfUtcDay(d);
  return addDays(day, -((day.getUTCDay() + 6) % 7));
}

export function startOfUtcMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/** The half-open range a view covers: `[from, to)`.
 *
 * Half-open, matching the two existing date-range filters in dashboard.ts, so
 * a task due exactly on a boundary lands in one cell and not two.
 *
 * The month range is the whole **grid**, not the calendar month — the grid
 * shows trailing days of the previous month and leading days of the next, and
 * a task shown in a cell must be a task the query actually fetched. */
export function calendarRange(view: CalendarView, anchor: Date): { from: Date; to: Date } {
  if (view === "day") {
    const from = startOfUtcDay(anchor);
    return { from, to: addDays(from, 1) };
  }
  if (view === "week") {
    const from = startOfUtcWeek(anchor);
    return { from, to: addDays(from, 7) };
  }
  const from = startOfUtcWeek(startOfUtcMonth(anchor));
  return { from, to: addDays(from, 42) };
}

/** The six-by-seven grid. Always six rows, never five: a month grid that
 * changes height as you page through the year makes the whole screen jump. */
export function monthGrid(anchor: Date): Date[][] {
  const start = startOfUtcWeek(startOfUtcMonth(anchor));
  return Array.from({ length: 6 }, (_, week) =>
    Array.from({ length: 7 }, (_, day) => addDays(start, week * 7 + day))
  );
}

export function isSameUtcDay(a: Date, b: Date): boolean {
  return startOfUtcDay(a).getTime() === startOfUtcDay(b).getTime();
}

export function isInUtcMonth(d: Date, anchor: Date): boolean {
  return d.getUTCFullYear() === anchor.getUTCFullYear() && d.getUTCMonth() === anchor.getUTCMonth();
}

/** Day-granular, unlike `isOverdue`.
 *
 * `isOverdue` compares instants, so a task due at UTC midnight today counts as
 * overdue one millisecond into the day — correct for a deadline, wrong for a
 * calendar, where it would paint today's whole column red. A calendar cell
 * asks "is this day before today", not "is this instant past". */
export function isOverdueOnDay(due: Date | null, now: Date): boolean {
  if (!due) return false;
  return startOfUtcDay(due).getTime() < startOfUtcDay(now).getTime();
}

/** Groups rows into buckets keyed by UTC-midnight epoch, which is what the
 * grid cells look themselves up by. Undated rows are dropped — the query
 * already excludes them (any gte/lt clause does), and a task with no due date
 * has no cell to sit in. */
export function groupByUtcDay<T extends { dueDate: Date | null }>(rows: T[]): Map<number, T[]> {
  const buckets = new Map<number, T[]>();
  for (const row of rows) {
    if (!row.dueDate) continue;
    const key = startOfUtcDay(row.dueDate).getTime();
    const bucket = buckets.get(key);
    if (bucket) bucket.push(row);
    else buckets.set(key, [row]);
  }
  return buckets;
}

/** The heading above the grid. Locale and timezone pinned, like every other
 * date string in the app. */
export function calendarTitle(view: CalendarView, anchor: Date): string {
  if (view === "day") {
    return anchor.toLocaleDateString("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
  }
  if (view === "week") {
    const from = startOfUtcWeek(anchor);
    const to = addDays(from, 6);
    const same = from.getUTCMonth() === to.getUTCMonth();
    const left = from.toLocaleDateString("en-GB", {
      day: "numeric",
      month: same ? undefined : "short",
      timeZone: "UTC",
    });
    const right = to.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
    return `${left} – ${right}`;
  }
  return anchor.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** The anchor for the previous/next control. Stepping a month from the 31st
 * must not skip February, so month steps go via the first of the month. */
export function stepAnchor(view: CalendarView, anchor: Date, direction: -1 | 1): Date {
  if (view === "day") return addDays(startOfUtcDay(anchor), direction);
  if (view === "week") return addDays(startOfUtcWeek(anchor), direction * 7);
  const first = startOfUtcMonth(anchor);
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + direction, 1));
}

export const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
