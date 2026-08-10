import { Prisma, type PrismaClient } from "@prisma/client";
import { ActionResult, ok, err } from "@/lib/action-result";
import { recordActivity, fieldDiff } from "@/lib/activity";
import { notify, clearNotificationsFor } from "@/lib/notification-service";
import { deleteAttachmentObjectsFor } from "@/lib/attachment-service";
import {
  nextTaskOrder,
  taskReference,
  isTaskBlocked,
  unfinishedBlockers,
  blockedMoveNeedsPermission,
  blockedRefusalMessage,
  blockedOverridePrompt,
  type BlockerRef,
  type TaskStatus,
  type TaskPriority,
} from "@/lib/task";

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

/** Narrow on purpose, the same rule as ActivityDb: a `$transaction` tx
 * satisfies this, so the cycle walk can run inside the very transaction that
 * would write the edge. Widening it to PrismaClient would force the check
 * outside, where two concurrent adds can both pass. */
export type DependencyReadDb = Pick<PrismaClient, "taskDependency">;

/** A backstop that should be unreachable — a studio's plan is single digits
 * deep. Hitting it means data this design did not anticipate, so it refuses
 * rather than continuing. */
const MAX_DEPENDENCY_DEPTH = 100;

/** Would "blocked waits on blocker" close a loop?
 *
 * Walk the depends-on chain from the proposed blocker; if the task being
 * blocked is reachable, that task is already upstream and the new edge would
 * close the cycle. A → B → A must never reach the database, because it is a
 * board with no legal move and no way out from the UI.
 *
 * One query per LEVEL, not per node. `seen` is what makes a diamond legal —
 * A blocked by B and C, both blocked by D, is an ordinary plan, and without
 * `seen` the walk would revisit D once per path. */
export async function wouldCloseCycle(
  db: DependencyReadDb,
  input: { blockedTaskId: string; blockerTaskId: string }
): Promise<boolean> {
  // Caught here rather than in a separate branch: a self-edge is just the
  // degenerate cycle.
  if (input.blockedTaskId === input.blockerTaskId) return true;

  const seen = new Set<string>([input.blockerTaskId]);
  let frontier = [input.blockerTaskId];

  for (let depth = 0; depth < MAX_DEPENDENCY_DEPTH; depth++) {
    if (frontier.length === 0) return false;

    const rows = await db.taskDependency.findMany({
      where: { blockedTaskId: { in: frontier } },
      select: { blockerTaskId: true },
    });

    const next: string[] = [];
    for (const row of rows) {
      if (row.blockerTaskId === input.blockedTaskId) return true;
      if (seen.has(row.blockerTaskId)) continue;
      seen.add(row.blockerTaskId);
      next.push(row.blockerTaskId);
    }
    frontier = next;
  }

  return true;
}

/** Both ends in one query, so an unknown id on either side is one "Task not
 * found" rather than two round trips and two branches. */
async function loadDependencyPair(
  db: PrismaClient,
  blockedTaskId: string,
  blockerTaskId: string
): Promise<{
  blocked: { id: string; title: string; reference: number };
  blocker: { id: string; title: string; reference: number };
} | null> {
  const rows = await db.task.findMany({
    where: { id: { in: [blockedTaskId, blockerTaskId] } },
    select: { id: true, title: true, reference: true },
  });
  const blocked = rows.find((r) => r.id === blockedTaskId);
  const blocker = rows.find((r) => r.id === blockerTaskId);
  if (!blocked || !blocker) return null;
  return { blocked, blocker };
}

export async function addTaskDependency(
  db: PrismaClient,
  input: { blockedTaskId: string; blockerTaskId: string; actorId: string }
): Promise<ActionResult> {
  const pair = await loadDependencyPair(db, input.blockedTaskId, input.blockerTaskId);
  if (!pair) return err("Task not found");

  const scope = await loadTaskScope(db, input.blockedTaskId);
  if (!scope.ok) return err("Task not found");

  try {
    return await db.$transaction(async (tx) => {
      // Inside the transaction on purpose: two concurrent adds each checked
      // against a pre-write world can both pass and together close a loop,
      // and the composite key does not stop that because the two rows are
      // genuinely different.
      if (await wouldCloseCycle(tx, input)) {
        // Names the BLOCKER — the option that was just picked — not the task
        // whose page you are on. Naming the latter produces "MER-013 already
        // depends on this task" while you are looking at MER-013, which reads
        // as a task depending on itself and tells you nothing about which
        // pick to avoid. Caught in browser QA; the first unit test asserted
        // the same wrong string and so agreed with the bug.
        return err(
          `${taskReference(pair.blocker.reference)} already depends on this task, so this would create a loop.`
        );
      }

      await tx.taskDependency.create({
        data: { blockedTaskId: input.blockedTaskId, blockerTaskId: input.blockerTaskId },
      });
      await recordActivity(tx, {
        actorId: input.actorId,
        entityType: "TASK",
        entityId: input.blockedTaskId,
        action: "task.dependency_added",
        clientId: scope.clientId,
        meta: { name: pair.blocked.title, blocker: taskReference(pair.blocker.reference) },
      });
      return ok(undefined);
    });
  } catch (e) {
    // The composite primary key: the same blocker added twice, which a
    // double-submitted form produces. The state the caller wanted is already
    // true, so this is a success, not a collision to report.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return ok(undefined);
    if (isRowGoneRace(e)) return err("Task not found");
    throw e;
  }
}

export async function removeTaskDependency(
  db: PrismaClient,
  input: { blockedTaskId: string; blockerTaskId: string; actorId: string }
): Promise<ActionResult> {
  const pair = await loadDependencyPair(db, input.blockedTaskId, input.blockerTaskId);
  if (!pair) return err("Task not found");

  const scope = await loadTaskScope(db, input.blockedTaskId);
  if (!scope.ok) return err("Task not found");

  try {
    await db.$transaction(async (tx) => {
      await tx.taskDependency.delete({
        where: {
          blockedTaskId_blockerTaskId: {
            blockedTaskId: input.blockedTaskId,
            blockerTaskId: input.blockerTaskId,
          },
        },
      });
      await recordActivity(tx, {
        actorId: input.actorId,
        entityType: "TASK",
        entityId: input.blockedTaskId,
        action: "task.dependency_removed",
        clientId: scope.clientId,
        meta: { name: pair.blocked.title, blocker: taskReference(pair.blocker.reference) },
      });
    });
  } catch (e) {
    // Already gone is the outcome the caller wanted.
    if (isRowGoneRace(e)) return ok(undefined);
    throw e;
  }
  return ok(undefined);
}

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
): Promise<ActionResult<{ id: string; notificationIds: string[] }>> {
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
    // The activity log folds these into task.created, but a notification
    // cannot: being handed work at creation is the same event, to the person
    // receiving it, as being handed it a minute later by an edit. Notifying
    // only on the edit path would mean quick-add — the app's fastest way to
    // assign someone something — told them nothing.
    // Carried out of the transaction so the action can push once the write is
    // durable. Nothing pushes from in here — see notification-service.ts.
    const notificationIds = await notify(tx, {
      recipientIds: assignees.map((a) => a.id),
      actorId: input.actorId,
      type: "TASK_ASSIGNED",
      entityType: "TASK",
      entityId: task.id,
      meta: { name: task.title },
    });
    return { task, notificationIds };
  });
  return ok({ id: created.task.id, notificationIds: created.notificationIds });
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

/** Structurally `ActionResult` plus one optional flag on the failure arm, so
 * every existing reader that only looks at `.ok`/`.error` keeps working.
 *
 * `needsOverride` means: the move was NOT applied, and the caller may retry
 * with `override: true`. Only ever returned to an admin — a member gets the
 * plain refusal, so confirming something they cannot do is impossible. The
 * role is re-read from the session on the retry, so a forged `override` in
 * the form buys nothing. */
export type SetTaskStatusResult =
  | { ok: true; data: undefined }
  | { ok: false; error: string; needsOverride?: boolean };

export async function setTaskStatus(
  db: PrismaClient,
  input: {
    taskId: string;
    status: TaskStatus;
    actorId: string;
    isAdmin: boolean;
    /** Set only by a retry after the admin confirmed the prompt. */
    override?: boolean;
  }
): Promise<SetTaskStatusResult> {
  const scope = await loadTaskScope(db, input.taskId);
  if (!scope.ok) return err("Task not found");

  if (scope.task.status === input.status) return ok(undefined);

  // Sequencing. Read outside the transaction, the same reasoning as the
  // `interested` query below: a plain read that does not need to be in it,
  // and holding a transaction open across an extra round trip only hurts
  // under load.
  //
  // The race this accepts is spec §5's: a start can be refused against a
  // blocker that turned DONE microseconds later. That is a refusal somebody
  // retries successfully a second later; closing it would mean locking every
  // blocker row on every status change in the app.
  const dependencyRows = await db.taskDependency.findMany({
    where: { blockedTaskId: input.taskId },
    select: { blocker: { select: { reference: true, status: true } } },
  });
  const blockers: BlockerRef[] = dependencyRows.map((d) => d.blocker);
  const blocked = isTaskBlocked(blockers);

  if (blockedMoveNeedsPermission({ blocked, to: input.status })) {
    // A member is stopped outright.
    if (!input.isAdmin) return err(blockedRefusalMessage(blockers));
    // An admin is asked first. Without this the override applies in silence,
    // which is indistinguishable from the constraint not existing — the exact
    // confusion that sent the owner back to ask whether the feature worked.
    if (!input.override) {
      return { ok: false, error: blockedOverridePrompt(blockers), needsOverride: true };
    }
  }

  // Absent on an ordinary move, present only when an admin actually pushed
  // past something. An empty array in every row would make "did anyone
  // override this?" a truthiness check on every reader. References rather
  // than ids, because a human reads this row in a timeline or a CSV.
  const overrodeBlockers =
    blocked && input.isAdmin
      ? { overrodeBlockers: unfinishedBlockers(blockers).map((b) => taskReference(b.reference)) }
      : {};

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
        meta: { name: scope.task.title, from: scope.task.status, to: input.status, ...overrodeBlockers },
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
      // Attachments do NOT cascade. `Attachment.parentId` carries no foreign
      // key by design (schema.prisma:475-480: "a polymorphic parent cannot
      // carry three foreign keys at once … The cost is real and is paid in
      // the service layer"), so `tx.task.delete` above leaves every
      // attachment row on this task standing, each still naming an object in
      // R2 that nothing will ever reach again. This call is the payment.
      // Spec §6:111 calls it "the one place where a missed code path
      // silently leaks storage".
      //
      // **Last in the transaction, deliberately.** This is the only step
      // here that touches a system Postgres cannot roll back: by the time it
      // returns, R2 objects are actually gone, and no later `throw` can undo
      // that. Every operation above it can still fail and roll back cleanly;
      // none of them can now fail *after* the bucket has been changed. Move
      // it earlier and a P2025 race on `task.delete`, or a failure in
      // `clearNotificationsFor`, would roll the rows back into existence
      // pointing at objects that no longer exist — the "row without object"
      // §6:108 names as the failure direction to avoid. Last shrinks that
      // window to the `deleteMany` and the commit itself.
      //
      // It cannot fail this transaction on R2's account: an R2 error is
      // caught, logged and swallowed inside, and every row is deleted
      // regardless. See `deleteAttachmentObjectsFor`'s own comment for why
      // leaking an orphan object beats leaving a row that lies, and why a
      // per-key split is not reachable from inside someone else's
      // transaction.
      await deleteAttachmentObjectsFor(tx, { parentType: "TASK", parentId: input.taskId });
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
): Promise<ActionResult<{ notificationIds: string[] }>> {
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
  if (addedIds.length === 0 && removedIds.length === 0) return ok({ notificationIds: [] });

  // Only the NEW ids are ever checked against the active-user list; a
  // deactivated id already present in `current` never reaches this call.
  const added = addedIds.length > 0 ? await resolveAssignees(db, addedIds) : [];
  if (added === null) return err("Invalid input");

  const removedNames = current.filter((row) => removedIds.includes(row.userId)).map((row) => row.user.name);

  const notificationIds = await db.$transaction(async (tx) => {
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
    return notify(tx, {
      recipientIds: addedIds,
      actorId: input.actorId,
      type: "TASK_ASSIGNED",
      entityType: "TASK",
      entityId: input.taskId,
      meta: { name: scope.task.title },
    });
  });
  return ok({ notificationIds });
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
): Promise<ActionResult<{ notificationIds: string[] }>> {
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
