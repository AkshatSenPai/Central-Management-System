import { Prisma, type PrismaClient } from "@prisma/client";
import { ActionResult, ok, err } from "@/lib/action-result";
import { recordActivity } from "@/lib/activity";
import { isSameAppDay } from "@/lib/attendance";

/** The open-session guard is a partial unique index, so a losing concurrent
 * punch-in surfaces as a duplicate-key error rather than as a lost write. */
function isDuplicateOpenSession(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

/** Attendance writes. Presence only — nothing here measures or accepts a
 * duration.
 *
 * **The server is the sole authority on "now".** No function accepts an
 * instant: `startedAt` and `endedAt` are taken here. A client-supplied
 * timestamp would let a fast or slow laptop clock write a presence record
 * nobody can dispute after the fact.
 *
 * **Ownership is enforced here, not in the UI** (owner ruling: only you punch
 * yourself in and out). No function takes a member id, and every `where` is
 * scoped to the actor, so there is no id a caller could pass to touch a
 * colleague's row.
 */

/** Punch in.
 *
 * Absorbs a session left open on an earlier day rather than refusing or
 * interrogating. Nobody is asked when they actually left, because **the app
 * never invents an end time** — the honest record is "we do not know", which is
 * what a null `endedAt` on a DISCARDED row says.
 *
 * That reasoning used to be "nothing counts hours", and it changed on
 * 2026-08-10 when the admin grid started summing durations. The conclusion did
 * not change, only its justification: an answer supplied days later would be a
 * guess, and a guess is exactly what a duration must not be built on. A
 * discarded session therefore contributes no duration at all — see
 * `sessionDuration`, which returns null rather than zero.
 *
 * Both writes are one transaction so a tidy-up can never happen without the new
 * session it was clearing the way for.
 *
 * The pre-check is the friendly path only; the partial unique index is the
 * enforcement, because two taps on a slow connection both pass a
 * read-then-write under READ COMMITTED. A P2002 therefore means "you already
 * are punched in", which is a cue to refresh the button, not an error worth
 * shouting about. */
export async function punchIn(
  db: PrismaClient,
  input: { actorId: string; now?: Date }
): Promise<ActionResult<{ startedAt: Date }>> {
  const now = input.now ?? new Date();

  try {
    const created = await db.$transaction(async (tx) => {
      const existing = await tx.attendanceSession.findFirst({
        where: { memberId: input.actorId, resolution: null },
        select: { id: true, startedAt: true },
      });

      if (existing) {
        // Already punched in today — nothing to do, and nothing to tidy.
        if (isSameAppDay(existing.startedAt, now)) return null;
        await tx.attendanceSession.update({
          where: { id: existing.id },
          data: {
            resolution: "DISCARDED",
            resolvedAt: now,
            resolvedById: input.actorId,
            note: "Left open; closed automatically on the next punch-in.",
          },
        });
      }

      return tx.attendanceSession.create({
        data: { memberId: input.actorId, startedAt: now },
        select: { startedAt: true },
      });
    });

    // No ActivityLog row for either the punch or the tidy-up. Punches are
    // routine and the feed is unscoped — six people clocking in and out for
    // chai is thirty rows before noon, and the CSV export inherits it. The
    // AttendanceSession table is already the complete, timestamped record.
    if (!created) return err("You are already punched in");
    return ok({ startedAt: created.startedAt });
  } catch (e) {
    if (isDuplicateOpenSession(e)) return err("You are already punched in");
    throw e;
  }
}

/** Punch out. Idempotent by construction.
 *
 * Never accepts a session id from the client — that would be an IDOR letting
 * anyone close a colleague's session. `updateMany` scoped to the actor's own
 * open row is both the authorisation and the selector.
 *
 * A stale tab whose owner already punched out on their phone updates zero rows
 * and returns ok (owner ruling): they wanted to be punched out and they are,
 * so the button quietly corrects itself rather than showing a red error for a
 * state that already matches their intent. */
export async function punchOut(
  db: PrismaClient,
  input: { actorId: string; now?: Date }
): Promise<ActionResult<{ wasAlreadyClosed: boolean }>> {
  const now = input.now ?? new Date();
  const result = await db.attendanceSession.updateMany({
    where: { memberId: input.actorId, resolution: null },
    data: {
      endedAt: now,
      resolution: "PUNCH_OUT",
      resolvedAt: now,
      resolvedById: input.actorId,
    },
  });
  return ok({ wasAlreadyClosed: result.count === 0 });
}

/** Close out a member's open session because an admin has just deactivated
 * them. Called from `setMemberActive`, inside its transaction.
 *
 * The one place a session is resolved by somebody other than its owner, and
 * not really an exception to that rule so much as its consequence: a
 * deactivated member is signed out and vanishes from the Team page, so their
 * open row would otherwise show nowhere and be closed by nobody. `endedAt`
 * stays null for the usual reason — nobody knows when they stopped.
 *
 * This one *is* logged, unlike a routine punch: an admin acting on somebody
 * else's record is exactly the kind of event an audit trail is for. */
export async function orphanOpenSessionFor(
  tx: Pick<PrismaClient, "attendanceSession" | "activityLog">,
  input: { memberId: string; actorId: string; now: Date }
): Promise<void> {
  const updated = await tx.attendanceSession.updateMany({
    where: { memberId: input.memberId, resolution: null },
    data: {
      resolution: "DISCARDED",
      resolvedAt: input.now,
      resolvedById: input.actorId,
      note: "Member was deactivated while still punched in.",
    },
  });
  if (updated.count === 0) return;
  await recordActivity(tx, {
    actorId: input.actorId,
    entityType: "ATTENDANCE",
    entityId: input.memberId,
    action: "attendance.orphaned",
    clientId: null,
    meta: null,
  });
}
