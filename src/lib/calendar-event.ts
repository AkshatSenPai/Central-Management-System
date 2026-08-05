import { appTimeLabel, startOfAppDay } from "@/lib/dates";

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

/** "15:00 – 16:00" for a timed event — the same en-dash `calendarTitle` uses
 * (`calendar.ts:129`) rendering both ends in the app zone — and the literal
 * string "All day" for an all-day one. An all-day event's stored bounds are
 * app-midnight to app-midnight — a fact about how the row is stored, not a
 * time anyone chose — so printing "00:00 – 00:00" next to "Priya on leave"
 * would report the storage artefact as if it were the event. */
export function eventTimeLabel(event: { startsAt: Date; endsAt: Date; allDay: boolean }): string {
  if (event.allDay) return "All day";
  return `${appTimeLabel(event.startsAt)} – ${appTimeLabel(event.endsAt)}`;
}

/** Splits a day's events into the two regions the day/week view renders
 * separately: `untimed` for the band under the column header — which will
 * later carry due tasks too, things with no clock, of which an all-day event
 * is only one kind — and `timed` for the hour timeline below it. Order is
 * preserved within each half rather than re-sorted, because the query that
 * built the input already carries its own order (§6: `[allDay desc, startsAt
 * asc, createdAt asc]`) and this function's job is to partition, not rank.
 * Generic rather than typed at `CalendarEventRow` so this file stays
 * Prisma-free — anything with an `allDay` flag can be split, including a
 * bare test fixture. */
export function splitDayEvents<T extends { allDay: boolean }>(
  events: T[]
): { untimed: T[]; timed: T[] } {
  const timed: T[] = [];
  const untimed: T[] = [];
  for (const event of events) {
    (event.allDay ? untimed : timed).push(event);
  }
  return { untimed, timed };
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

/** The grid's per-event contract (spec §6). Declared here rather than in
 * `calendar-event-queries.ts` — which is where the spec assigns it — because
 * that file does not exist yet in this step's task order and the three
 * timeline functions below need the exact shape spec `:429-431` types them
 * against. When the queries file lands it should import this type rather
 * than redeclare it: duplicating the field list in two places is the
 * alternative, and the one a later edit to either copy would silently drift
 * out of sync with. */
export type CalendarEventRow = {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  creatorId: string;
  projectId: string | null;
  projectName: string | null;
  clientId: string | null;
  clientName: string | null;
  attendees: Array<{ id: string; name: string; initials: string }>;
};

const MINUTES_PER_HOUR = 60;
const DEFAULT_TIMELINE_START_HOUR = 8;
const DEFAULT_TIMELINE_END_HOUR = 19;

/** Minutes since app-midnight for `d`, fractional. `startOfAppDay` already
 * carries the fixed +05:30 offset (D2) and already knows which app day `d`
 * falls on, so subtracting its instant from `d` reads the app-zone clock
 * without this file re-deriving the offset constant `dates.ts` keeps
 * private — hardcoding 330 minutes a second place is exactly the drift D2's
 * "one distinct offset, verified" proof exists to rule out. Not exported:
 * nothing outside the timeline geometry below needs "minutes since
 * midnight" as a standalone value. */
function minutesSinceAppMidnight(d: Date): number {
  return (d.getTime() - startOfAppDay(d).getTime()) / 60_000;
}

/** The hour range the day/week timeline draws, in app-zone hours: 08:00–19:00
 * by default, widening — never narrowing — to fit whatever timed events are
 * on screen. Floors the earliest start and ceils the latest end, so a 06:30
 * start opens the grid at 06:00 rather than splitting an hour row in half,
 * and a 20:15 end closes it at 21:00 rather than stopping short of the
 * meeting it is drawing. One window for the whole array no matter how many
 * distinct app days its rows fall on: §7 computes it once "across every day
 * on screen" precisely so a week's seven columns keep their hour rows
 * aligned — a per-column window was rejected there for breaking that.
 *
 * Takes `timed` rather than the raw event list, and filters any `allDay`
 * row that reaches it anyway. An all-day event's stored bounds are
 * app-midnight to app-midnight (D5) — the widest span expressible — so a
 * single "Priya on leave" left in the input would drag the window to
 * 00:00–24:00 for a row the timeline does not even draw. `ColumnsView` is
 * expected to call this as `timelineWindow(splitDayEvents(events).timed)`
 * (§7), but the filter here is what makes that a guarantee rather than a
 * hope resting on every future call site remembering to pre-filter. */
export function timelineWindow(timed: CalendarEventRow[]): { startHour: number; endHour: number } {
  let startHour = DEFAULT_TIMELINE_START_HOUR;
  let endHour = DEFAULT_TIMELINE_END_HOUR;
  for (const event of timed) {
    if (event.allDay) continue;
    const startMinutes = minutesSinceAppMidnight(event.startsAt);
    const endMinutes = minutesSinceAppMidnight(event.endsAt);
    startHour = Math.min(startHour, Math.floor(startMinutes / MINUTES_PER_HOUR));
    endHour = Math.max(endHour, Math.ceil(endMinutes / MINUTES_PER_HOUR));
  }
  return { startHour, endHour };
}

/** An event's box within `window`, as percentages of the window's height —
 * not pixels, because a pure function has no way to know how tall the
 * column it will be drawn in ends up, and computing one anyway would make
 * the arithmetic depend on layout. No minimum is applied here: a 15-minute
 * call yields its true, tiny `heightPct` rather than a floor value invented
 * to keep the box clickable. That floor belongs in CSS (`min-h-[22px]`,
 * §7) precisely because it is a rendering concern and this is not one. */
export function eventPosition(
  event: CalendarEventRow,
  window: { startHour: number; endHour: number }
): { topPct: number; heightPct: number } {
  const windowMinutes = (window.endHour - window.startHour) * MINUTES_PER_HOUR;
  const windowStartMinutes = window.startHour * MINUTES_PER_HOUR;
  const startMinutes = minutesSinceAppMidnight(event.startsAt);
  const endMinutes = minutesSinceAppMidnight(event.endsAt);
  const topPct = ((startMinutes - windowStartMinutes) / windowMinutes) * 100;
  const heightPct = ((endMinutes - startMinutes) / windowMinutes) * 100;
  return { topPct, heightPct };
}

/** Lays overlapping events side by side within a day column: a single sweep
 * over events sorted by start, placing each in the first lane whose last
 * assigned end is `<=` its own start — half-open `[start, end)`, so an
 * event starting exactly when the previous one ends is not overlapping it,
 * and the two are free to share a lane (D5's convention, reused rather than
 * re-argued here).
 *
 * `laneCount` is the width of the event's own overlapping CLUSTER — found
 * by walking the start-sorted events and merging each into the running
 * cluster whenever its start falls before the cluster's current latest end,
 * the same grouping "merge overlapping intervals" uses generally — not a
 * single running total carried across the whole array. A running total was
 * the rejected alternative: it would let an unrelated pair of events
 * elsewhere in the day, or a third event that only overlaps the second and
 * never the first, change every other event's reported width even though
 * their boxes never actually share a row. */
export function assignLanes(
  events: CalendarEventRow[]
): Array<{ id: string; lane: number; laneCount: number }> {
  const sorted = [...events].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const results: Array<{ id: string; lane: number; laneCount: number }> = [];

  let cluster: CalendarEventRow[] = [];
  let clusterEnd = -Infinity;

  const flushCluster = () => {
    if (cluster.length === 0) return;
    const laneEnds: number[] = [];
    const lanes: number[] = [];
    for (const event of cluster) {
      const start = event.startsAt.getTime();
      const end = event.endsAt.getTime();
      const openLane = laneEnds.findIndex((laneEnd) => laneEnd <= start);
      const lane = openLane === -1 ? laneEnds.length : openLane;
      laneEnds[lane] = end;
      lanes.push(lane);
    }
    const laneCount = laneEnds.length;
    cluster.forEach((event, i) => results.push({ id: event.id, lane: lanes[i], laneCount }));
    cluster = [];
    clusterEnd = -Infinity;
  };

  for (const event of sorted) {
    if (cluster.length > 0 && event.startsAt.getTime() >= clusterEnd) {
      flushCluster();
    }
    cluster.push(event);
    clusterEnd = Math.max(clusterEnd, event.endsAt.getTime());
  }
  flushCluster();

  return results;
}
