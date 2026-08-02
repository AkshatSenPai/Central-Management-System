import type { TaskListRow } from "@/lib/task-queries";

/** Everything here is pure and takes `now` explicitly, so the tests can pin a
 * date instead of hoping the suite never runs across midnight. */

/** Stored due dates are UTC midnight — `parseDateInput` guarantees it — so
 * every comparison in this file is a UTC calendar-day comparison. Doing it in
 * local time would put a task due "today" into the overdue bucket for anyone
 * west of UTC for part of the day. */
export function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 24 * 60 * 60 * 1000);
}

/** "Wednesday, 29 July" — the design's subtitle for the Today section.
 *
 * Assembled from three single-field lookups rather than one combined
 * toLocaleDateString call, because en-GB's combined `weekday, day, month`
 * pattern has no comma in Node's ICU ("Wednesday 29 July") and does have one
 * elsewhere. Formatting a fixed design string through a pattern that varies
 * by runtime means the server and the browser can render it differently.
 * Month and weekday names still come from Intl; only the joining is ours. */
export function todayLabel(now: Date): string {
  const weekday = now.toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
  const month = now.toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" });
  return `${weekday}, ${now.getUTCDate()} ${month}`;
}

export type DashboardBuckets = {
  overdue: TaskListRow[];
  today: TaskListRow[];
};

/** Splits the viewer's open tasks into the two lists the design leads with.
 *
 * The buckets are disjoint: an overdue task appears in Overdue and nowhere
 * else. Listing it under Today as well would double the apparent workload and
 * bury the one signal the overdue callout exists to raise.
 *
 * Input order is preserved — `listAssignedTasks` has already applied
 * `sortMyTasks` (due date, then priority), and re-sorting here would silently
 * contradict the order the same tasks appear in on /my-tasks.
 */
export function bucketMyTasks(rows: TaskListRow[], now: Date): DashboardBuckets {
  const today = startOfUtcDay(now);
  const tomorrow = addDays(today, 1);

  return {
    overdue: rows.filter((r) => r.dueDate !== null && r.dueDate.getTime() < today.getTime()),
    today: rows.filter(
      (r) =>
        r.dueDate !== null &&
        r.dueDate.getTime() >= today.getTime() &&
        r.dueDate.getTime() < tomorrow.getTime()
    ),
  };
}

export type WeekStats = {
  assigned: number;
  dueSoon: number;
  overdue: number;
  completed: number;
};

/** The four figures in the design's This-week card.
 *
 * `rows` is open work only (status != DONE), which is what `listAssignedTasks`
 * returns by default, so `assigned` is an open-task count rather than a
 * lifetime total that only ever grows.
 *
 * `completed` cannot be derived from these rows: Task has no completedAt
 * column, and updatedAt moves whenever anything on the task is edited, so
 * counting DONE tasks by updatedAt would count a typo fix as a completion. It
 * is passed in, counted from the activity log — see countCompletedSince.
 */
export function weekStats(rows: TaskListRow[], completed: number, now: Date): WeekStats {
  const today = startOfUtcDay(now);
  const horizon = addDays(today, 7);

  return {
    assigned: rows.length,
    // Due within the next seven days, today included. Overdue work is
    // deliberately excluded — it has its own figure directly below, and
    // counting it twice makes the two numbers disagree with their labels.
    dueSoon: rows.filter(
      (r) =>
        r.dueDate !== null &&
        r.dueDate.getTime() >= today.getTime() &&
        r.dueDate.getTime() < horizon.getTime()
    ).length,
    overdue: rows.filter((r) => r.dueDate !== null && r.dueDate.getTime() < today.getTime()).length,
    completed,
  };
}
