import type { BadgeKind } from "@/lib/badges";
import { startOfAppDay } from "@/lib/dates";

/** Pure attendance rules — no Prisma, no session, so every predicate here
 * unit-tests without a database.
 *
 * **Presence first, hours second.** The 2026-08-07 ruling was that attendance
 * records presence and that nothing sums a duration — which is why this file
 * once said, in as many words, that it had no `sessionMs`, no day total and no
 * `formatDuration`. On 2026-08-10 the owner reversed that second half for an
 * admin view, so those functions now exist. The comment was rewritten rather
 * than extended: one that confidently contradicts the code beneath it is worse
 * than none.
 *
 * What did **not** change, and still governs everything below:
 *
 * - **The app never invents an end time.** A forgotten punch-out is absorbed by
 *   the next punch-in as DISCARDED, with `endedAt` left null forever, because
 *   nobody knows when that person actually left.
 * - **A session with no end therefore has no duration.** `sessionDuration`
 *   returns null, never 0, and `dayTotal` counts those separately. A zero would
 *   flow into a sum and quietly under-report every forgotten punch-out — the
 *   one way this feature can lie.
 * - **Attendance never references `Task`**, and nothing derives a per-task
 *   duration from it. That ruling stands; per-task timers are dropped, not
 *   deferred.
 * - **Presence is still the whole of what one member sees about another.** The
 *   durations here are for the admin grid, not for `/team`.
 *
 * The forgotten-punch-out *correction* flow stays deleted. It existed to make a
 * duration accurate by asking "when did you finish?", and the answer would now
 * be an invented end time — which is the one rule that did not move. */

export const ATTENDANCE_RESOLUTIONS = ["PUNCH_OUT", "DISCARDED"] as const;
export type AttendanceResolution = (typeof ATTENDANCE_RESOLUTIONS)[number];

export const ATTENDANCE_RESOLUTION_LABEL: Record<AttendanceResolution, string> = {
  PUNCH_OUT: "Punched out",
  DISCARDED: "Left open",
};

/** The shape every rule here reads. Deliberately narrower than the Prisma row:
 * these functions must not be able to see a member id, so they cannot grow an
 * access-control decision by accident. */
export type AttendanceSessionLike = {
  startedAt: Date;
  resolution: AttendanceResolution | null;
};

/** Open means "not yet resolved" — **never** `endedAt === null`.
 *
 * A session closed as DISCARDED keeps a null `endedAt` forever, because nobody
 * knows when that person actually left. Keying openness off `endedAt` would
 * leave such a row looking open for good: it would hold the one open slot the
 * database's partial unique index permits, and lock that person out of
 * punching in ever again. */
export function isOpen(session: AttendanceSessionLike): boolean {
  return session.resolution === null;
}

export function isSameAppDay(a: Date, b: Date): boolean {
  return startOfAppDay(a).getTime() === startOfAppDay(b).getTime();
}

/** Active is derived at read time and writes nothing.
 *
 * There is no cron in this app — `vercel.json` declares only `regions` — so
 * any design that "closes stale sessions overnight" would never run and leave
 * people showing Active for days. Deriving it means the rule holds with no
 * moving parts.
 *
 * The corollary is deliberate: somebody who punches in at 23:50 shows Offline
 * from midnight. Since nothing counts hours, that costs nothing — and their
 * next punch-in simply clears the old session. */
export function isActive(session: AttendanceSessionLike, now: Date): boolean {
  return isOpen(session) && isSameAppDay(session.startedAt, now);
}

/** Open, but from an earlier app day: somebody forgot to punch out. Nothing is
 * asked of them — `punchIn` closes it and starts a fresh one. */
export function isStale(session: AttendanceSessionLike, now: Date): boolean {
  return isOpen(session) && !isSameAppDay(session.startedAt, now);
}

export const PRESENCE_LABEL = { active: "Active", offline: "Offline" } as const;

export const PRESENCE_BADGE: Record<"active" | "offline", BadgeKind> = {
  active: "ok",
  offline: "neutral",
};

/** What one member's card shows, and the whole of what anybody sees about
 * anybody else: Active or Offline. No start time, no elapsed count, no total.
 * Presence is the entire feature. */
export function presenceOf(
  openSession: AttendanceSessionLike | null,
  now: Date
): { label: string; badge: BadgeKind } {
  const active = openSession !== null && isActive(openSession, now);
  return {
    label: active ? PRESENCE_LABEL.active : PRESENCE_LABEL.offline,
    badge: active ? PRESENCE_BADGE.active : PRESENCE_BADGE.offline,
  };
}

/** Adds the end to `AttendanceSessionLike`. Still **no member id**: like the
 * type it extends, these rules must not be able to grow an access-control
 * decision by accident. */
export type AttendanceSpanLike = AttendanceSessionLike & { endedAt: Date | null };

/** Milliseconds between the punches, or **null when there was no punch-out**.
 *
 * Null and never 0, and this is the load-bearing line of the whole feature. A
 * DISCARDED session keeps a null `endedAt` forever by the ruling above, so a
 * zero here would be summed silently and under-report every forgotten
 * punch-out. Returning null forces every caller to decide what to do about it. */
export function sessionDuration(span: AttendanceSpanLike): number | null {
  if (span.endedAt === null) return null;
  return span.endedAt.getTime() - span.startedAt.getTime();
}

/** What can be summed, and a count of what cannot. Never collapses the two:
 * `{ ms: 0, unclosed: 1 }` is a day with no punch-out, which is a different
 * claim from a day of no work. */
export function dayTotal(spans: AttendanceSpanLike[]): { ms: number; unclosed: number } {
  let ms = 0;
  let unclosed = 0;
  for (const span of spans) {
    const duration = sessionDuration(span);
    if (duration === null) unclosed += 1;
    else ms += duration;
  }
  return { ms, unclosed };
}

/** "6h 10m", "3h", "45m".
 *
 * A caller with `ms === 0` and unclosed sessions must render the no-punch-out
 * marker instead of calling this — "0h" would be exactly the lie the null in
 * `sessionDuration` exists to prevent. */
export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60000);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  if (rest === 0) return `${hours}h`;
  return `${hours}h ${rest}m`;
}
