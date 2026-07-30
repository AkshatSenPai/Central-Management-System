import type { PrismaClient } from "@prisma/client";
import { ActionResult, ok, err } from "@/lib/action-result";
import { recordActivity, fieldDiff } from "@/lib/activity";
import { nextMilestoneOrder } from "@/lib/milestones";

/** A milestone knows only its projectId, but every activity row is scoped by
 * *client* — an event logged with a null scope never reaches the client
 * timeline. So every mutation here walks up to the grandparent first. */
async function loadScope(
  db: PrismaClient,
  milestoneId: string
): Promise<
  | { ok: false }
  | {
      ok: true;
      milestone: { id: string; projectId: string; title: string; dueDate: Date | null; completedAt: Date | null };
      clientId: string;
    }
> {
  const milestone = await db.milestone.findUnique({ where: { id: milestoneId } });
  if (!milestone) return { ok: false };
  const project = await db.project.findUnique({
    where: { id: milestone.projectId },
    select: { clientId: true },
  });
  if (!project) return { ok: false };
  return { ok: true, milestone, clientId: project.clientId };
}

export async function addMilestone(
  db: PrismaClient,
  input: { projectId: string; title: string; dueDate: Date | null; actorId: string }
): Promise<ActionResult<{ id: string }>> {
  const title = input.title.trim();
  if (!title) return err("Milestone title is required");

  const project = await db.project.findUnique({
    where: { id: input.projectId },
    select: { clientId: true },
  });
  if (!project) return err("Project not found");

  // max + 1, never a count: deleting a middle milestone must not make the
  // next created one collide with an existing order.
  const siblings = await db.milestone.findMany({
    where: { projectId: input.projectId },
    select: { order: true },
  });

  const created = await db.$transaction(async (tx) => {
    const milestone = await tx.milestone.create({
      data: {
        projectId: input.projectId,
        title,
        dueDate: input.dueDate,
        order: nextMilestoneOrder(siblings),
      },
    });
    await recordActivity(tx, {
      actorId: input.actorId,
      entityType: "MILESTONE",
      entityId: milestone.id,
      action: "milestone.added",
      clientId: project.clientId,
      meta: { name: milestone.title },
    });
    return milestone;
  });
  return ok({ id: created.id });
}

export async function updateMilestone(
  db: PrismaClient,
  input: { milestoneId: string; title: string; dueDate: Date | null; actorId: string }
): Promise<ActionResult> {
  const title = input.title.trim();
  if (!title) return err("Milestone title is required");

  const scope = await loadScope(db, input.milestoneId);
  if (!scope.ok) return err("Milestone not found");

  // order and completedAt are owned by other operations and never edited here.
  const data = { title, dueDate: input.dueDate };
  const changes = fieldDiff(scope.milestone, data, ["title", "dueDate"]);
  if (!changes) return ok(undefined);

  await db.$transaction(async (tx) => {
    await tx.milestone.update({ where: { id: input.milestoneId }, data });
    await recordActivity(tx, {
      actorId: input.actorId,
      entityType: "MILESTONE",
      entityId: input.milestoneId,
      action: "milestone.updated",
      clientId: scope.clientId,
      meta: { name: title, changes },
    });
  });
  return ok(undefined);
}

/** Completion is the single completedAt timestamp — there is no status column
 * to drift out of sync with it. */
export async function setMilestoneComplete(
  db: PrismaClient,
  input: { milestoneId: string; complete: boolean; actorId: string; now?: Date }
): Promise<ActionResult> {
  const scope = await loadScope(db, input.milestoneId);
  if (!scope.ok) return err("Milestone not found");

  const alreadyComplete = scope.milestone.completedAt !== null;
  if (alreadyComplete === input.complete) return ok(undefined);

  const completedAt = input.complete ? (input.now ?? new Date()) : null;

  await db.$transaction(async (tx) => {
    await tx.milestone.update({ where: { id: input.milestoneId }, data: { completedAt } });
    await recordActivity(tx, {
      actorId: input.actorId,
      entityType: "MILESTONE",
      entityId: input.milestoneId,
      action: input.complete ? "milestone.completed" : "milestone.reopened",
      clientId: scope.clientId,
      meta: { name: scope.milestone.title },
    });
  });
  return ok(undefined);
}

export async function removeMilestone(
  db: PrismaClient,
  input: { milestoneId: string; actorId: string }
): Promise<ActionResult> {
  const scope = await loadScope(db, input.milestoneId);
  if (!scope.ok) return err("Milestone not found");

  // Title captured before the delete — afterwards there is nothing to read.
  const title = scope.milestone.title;

  await db.$transaction(async (tx) => {
    await tx.milestone.delete({ where: { id: input.milestoneId } });
    await recordActivity(tx, {
      actorId: input.actorId,
      entityType: "MILESTONE",
      entityId: input.milestoneId,
      action: "milestone.removed",
      clientId: scope.clientId,
      meta: { name: title },
    });
  });
  return ok(undefined);
}
