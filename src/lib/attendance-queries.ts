import type { PrismaClient } from "@prisma/client";
import { dayTotal, isActive, type AttendanceResolution, type AttendanceSpanLike } from "@/lib/attendance";
import { startOfAppDay } from "@/lib/dates";

/** What the topbar's punch control needs, which since attendance became
 * presence-only is a single boolean.
 *
 * **The topbar still has no elapsed figure**, and that has not changed with the
 * 2026-08-10 reversal: a live counter is something to compute, tick, and
 * accidentally freeze into a prefetched RSC payload. Hours are an admin grid
 * read on demand — see `listAttendanceDays` below — not a clock in the corner
 * of everyone's screen. */
export type PunchState = {
  isPunchedIn: boolean;
};

export async function getPunchState(
  db: PrismaClient,
  memberId: string,
  now: Date = new Date()
): Promise<PunchState> {
  // One query, and it runs inside the app layout's Promise.all — so on every
  // authenticated page load. The partial unique index means at most one row
  // can come back.
  //
  // A session left open on an earlier day deliberately does NOT count as
  // punched in: `isActive` requires the same app day. It is not closed here
  // either — reads do not write. The next punch-in absorbs it.
  const open = await db.attendanceSession.findFirst({
    where: { memberId, resolution: null },
    select: { startedAt: true, resolution: true },
  });

  return {
    isPunchedIn:
      open !== null &&
      isActive(
        { startedAt: open.startedAt, resolution: open.resolution as AttendanceResolution | null },
        now
      ),
  };
}

export type AttendanceDay = {
  memberId: string;
  memberName: string;
  day: Date;
  firstIn: Date;
  lastOut: Date | null;
  ms: number;
  unclosed: number;
  sessions: number;
};

/** One row per member per app day, for the admin grid.
 *
 * **Grouped in application code via `startOfAppDay`, never a SQL date cast.**
 * The schema records why there is no `day` column: a second definition of "day"
 * written in SQL is one that can disagree with `startOfAppDay`, and a
 * `GROUP BY date_trunc(...)` would be exactly that wearing a different hat.
 *
 * A session belongs to the app day of its `startedAt` and is never split at
 * midnight, so a 22:00 start belongs to that day whatever time it ends — the
 * same rule the schema states for the row itself.
 *
 * Takes no member filter and applies no access control: its one call site
 * guards on the session's role, the same contract `listAllTasks` documents. */
export async function listAttendanceDays(
  db: PrismaClient,
  input: { from: Date; to: Date }
): Promise<AttendanceDay[]> {
  const rows = await db.attendanceSession.findMany({
    where: { startedAt: { gte: input.from, lt: input.to } },
    // Ascending, so within a day the first row is the first punch and the last
    // row's `endedAt` is the day's last-out — including when that is null.
    orderBy: { startedAt: "asc" },
    select: {
      memberId: true,
      member: { select: { name: true } },
      startedAt: true,
      endedAt: true,
      resolution: true,
    },
  });

  const buckets = new Map<
    string,
    { memberId: string; memberName: string; day: Date; firstIn: Date; lastOut: Date | null; spans: AttendanceSpanLike[] }
  >();

  for (const row of rows) {
    const day = startOfAppDay(row.startedAt);
    const key = `${row.memberId}:${day.getTime()}`;
    const span: AttendanceSpanLike = {
      startedAt: row.startedAt,
      endedAt: row.endedAt,
      resolution: row.resolution,
    };
    const existing = buckets.get(key);

    if (!existing) {
      buckets.set(key, {
        memberId: row.memberId,
        memberName: row.member.name,
        day,
        firstIn: row.startedAt,
        lastOut: row.endedAt,
        spans: [span],
      });
      continue;
    }

    existing.spans.push(span);
    // The last session of the day wins, null included: a day whose final
    // session never closed has no last-out, whatever earlier sessions did.
    existing.lastOut = row.endedAt;
  }

  return [...buckets.values()]
    .map(({ spans, ...day }) => {
      const totals = dayTotal(spans);
      return { ...day, ms: totals.ms, unclosed: totals.unclosed, sessions: spans.length };
    })
    .sort((a, b) => b.day.getTime() - a.day.getTime() || a.memberName.localeCompare(b.memberName));
}
