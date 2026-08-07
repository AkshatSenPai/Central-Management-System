import type { PrismaClient } from "@prisma/client";
import { startOfAppDay } from "@/lib/dates";
import {
  dayMs,
  isActive,
  isUnresolved,
  type AttendanceResolution,
  type AttendanceSessionLike,
} from "@/lib/attendance";

/** What the topbar's punch control needs, and nothing more.
 *
 * Note there is no single "hours today" total. A server-computed
 * `now - startedAt` would be a different number on every render, get baked
 * into a prefetched RSC payload, and then sit frozen on screen. The query
 * returns the *closed* total plus the instant the open session began; the
 * client adds the live portion and ticks it. */
export type PunchState = {
  /** When today's open session started, or null. */
  openSince: Date | null;
  /** An open session from an earlier app day — somebody forgot to punch out. */
  unresolved: { id: string; startedAt: Date } | null;
  /** Today's completed pairs only. Excludes the open session and anything
   * discarded. */
  closedMs: number;
};

/** `openSince` and `unresolved` are mutually exclusive: the partial unique
 * index guarantees at most one open row per member, and that row is either
 * from today or it is not. One of the two is always null. */
export async function getPunchState(
  db: PrismaClient,
  memberId: string,
  now: Date = new Date()
): Promise<PunchState> {
  // One query. This runs inside the app layout's Promise.all, so it executes
  // on every authenticated page load — the same cost the Quick Add project
  // list already carries, and the same reason to keep it to a single call.
  //
  // The OR fetches today's rows plus any still-open row whatever its age,
  // because a session forgotten last Tuesday must still be found. Filtering
  // the fold in memory rather than adding SQL bounds follows
  // dashboard-queries.ts.
  const rows = await db.attendanceSession.findMany({
    where: {
      memberId,
      OR: [{ resolution: null }, { startedAt: { gte: startOfAppDay(now) } }],
    },
    orderBy: { startedAt: "desc" },
    select: { id: true, startedAt: true, endedAt: true, resolution: true },
  });

  const sessions: (AttendanceSessionLike & { id: string })[] = rows.map((r) => ({
    id: r.id,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    resolution: r.resolution as AttendanceResolution | null,
  }));

  const open = sessions.find((s) => s.resolution === null) ?? null;

  return {
    openSince: open && isActive(open, now) ? open.startedAt : null,
    unresolved:
      open && isUnresolved(open, now) ? { id: open.id, startedAt: open.startedAt } : null,
    closedMs: dayMs(sessions, now),
  };
}
