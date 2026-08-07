import type { BadgeKind } from "@/lib/badges";
import { startOfAppDay } from "@/lib/dates";

/** Pure attendance rules — no Prisma, no session, so every predicate here
 * unit-tests without a database.
 *
 * The whole feature rests on one owner ruling from 2026-08-07: **the app never
 * invents an end time.** Almost every rule below is a consequence of it, and
 * the ones that look pedantic are the ones that stop a guess creeping in. */

export const ATTENDANCE_RESOLUTIONS = ["PUNCH_OUT", "CORRECTED", "DISCARDED"] as const;
export type AttendanceResolution = (typeof ATTENDANCE_RESOLUTIONS)[number];

export const ATTENDANCE_RESOLUTION_LABEL: Record<AttendanceResolution, string> = {
  PUNCH_OUT: "Punched out",
  CORRECTED: "Ended later",
  DISCARDED: "Not counted",
};

/** The shape every rule here reads. Deliberately narrower than the Prisma row:
 * these functions must not be able to see a member id, so they cannot grow an
 * access-control decision by accident. */
export type AttendanceSessionLike = {
  startedAt: Date;
  endedAt: Date | null;
  resolution: AttendanceResolution | null;
};

/** Open means "not yet resolved" — **never** `endedAt === null`.
 *
 * A DISCARDED session keeps a null `endedAt` forever, because nobody knows
 * when that person left and inventing a time is banned. Keying openness off
 * `endedAt` would therefore leave a discarded row looking open for good: it
 * would hold the one open slot the database's partial unique index permits,
 * and lock that person out of punching in ever again. */
export function isOpen(session: AttendanceSessionLike): boolean {
  return session.resolution === null;
}

export function isSameAppDay(a: Date, b: Date): boolean {
  return startOfAppDay(a).getTime() === startOfAppDay(b).getTime();
}

/** Active is derived at read time and writes nothing.
 *
 * There is no cron in this app — `vercel.json` declares only `regions`, and
 * the reminder job `TASK_DUE_SOON` anticipates was never built — so any design
 * that "closes stale sessions overnight" would in practice never run and leave
 * people Active for days. Deriving it instead means the rule holds with no
 * moving parts.
 *
 * The corollary is worth stating out loud rather than discovering: somebody
 * who punched in at 23:50 flips to Offline at midnight, and their 00:20
 * punch-out still records the true end. That is the price of never guessing,
 * and it is cheaper than the alternative. */
export function isActive(session: AttendanceSessionLike, now: Date): boolean {
  return isOpen(session) && isSameAppDay(session.startedAt, now);
}

/** Open, but from an earlier app day — someone forgot to punch out. This is
 * the only state that raises the correction prompt, and it is exactly the
 * complement of `isActive` within the open sessions. */
export function isUnresolved(session: AttendanceSessionLike, now: Date): boolean {
  return isOpen(session) && !isSameAppDay(session.startedAt, now);
}

/** Milliseconds a session contributes to any total.
 *
 * Zero unless it was genuinely closed with an end time. An open session
 * contributes nothing (there is no end yet), and a DISCARDED one contributes
 * nothing permanently — that is what discarding means. Both fall out of the
 * `endedAt === null` check rather than needing a special case, but DISCARDED
 * is named explicitly anyway: a future edit that back-fills `endedAt` on a
 * discarded row must not silently start counting it. */
export function sessionMs(session: AttendanceSessionLike): number {
  if (session.endedAt === null) return 0;
  if (session.resolution === "DISCARDED") return 0;
  return Math.max(0, session.endedAt.getTime() - session.startedAt.getTime());
}

/** A day's total, summed over the pairs that started on that app day.
 *
 * Attribution is by `startedAt` alone and a session is never split at
 * midnight, so a 22:00→06:00 shift counts entirely on the day it began and the
 * following day reads zero for it. Splitting one real event across two rows is
 * the same class of invention as guessing an end time. */
export function dayMs(sessions: readonly AttendanceSessionLike[], day: Date): number {
  return sessions
    .filter((s) => isSameAppDay(s.startedAt, day))
    .reduce((total, s) => total + sessionMs(s), 0);
}

/** "6h 12m", "48m", "0m". Whole minutes — attendance is not a stopwatch, and a
 * seconds figure would imply a precision a punch button does not have. */
export function formatDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export const PRESENCE_LABEL = { active: "Active", offline: "Offline" } as const;

export const PRESENCE_BADGE: Record<"active" | "offline", BadgeKind> = {
  active: "ok",
  offline: "neutral",
};

/** What one member's card shows. A binary, deliberately: to everybody else a
 * person is Active or Offline and nothing more — no start time, no elapsed
 * count, no day total. Those belong to the member themselves, in the topbar.
 * Broadcasting "punched in 9 hours ago" turns a forgotten punch-out into a
 * daily public embarrassment. */
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

/** The longest a single session may be closed to. Beyond this the person is
 * not remembering, they are guessing, and Discard is the honest control. */
export const MAX_SESSION_MS = 24 * 60 * 60 * 1000;

/** Validates a retroactively supplied end time, returning an error sentence or
 * null.
 *
 * Four distinct messages rather than one generic refusal, matching
 * `validateEventTimes`: each of these is a different mistake and telling
 * someone which one they made is the difference between fixing it and
 * guessing again.
 *
 * Takes `Date`s, not minutes-since-midnight: a correction may legally cross
 * into the next app day (the night shift is real), which a minutes-only value
 * cannot express. */
export function validateCorrectedEnd(
  startedAt: Date,
  end: Date | null,
  now: Date
): string | null {
  // null is what `appDateTime` returns for anything that is not a well-formed
  // date and time. Refused rather than clamped — the dates.ts contract.
  if (end === null) return "Enter a valid date and time.";
  if (end.getTime() <= startedAt.getTime()) return "The end time must be after the start.";
  if (end.getTime() > now.getTime()) return "The end time cannot be in the future.";
  if (end.getTime() - startedAt.getTime() > MAX_SESSION_MS) {
    return "A session cannot run longer than 24 hours. Discard it instead.";
  }
  return null;
}

/** Does a proposed [startedAt, end) overlap any already-closed session?
 *
 * The partial unique index cannot catch this: both rows are closed, so it has
 * no opinion. Two closed sessions claiming the same wall-clock hour would
 * double-count that hour in every total, which is the one way this feature can
 * report a number that is confidently wrong.
 *
 * Half-open, so a session ending exactly when the next begins is fine —
 * punching straight back in after lunch is normal and must not be refused.
 * DISCARDED neighbours are ignored: they contribute nothing to any total, so
 * they cannot double-count anything. */
export function overlapsExisting(
  candidate: { startedAt: Date; endedAt: Date },
  others: readonly AttendanceSessionLike[]
): boolean {
  return others.some((other) => {
    if (other.endedAt === null) return false;
    if (other.resolution === "DISCARDED") return false;
    return (
      candidate.startedAt.getTime() < other.endedAt.getTime() &&
      other.startedAt.getTime() < candidate.endedAt.getTime()
    );
  });
}
