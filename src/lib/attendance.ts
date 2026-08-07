import type { BadgeKind } from "@/lib/badges";
import { startOfAppDay } from "@/lib/dates";

/** Pure attendance rules — no Prisma, no session, so every predicate here
 * unit-tests without a database.
 *
 * **Attendance is presence, not hours** (owner ruling, 2026-08-07). Punch in
 * and you are Active; punch out and you are Offline. Nothing sums a duration,
 * displays one, or asks anybody to supply one.
 *
 * That single decision is why this file has no `sessionMs`, no day total, no
 * `formatDuration` and no end-time validation. It also removed the whole
 * forgotten-punch-out correction flow: that existed to make a *duration*
 * accurate, and asking "when did you finish?" is pointless when the answer
 * feeds nothing. A stale session is closed on the next punch-in instead.
 *
 * The rows still carry `startedAt` and `endedAt`, because a session cannot
 * exist without knowing when it began and those columns cost nothing. They are
 * the record; no surface reads them as a number. If hours are ever wanted, the
 * history is there — which is the reason not to drop the columns. */

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
