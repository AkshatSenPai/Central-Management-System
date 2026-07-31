import type { PrismaClient } from "@prisma/client";
import { ActionResult, ok, err } from "@/lib/action-result";
import { recordActivity } from "@/lib/activity";
import { nextTaskOrder } from "@/lib/task";

/** A checklist item knows only its own taskId, but every activity row is
 * scoped by *client* — an event logged with the wrong scope never reaches the
 * client timeline. `loadTaskScope` (task-service.ts) walks up one level
 * (task -> project); this walks up two (item -> task -> project) in ONE
 * query, selecting through both nullable relations, so an item on a personal
 * task's `clientId: null` falls out naturally instead of needing a special
 * case. Module-private. */
async function loadChecklistScope(
  db: PrismaClient,
  itemId: string
): Promise<
  | { ok: false }
  | {
      ok: true;
      item: { id: string; title: string; done: boolean; taskId: string };
      taskId: string;
      clientId: string | null;
    }
> {
  const item = await db.checklistItem.findUnique({
    where: { id: itemId },
    select: {
      id: true,
      title: true,
      done: true,
      taskId: true,
      task: { select: { id: true, title: true, project: { select: { clientId: true } } } },
    },
  });
  if (!item) return { ok: false };
  return {
    ok: true,
    item: { id: item.id, title: item.title, done: item.done, taskId: item.taskId },
    taskId: item.taskId,
    clientId: item.task.project?.clientId ?? null,
  };
}

export async function addChecklistItem(
  db: PrismaClient,
  input: { taskId: string; title: string; actorId: string }
): Promise<ActionResult<{ id: string }>> {
  const title = input.title.trim();
  if (!title) return err("Checklist item title is required");

  const task = await db.task.findUnique({
    where: { id: input.taskId },
    select: { project: { select: { clientId: true } } },
  });
  if (!task) return err("Task not found");
  const clientId = task.project?.clientId ?? null;

  // max + 1, never a count (nextTaskOrder, shared with task-service's own
  // task-ordering rule): deleting a middle item must not make the next one
  // added collide with an existing order.
  const siblings = await db.checklistItem.findMany({
    where: { taskId: input.taskId },
    select: { order: true },
  });

  const created = await db.$transaction(async (tx) => {
    const item = await tx.checklistItem.create({
      data: {
        taskId: input.taskId,
        title,
        order: nextTaskOrder(siblings),
      },
    });
    await recordActivity(tx, {
      actorId: input.actorId,
      entityType: "CHECKLIST_ITEM",
      entityId: item.id,
      action: "checklist.added",
      clientId,
      meta: { name: item.title },
    });
    return item;
  });
  return ok({ id: created.id });
}

/** Ticking an already-ticked item — or unticking an already-open one — writes
 * nothing at all: no update, no activity row, in either direction. Mirrors
 * `setMilestoneComplete`'s no-op-when-unchanged rule; unlike a milestone,
 * `done` has no separate timestamp, so the check is a direct boolean
 * comparison rather than a null check. */
export async function setChecklistItemDone(
  db: PrismaClient,
  input: { itemId: string; done: boolean; actorId: string }
): Promise<ActionResult> {
  const scope = await loadChecklistScope(db, input.itemId);
  if (!scope.ok) return err("Checklist item not found");

  if (scope.item.done === input.done) return ok(undefined);

  await db.$transaction(async (tx) => {
    await tx.checklistItem.update({ where: { id: input.itemId }, data: { done: input.done } });
    await recordActivity(tx, {
      actorId: input.actorId,
      entityType: "CHECKLIST_ITEM",
      entityId: input.itemId,
      action: input.done ? "checklist.completed" : "checklist.reopened",
      clientId: scope.clientId,
      meta: { name: scope.item.title },
    });
  });
  return ok(undefined);
}

export async function removeChecklistItem(
  db: PrismaClient,
  input: { itemId: string; actorId: string }
): Promise<ActionResult> {
  const scope = await loadChecklistScope(db, input.itemId);
  if (!scope.ok) return err("Checklist item not found");

  // Title captured before the delete — afterwards there is nothing to read.
  const title = scope.item.title;

  await db.$transaction(async (tx) => {
    await tx.checklistItem.delete({ where: { id: input.itemId } });
    await recordActivity(tx, {
      actorId: input.actorId,
      entityType: "CHECKLIST_ITEM",
      entityId: input.itemId,
      action: "checklist.removed",
      clientId: scope.clientId,
      meta: { name: title },
    });
  });
  return ok(undefined);
}
