import { Prisma, type PrismaClient } from "@prisma/client";
import { ActionResult, ok, err } from "@/lib/action-result";
import { recordActivity } from "@/lib/activity";
import { feedbackSchema, type FeedbackStatus } from "@/lib/feedback";

function isRowGoneRace(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025";
}

/** Any member may submit. There is no notification on purpose.
 *
 * The bell is for things that need you now — an assignment, a mention, a
 * meeting moved. Feedback is a queue an admin triages when they sit down to
 * it, and lighting up every admin's bell on submission would train the team
 * to dismiss the bell rather than to read the feedback. The page carries its
 * own open count instead; if that proves too quiet, the fix is a digest, not
 * a per-row notification. */
export async function addFeedback(
  db: PrismaClient,
  input: { kind: string; body: string; actorId: string }
): Promise<ActionResult<{ id: string }>> {
  const parsed = feedbackSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Invalid input");

  const created = await db.$transaction(async (tx) => {
    const feedback = await tx.feedback.create({
      data: {
        authorId: input.actorId,
        kind: parsed.data.kind,
        body: parsed.data.body,
      },
    });
    await recordActivity(tx, {
      actorId: input.actorId,
      entityType: "FEEDBACK",
      entityId: feedback.id,
      action: "feedback.submitted",
      // Studio-wide, belonging to no client timeline — the same null the
      // announcement service records, and for the same reason.
      clientId: null,
      meta: { kind: feedback.kind },
    });
    return feedback;
  });
  return ok({ id: created.id });
}

/** Triage. Admin-only, and refused here rather than merely hidden in the UI —
 * the same rule the password reset follows, because a control that is only
 * hidden is not a control at all.
 *
 * `resolvedBy`/`resolvedAt` are stamped whenever the row leaves NEW and
 * cleared if it is put back, so "who answered this" always matches what the
 * status claims. Without the clearing branch, moving something back to NEW
 * would leave a name against a row nobody has actually looked at again. */
export async function setFeedbackStatus(
  db: PrismaClient,
  input: {
    feedbackId: string;
    status: FeedbackStatus;
    actorId: string;
    isAdmin: boolean;
  }
): Promise<ActionResult> {
  if (!input.isAdmin) return err("Only an admin can triage feedback");

  const leavingNew = input.status !== "NEW";

  try {
    await db.$transaction(async (tx) => {
      await tx.feedback.update({
        where: { id: input.feedbackId },
        data: {
          status: input.status,
          resolvedById: leavingNew ? input.actorId : null,
          resolvedAt: leavingNew ? new Date() : null,
        },
      });
      await recordActivity(tx, {
        actorId: input.actorId,
        entityType: "FEEDBACK",
        entityId: input.feedbackId,
        action: "feedback.triaged",
        clientId: null,
        meta: { status: input.status },
      });
    });
  } catch (e) {
    if (isRowGoneRace(e)) return err("Feedback not found");
    throw e;
  }
  return ok(undefined);
}

/** Author-or-admin, the same line comments (3c D3), announcements and
 * attachments all draw. Someone who submits by mistake can withdraw it; an
 * admin can clear a duplicate. */
export async function removeFeedback(
  db: PrismaClient,
  input: { feedbackId: string; actorId: string; isAdmin: boolean }
): Promise<ActionResult> {
  const existing = await db.feedback.findUnique({
    where: { id: input.feedbackId },
    select: { authorId: true, kind: true },
  });
  if (!existing) return err("Feedback not found");
  if (existing.authorId !== input.actorId && !input.isAdmin) {
    return err("You can only delete your own feedback");
  }

  try {
    await db.$transaction(async (tx) => {
      await tx.feedback.delete({ where: { id: input.feedbackId } });
      await recordActivity(tx, {
        actorId: input.actorId,
        entityType: "FEEDBACK",
        entityId: input.feedbackId,
        action: "feedback.removed",
        clientId: null,
        meta: { kind: existing.kind },
      });
    });
  } catch (e) {
    if (isRowGoneRace(e)) return err("Feedback not found");
    throw e;
  }
  return ok(undefined);
}
