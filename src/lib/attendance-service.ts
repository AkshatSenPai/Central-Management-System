import { Prisma, type PrismaClient } from "@prisma/client";
import { ActionResult, ok, err } from "@/lib/action-result";
import { recordActivity } from "@/lib/activity";
import { appDateTime } from "@/lib/dates";
import {
  isSameAppDay,
  overlapsExisting,
  validateCorrectedEnd,
  type AttendanceResolution,
} from "@/lib/attendance";

/** The open-session guard is a partial unique index, so a losing concurrent
 * punch-in surfaces as a duplicate-key error rather than as a lost write. */
function isDuplicateOpenSession(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

const SERIALIZABLE = { isolationLevel: "Serializable" } as const;

function isSerializationConflict(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2034";
}

const CONFLICT_MESSAGE = "Another attendance change happened at the same time. Try again.";

/** Attendance writes.
 *
 * **The server is the sole authority on "now".** No function here accepts an
 * instant for a punch: `startedAt` and a punch-out's `endedAt` are taken here.
 * A client-supplied timestamp would let a fast or slow laptop clock write
 * hours nobody worked, and there is no way to tell that apart from the truth
 * after the fact.
 *
 * **Ownership is enforced here, not in the UI** (owner ruling, 2026-08-07:
 * only you may resolve your own sessions). Every mutation scopes its `where`
 * to the actor, so there is no id a caller could pass to touch a colleague's
 * row. A hidden control is not a control.
 */

/** Punch in.
 *
 * The pre-check is the friendly path only — the index is the enforcement,
 * because two taps on a slow connection both pass a read-then-write under READ
 * COMMITTED. A P2002 therefore means "you already are punched in", which is
 * not an error the person needs shouting at them: the caller should treat it
 * as a cue to refresh the button, not as a failure. */
export async function punchIn(
  db: PrismaClient,
  input: { actorId: string; now?: Date }
): Promise<ActionResult<{ startedAt: Date } | { needsResolution: { id: string; startedAt: Date } }>> {
  const now = input.now ?? new Date();

  // A session left open from an earlier day blocks today's punch-in, because
  // the index is scoped to the member alone. That gate is deliberate rather
  // than accidental: rather than erroring, hand the caller the stale session
  // so the UI can ask for its real end time first. Scoping the index per-day
  // instead would need a stored derived day column, which this schema refuses
  // everywhere, and would let two genuinely-open sessions coexist.
  const existing = await db.attendanceSession.findFirst({
    where: { memberId: input.actorId, resolution: null },
    select: { id: true, startedAt: true },
  });
  if (existing) {
    if (isSameAppDay(existing.startedAt, now)) return err("You are already punched in");
    return ok({ needsResolution: { id: existing.id, startedAt: existing.startedAt } });
  }

  try {
    const created = await db.attendanceSession.create({
      data: { memberId: input.actorId, startedAt: now },
      select: { startedAt: true },
    });
    // No ActivityLog row. See the note on describeActivity: routine punches
    // would flood an unscoped feed and the CSV export inherits it.
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

/** Supply the end time for a session whose punch-out was forgotten.
 *
 * Serializable because the overlap check reads the member's other rows and
 * then writes — two corrections submitted together could otherwise each see a
 * gap the other is about to fill. This is the one case the partial unique
 * index cannot cover, since both rows involved are closed. */
export async function correctSession(
  db: PrismaClient,
  input: { sessionId: string; date: string; time: string; actorId: string; now?: Date }
): Promise<ActionResult> {
  const now = input.now ?? new Date();
  const end = appDateTime(input.date, input.time);

  try {
    const failure = await db.$transaction(async (tx) => {
      const session = await tx.attendanceSession.findFirst({
        // Scoped to the actor: correcting somebody else's session is refused
        // by the query returning nothing, not by a role check that a second
        // call site could forget.
        where: { id: input.sessionId, memberId: input.actorId, resolution: null },
        select: { id: true, startedAt: true },
      });
      if (!session) return "That session is not open, or is not yours.";

      const invalid = validateCorrectedEnd(session.startedAt, end, now);
      if (invalid) return invalid;

      const others = await tx.attendanceSession.findMany({
        where: { memberId: input.actorId, id: { not: session.id } },
        select: { startedAt: true, endedAt: true, resolution: true },
      });
      const clash = overlapsExisting(
        { startedAt: session.startedAt, endedAt: end! },
        others.map((o) => ({
          startedAt: o.startedAt,
          endedAt: o.endedAt,
          resolution: o.resolution as AttendanceResolution | null,
        }))
      );
      if (clash) return "That overlaps another session you already recorded.";

      await tx.attendanceSession.update({
        where: { id: session.id },
        data: {
          endedAt: end,
          resolution: "CORRECTED",
          resolvedAt: now,
          resolvedById: input.actorId,
        },
      });
      await recordActivity(tx, {
        actorId: input.actorId,
        entityType: "ATTENDANCE",
        entityId: session.id,
        action: "attendance.corrected",
        clientId: null,
        meta: { startedAt: session.startedAt.toISOString(), endedAt: end!.toISOString() },
      });
      return null;
    }, SERIALIZABLE);

    return failure ? err(failure) : ok(undefined);
  } catch (e) {
    if (isSerializationConflict(e)) return err(CONFLICT_MESSAGE);
    throw e;
  }
}

/** Write off a session nobody can put an end time to.
 *
 * `endedAt` stays null forever and the row counts zero everywhere. The row is
 * kept rather than deleted because "they were here at 09:04" is true and worth
 * keeping; only the duration is unknown. */
export async function discardSession(
  db: PrismaClient,
  input: { sessionId: string; actorId: string; now?: Date }
): Promise<ActionResult> {
  const now = input.now ?? new Date();

  const result = await db.$transaction(async (tx) => {
    const updated = await tx.attendanceSession.updateMany({
      where: { id: input.sessionId, memberId: input.actorId, resolution: null },
      data: { resolution: "DISCARDED", resolvedAt: now, resolvedById: input.actorId },
    });
    if (updated.count === 0) return false;
    await recordActivity(tx, {
      actorId: input.actorId,
      entityType: "ATTENDANCE",
      entityId: input.sessionId,
      action: "attendance.discarded",
      clientId: null,
      meta: null,
    });
    return true;
  });

  return result ? ok(undefined) : err("That session is not open, or is not yours.");
}

/** Close out a member's open session because an admin has just deactivated
 * them. Called from `setMemberActive`, inside its transaction.
 *
 * This is the one place a session is resolved by somebody other than its
 * owner, and it is not an exception to the owner-only rule so much as its
 * consequence: a deactivated member is signed out and vanishes from the Team
 * page, so their open row would otherwise be unresolvable by anyone, forever.
 * It is DISCARDED rather than closed at the deactivation instant, because
 * nobody knows when they actually stopped working — the same refusal to guess
 * that governs everything else here. */
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
