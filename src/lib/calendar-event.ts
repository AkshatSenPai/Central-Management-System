import { appTimeLabel } from "@/lib/dates";

/** Pure calendar-event formatting and layout helpers. This is the only
 * unit-testable surface calendar events have — components cannot be rendered
 * in this repo (`vitest.config.ts` has no DOM environment) — so every rule
 * that must not drift between what a cell renders and what it counts belongs
 * here, not in a `.tsx`. No Prisma import, no React import: everything below
 * takes plain objects so a test fixture never needs a fake Prisma client to
 * exercise it. */

/** The calendar page's subtitle: `N tasks due · M events in this period`,
 * each side pluralised on its own. Replaces two nested ternaries that used
 * to sit on the page itself — collapsing them into one function is what
 * guarantees the task half and the event half get the same treatment,
 * instead of relying on whoever edits one ternary to remember the other. */
export function calendarPeriodSummary(taskCount: number, eventCount: number): string {
  const taskWord = taskCount === 1 ? "task" : "tasks";
  const eventWord = eventCount === 1 ? "event" : "events";
  return `${taskCount} ${taskWord} due · ${eventCount} ${eventWord} in this period`;
}

/** A start time for a timed event, and nothing with a clock face at all for
 * an all-day one. An all-day event's stored bounds are app-midnight to
 * app-midnight — a fact about how the row is stored, not a time anyone
 * chose — so printing "00:00" next to "Priya on leave" would report the
 * storage artefact as if it were the event. `endsAt` is accepted but not yet
 * used: a later surface renders a full "start – end" range, and taking the
 * whole row now means this signature will not need to change shape when that
 * lands. */
export function eventTimeLabel(event: { startsAt: Date; endsAt: Date; allDay: boolean }): string {
  if (event.allDay) return "All day";
  return appTimeLabel(event.startsAt);
}

/** Splits a day's events into the two regions the day/week view renders
 * separately: the untimed band and the hour timeline. Named `timed` /
 * `allDay` after the flag each bucket is keyed on, rather than `untimed`,
 * so a reader matching a bucket to the test that produced it never has to
 * cross-reference — `allDay` here is exactly `row.allDay === true`. Order is
 * preserved within each half rather than re-sorted, because the query that
 * built the input already carries its own order (§6: `[allDay desc, startsAt
 * asc, createdAt asc]`) and this function's job is to partition, not rank.
 * Generic rather than typed at `CalendarEventRow` so this file stays
 * Prisma-free — anything with an `allDay` flag can be split, including a
 * bare test fixture. */
export function splitDayEvents<T extends { allDay: boolean }>(
  events: T[]
): { timed: T[]; allDay: T[] } {
  const timed: T[] = [];
  const allDay: T[] = [];
  for (const event of events) {
    (event.allDay ? allDay : timed).push(event);
  }
  return { timed, allDay };
}

/** Caps a month cell at `limit` rows TOTAL across both kinds — not `limit`
 * of each — with events filling first and tasks taking whatever remains.
 * `overflow` counts everything dropped from both. Pure precisely so the
 * truncation rule cannot drift between the two row lists a cell renders and
 * the "+N more" count next to them: a cell that computed those separately
 * could easily update one on a cap change and forget the other. */
export function monthCellRows<E, T>(
  events: E[],
  tasks: T[],
  limit: number
): { events: E[]; tasks: T[]; overflow: number } {
  const shownEvents = events.slice(0, limit);
  const shownTasks = tasks.slice(0, Math.max(limit - shownEvents.length, 0));
  const overflow = events.length - shownEvents.length + (tasks.length - shownTasks.length);
  return { events: shownEvents, tasks: shownTasks, overflow };
}

/** A compact text label for an attendee list: up to three initials,
 * comma-separated, with anything past that folded into a trailing count —
 * the same cap-and-report shape `capAssignees` (`task.ts:139`) already uses
 * for avatar stacks, applied here to plain text instead of rendered circles,
 * because the surfaces this feeds (a month chip, a timeline box) have room
 * for a word, not a row of avatars. Returns "" for no attendees rather than
 * a placeholder dash — an event with nobody named on it, like "Priya on
 * leave", has nothing to report here. */
export function attendeeInitialsLabel(attendees: { initials: string }[]): string {
  const MAX_SHOWN = 3;
  if (attendees.length === 0) return "";
  const shown = attendees.slice(0, MAX_SHOWN).map((a) => a.initials);
  const extra = attendees.length - MAX_SHOWN;
  return extra > 0 ? `${shown.join(", ")} +${extra}` : shown.join(", ");
}
