import type { PrismaClient } from "@prisma/client";
import { ActionResult, ok, err } from "@/lib/action-result";
import { recordActivity, fieldDiff } from "@/lib/activity";
import { nextTaskOrder, type TaskStatus, type TaskPriority } from "@/lib/task";

export type TaskWriteInput = {
  title: string;
  description: string | null;
  projectId: string | null;
  milestoneId: string | null;
  priority: TaskPriority;
  dueDate: Date | null;
};

const UPDATABLE_FIELDS = ["title", "description", "projectId", "milestoneId", "priority", "dueDate"] as const;

const MILESTONE_MISMATCH = "That milestone belongs to a different project";

/** A task knows only its own `projectId`, but every activity row is scoped by
 * *client* — an event logged with the wrong scope never reaches the client
 * timeline. This walks up to the grandparent in ONE query, selecting through
 * the nullable project relation, so a personal task's `clientId: null` falls
 * out naturally instead of needing a special case. Reads the task as it
 * exists before any write, which is what makes a cross-client project move
 * log under the pre-move client (R13). Module-private; reused by Task 5. */
async function loadTaskScope(
  db: PrismaClient,
  taskId: string
): Promise<
  | { ok: false }
  | {
      ok: true;
      task: {
        id: string;
        title: string;
        description: string | null;
        projectId: string | null;
        milestoneId: string | null;
        status: TaskStatus;
        priority: TaskPriority;
        dueDate: Date | null;
      };
      clientId: string | null;
    }
> {
  const task = await db.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      title: true,
      description: true,
      projectId: true,
      milestoneId: true,
      status: true,
      priority: true,
      dueDate: true,
      project: { select: { clientId: true } },
    },
  });
  if (!task) return { ok: false };
  return { ok: true, task, clientId: task.project?.clientId ?? null };
}

/** De-duplicates, asks only for active users, and returns null when fewer
 * rows come back than distinct ids requested — an unknown id and a
 * deactivated one are indistinguishable to the caller, and both map to
 * "Invalid input" with no write issued. Module-private; reused by Task 5's
 * assignment diff, where only newly added ids are ever passed through here. */
async function resolveAssignees(
  db: PrismaClient,
  ids: string[]
): Promise<{ id: string; name: string }[] | null> {
  const uniqueIds = Array.from(new Set(ids));
  if (uniqueIds.length === 0) return [];
  const users = await db.user.findMany({
    where: { id: { in: uniqueIds }, active: true },
    select: { id: true, name: true },
  });
  return users.length < uniqueIds.length ? null : users;
}

/** The (projectId, milestoneId) pair is validated together as one rule with
 * one error string (R14): a milestone with no project, and one belonging to
 * another project, are the same mistake from the caller's point of view. A
 * falsy milestoneId short-circuits before any query — clearing a task's
 * project this way clears its milestone with no lookup at all. */
async function validateMilestonePair(
  db: PrismaClient,
  projectId: string | null,
  milestoneId: string | null
): Promise<string | null> {
  if (!milestoneId) return null;
  if (!projectId) return MILESTONE_MISMATCH;
  const milestone = await db.milestone.findUnique({ where: { id: milestoneId } });
  if (!milestone || milestone.projectId !== projectId) return MILESTONE_MISMATCH;
  return null;
}

function pick<T extends object, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const key of keys) out[key] = obj[key];
  return out;
}

export async function createTask(
  db: PrismaClient,
  input: TaskWriteInput & { status: TaskStatus; assigneeIds: string[]; actorId: string }
): Promise<ActionResult<{ id: string }>> {
  const title = input.title.trim();
  if (!title) return err("Task title is required");

  // A personal task has no project, and therefore no client — this branch
  // is skipped entirely rather than issuing a lookup that would never
  // resolve to anything meaningful.
  let clientId: string | null = null;
  if (input.projectId) {
    const project = await db.project.findUnique({
      where: { id: input.projectId },
      select: { clientId: true },
    });
    if (!project) return err("Project not found");
    clientId = project.clientId;
  }

  const milestoneError = await validateMilestonePair(db, input.projectId, input.milestoneId);
  if (milestoneError) return err(milestoneError);

  const assignees = input.assigneeIds.length > 0 ? await resolveAssignees(db, input.assigneeIds) : [];
  if (assignees === null) return err("Invalid input");

  // max + 1, never a count: deleting a middle task must not make the next
  // created one collide with an existing order. A personal task's backlog is
  // scoped to its own creator, not shared across every member.
  const siblings = await db.task.findMany({
    where: input.projectId ? { projectId: input.projectId } : { projectId: null, creatorId: input.actorId },
    select: { order: true },
  });

  const created = await db.$transaction(async (tx) => {
    const task = await tx.task.create({
      data: {
        title,
        description: input.description,
        projectId: input.projectId,
        milestoneId: input.milestoneId,
        creatorId: input.actorId,
        status: input.status,
        priority: input.priority,
        dueDate: input.dueDate,
        order: nextTaskOrder(siblings),
      },
    });
    if (assignees.length > 0) {
      await tx.taskAssignee.createMany({
        data: assignees.map((assignee) => ({ taskId: task.id, userId: assignee.id })),
        skipDuplicates: true,
      });
    }
    // Exactly one row per call (R6/R16): the initial assignees are part of
    // task.created's own story, never a separate task.assigned event.
    await recordActivity(tx, {
      actorId: input.actorId,
      entityType: "TASK",
      entityId: task.id,
      action: "task.created",
      clientId,
      meta: { name: task.title },
    });
    return task;
  });
  return ok({ id: created.id });
}

export async function updateTask(
  db: PrismaClient,
  input: TaskWriteInput & { taskId: string; actorId: string }
): Promise<ActionResult> {
  const title = input.title.trim();
  if (!title) return err("Task title is required");

  const scope = await loadTaskScope(db, input.taskId);
  if (!scope.ok) return err("Task not found");

  const milestoneError = await validateMilestonePair(db, input.projectId, input.milestoneId);
  if (milestoneError) return err(milestoneError);

  // order, creatorId, status and the assignee set are owned by other
  // operations (nextTaskOrder, createTask, setTaskStatus and Task 5's
  // setTaskAssignees respectively) and never touched here.
  const candidate = {
    title,
    description: input.description,
    projectId: input.projectId,
    milestoneId: input.milestoneId,
    priority: input.priority,
    dueDate: input.dueDate,
  };
  const changes = fieldDiff(scope.task, candidate, [...UPDATABLE_FIELDS]);
  if (!changes) return ok(undefined);

  // Written as only the fields that changed — clearing the project must
  // clear the milestone in the same write without also re-sending fields
  // that never moved.
  const data = pick(candidate, Object.keys(changes) as (keyof typeof candidate)[]);

  await db.$transaction(async (tx) => {
    await tx.task.update({ where: { id: input.taskId }, data });
    await recordActivity(tx, {
      actorId: input.actorId,
      entityType: "TASK",
      entityId: input.taskId,
      action: "task.updated",
      // The pre-move client (R13): a cross-client project move is narrated
      // on the timeline it is leaving, since `scope` was loaded before this
      // write.
      clientId: scope.clientId,
      meta: { name: title, changes },
    });
  });
  return ok(undefined);
}

export async function setTaskStatus(
  db: PrismaClient,
  input: { taskId: string; status: TaskStatus; actorId: string }
): Promise<ActionResult> {
  const scope = await loadTaskScope(db, input.taskId);
  if (!scope.ok) return err("Task not found");

  if (scope.task.status === input.status) return ok(undefined);

  await db.$transaction(async (tx) => {
    await tx.task.update({ where: { id: input.taskId }, data: { status: input.status } });
    await recordActivity(tx, {
      actorId: input.actorId,
      entityType: "TASK",
      entityId: input.taskId,
      action: "task.status_changed",
      clientId: scope.clientId,
      meta: { name: scope.task.title, from: scope.task.status, to: input.status },
    });
  });
  return ok(undefined);
}

export async function removeTask(
  db: PrismaClient,
  input: { taskId: string; actorId: string }
): Promise<ActionResult> {
  const scope = await loadTaskScope(db, input.taskId);
  if (!scope.ok) return err("Task not found");

  // Title captured before the delete — afterwards there is nothing to read.
  const title = scope.task.title;

  await db.$transaction(async (tx) => {
    // Assignees and checklist items are Cascade-deleted by the FK; no
    // manual join-row or checklist cleanup belongs here.
    await tx.task.delete({ where: { id: input.taskId } });
    await recordActivity(tx, {
      actorId: input.actorId,
      entityType: "TASK",
      entityId: input.taskId,
      action: "task.removed",
      clientId: scope.clientId,
      meta: { name: title },
    });
  });
  return ok(undefined);
}
