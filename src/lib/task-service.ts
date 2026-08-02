import { Prisma, type PrismaClient } from "@prisma/client";
import { ActionResult, ok, err } from "@/lib/action-result";
import { recordActivity, fieldDiff } from "@/lib/activity";
import { notify, clearNotificationsFor } from "@/lib/notification-service";
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

  // Only a genuine move needs this: a stale dropdown or a project deleted
  // by someone else between page render and save is an expected path, not
  // an exceptional one, so it must surface as an ActionResult, not a thrown
  // foreign-key error from tx.task.update. Unchanged and cleared-to-null
  // projects issue no lookup.
  let destinationClientId: string | null = null;
  if (input.projectId && input.projectId !== scope.task.projectId) {
    const project = await db.project.findUnique({
      where: { id: input.projectId },
      select: { id: true, clientId: true },
    });
    if (!project) return err("Project not found");
    destinationClientId = project.clientId;
  }

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

  try {
    await db.$transaction(async (tx) => {
      await tx.task.update({ where: { id: input.taskId }, data });
      await recordActivity(tx, {
        actorId: input.actorId,
        entityType: "TASK",
        entityId: input.taskId,
        action: "task.updated",
        // The pre-move client (R13): a cross-client project move is narrated
        // on the timeline it is leaving, since `scope` was loaded before this
        // write. The rule is deliberately asymmetric — a personal task has no
        // timeline to leave, so falling back to the destination is the only
        // way the move is narrated anywhere at all. Without this, adopting a
        // personal task into a project wrote clientId: null and the row
        // surfaced on no timeline. Clearing a project still logs under the
        // pre-move client, because `destinationClientId` stays null there.
        clientId: scope.clientId ?? destinationClientId,
        meta: { name: title, changes },
      });
    });
  } catch (e) {
    if (isRowGoneRace(e)) return err("Task not found");
    throw e;
  }
  return ok(undefined);
}

export async function setTaskStatus(
  db: PrismaClient,
  input: { taskId: string; status: TaskStatus; actorId: string }
): Promise<ActionResult> {
  const scope = await loadTaskScope(db, input.taskId);
  if (!scope.ok) return err("Task not found");

  if (scope.task.status === input.status) return ok(undefined);

  // Spec 5.7: "status change on a task you created or are assigned to". Read
  // before the transaction opens — it is a plain read that does not need to be
  // inside it, and holding a transaction open across an extra round trip is
  // the kind of thing that only hurts under load.
  const interested = await db.task.findUnique({
    where: { id: input.taskId },
    select: { creatorId: true, assignees: { select: { userId: true } } },
  });
  const interestedIds = interested
    ? [interested.creatorId, ...interested.assignees.map((a) => a.userId)]
    : [];

  try {
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
      // `notify` drops the actor and deduplicates, so a creator who is also an
      // assignee gets one row, and someone moving their own task gets none.
      await notify(tx, {
        recipientIds: interestedIds,
        actorId: input.actorId,
        type: "TASK_STATUS_CHANGED",
        entityType: "TASK",
        entityId: input.taskId,
        meta: { name: scope.task.title, to: input.status },
      });
    });
  } catch (e) {
    if (isRowGoneRace(e)) return err("Task not found");
    throw e;
  }
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

  try {
    await db.$transaction(async (tx) => {
      // Assignees and checklist items are Cascade-deleted by the FK; no
      // manual join-row or checklist cleanup belongs here.
      await tx.task.delete({ where: { id: input.taskId } });
      // entityId carries no foreign key, so nothing cascades. Unlike the
      // activity log — which is an audit trail and must outlive its subject —
      // a notification about a deleted task is only a link to a 404.
      await clearNotificationsFor(tx, { entityType: "TASK", entityId: input.taskId });
      await recordActivity(tx, {
        actorId: input.actorId,
        entityType: "TASK",
        entityId: input.taskId,
        action: "task.removed",
        clientId: scope.clientId,
        meta: { name: title },
      });
    });
  } catch (e) {
    if (isRowGoneRace(e)) return err("Task not found");
    throw e;
  }
  return ok(undefined);
}

/** True when `e` is the row-vanished error a concurrent delete can race a
 * later update or delete into — the read in `loadTaskScope` succeeded, but
 * the row was gone by the time the transaction actually ran. */
function isRowGoneRace(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025";
}

/** The read-diff-write cycle for `setTaskAssignees`. Kept as its own function
 * because the read of `current` and the writes that depend on it belong
 * together: the diff is only valid for the snapshot it was computed from. */
async function attemptTaskAssigneeDiff(
  db: PrismaClient,
  scope: { task: { title: string }; clientId: string | null },
  input: { taskId: string; userIds: string[]; actorId: string }
): Promise<ActionResult> {
  const current = await db.taskAssignee.findMany({
    where: { taskId: input.taskId },
    select: { userId: true, user: { select: { name: true } } },
  });
  const currentIds = current.map((row) => row.userId);
  const requestedIds = Array.from(new Set(input.userIds));

  const addedIds = requestedIds.filter((id) => !currentIds.includes(id));
  const removedIds = currentIds.filter((id) => !requestedIds.includes(id));

  // A true set diff, never a blanket delete: an unchanged submission
  // (including one that re-submits a deactivated current assignee — see
  // setTaskAssignees) writes nothing at all and logs nothing.
  if (addedIds.length === 0 && removedIds.length === 0) return ok(undefined);

  // Only the NEW ids are ever checked against the active-user list; a
  // deactivated id already present in `current` never reaches this call.
  const added = addedIds.length > 0 ? await resolveAssignees(db, addedIds) : [];
  if (added === null) return err("Invalid input");

  const removedNames = current.filter((row) => removedIds.includes(row.userId)).map((row) => row.user.name);

  await db.$transaction(async (tx) => {
    // Scoped to exactly the departed ids (R: a true diff) — wiping every
    // row for the task and recreating the survivors would churn rows that
    // never changed at all.
    if (removedIds.length > 0) {
      await tx.taskAssignee.deleteMany({ where: { taskId: input.taskId, userId: { in: removedIds } } });
    }
    if (addedIds.length > 0) {
      await tx.taskAssignee.createMany({
        data: addedIds.map((userId) => ({ taskId: input.taskId, userId })),
        skipDuplicates: true,
      });
    }
    // At most two rows per call, each naming people rather than ids so the
    // timeline renders without a join and stays readable after a rename.
    if (addedIds.length > 0) {
      await recordActivity(tx, {
        actorId: input.actorId,
        entityType: "TASK",
        entityId: input.taskId,
        action: "task.assigned",
        clientId: scope.clientId,
        meta: { name: scope.task.title, people: added.map((a) => a.name) },
      });
    }
    if (removedIds.length > 0) {
      await recordActivity(tx, {
        actorId: input.actorId,
        entityType: "TASK",
        entityId: input.taskId,
        action: "task.unassigned",
        clientId: scope.clientId,
        meta: { name: scope.task.title, people: removedNames },
      });
    }

    // Only the newly added, and inside the same transaction as the rows
    // themselves — a rolled-back assignment must not leave someone told they
    // were assigned. Removal deliberately notifies nobody: being taken off a
    // task is not urgent, and a bell that fires on every reshuffle is a bell
    // people learn to ignore.
    await notify(tx, {
      recipientIds: addedIds,
      actorId: input.actorId,
      type: "TASK_ASSIGNED",
      entityType: "TASK",
      entityId: input.taskId,
      meta: { name: scope.task.title },
    });
  });
  return ok(undefined);
}

/** The universal-assignment invariant: any member can assign work to any
 * other member, expressed here as a set replacement rather than an
 * add/remove pair, so a caller never has to compute its own diff.
 *
 * The add side resolves through `resolveAssignees`, which filters to
 * `active: true`; the remove side reads names off the rows already loaded
 * from `current` instead of re-validating anyone. That asymmetry is
 * deliberate: members are deactivated, never deleted (TaskAssignee.user is
 * RESTRICT precisely so history keeps its people), and a deactivated member
 * who is already assigned and gets re-submitted unchanged lands in neither
 * `addedIds` nor `removedIds` — the diff sees no change, so their row is
 * never touched. Validating the whole submitted set instead of just the
 * additions would silently unassign them on any unrelated save. */
export async function setTaskAssignees(
  db: PrismaClient,
  input: { taskId: string; userIds: string[]; actorId: string }
): Promise<ActionResult> {
  const scope = await loadTaskScope(db, input.taskId);
  if (!scope.ok) return err("Task not found");

  // No P2002 retry, deliberately. `createMany({ skipDuplicates: true })`
  // compiles to INSERT … ON CONFLICT DO NOTHING on Postgres, so a concurrent
  // insert of the same (taskId, userId) is absorbed by the database and the
  // transaction commits — verified against this install: the duplicate insert
  // returned `{ count: 0 }` without throwing, while the same insert *without*
  // skipDuplicates threw P2002, confirming the unique constraint is real.
  // A retry here would have guarded an error that cannot reach it.
  //
  // The race that IS reachable needs no retry and cannot be fixed by one:
  // two overlapping saves each diff against their own `current` snapshot, so
  // the later one recomputes `removedIds` from stale data and can delete rows
  // the earlier save just created. Last writer wins, which is the intended
  // semantics of a set replacement.
  return attemptTaskAssigneeDiff(db, scope, input);
}
