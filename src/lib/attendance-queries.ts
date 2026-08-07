import type { PrismaClient } from "@prisma/client";
import { isActive, type AttendanceResolution } from "@/lib/attendance";

/** What the topbar's punch control needs, which since attendance became
 * presence-only is a single boolean.
 *
 * There is no elapsed figure and no day total here on purpose (owner ruling,
 * 2026-08-07): nothing counts hours, so there is nothing to compute, tick or
 * accidentally freeze into a prefetched RSC payload. */
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
