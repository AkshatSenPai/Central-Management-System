import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { TaskPriority, TaskStatus } from "@/lib/task";

// `removeTask` now sweeps its attachments' R2 objects, so `task-service.ts`
// imports `attachment-service.ts`, which imports `r2.ts` Ã¢â‚¬â€ and `r2.ts`
// constructs its `S3Client` at *module scope*, reading four env vars that do
// not exist in a test run (`r2.ts:83-97`, and the comment there defending
// eager construction: an unset variable should fail by name at load, not
// with a signature error minutes later). Without this mock the module graph
// throws on import and this entire file fails to load, before a single test
// runs.
//
// The same `vi.mock` `tests/attachment-service.test.ts` uses, for the same
// reason its header gives at length. Keeping it means `r2.ts` keeps the
// eager-failure property it was deliberately given, rather than that
// property being traded away to make a test file load.
vi.mock("@/lib/r2", () => ({
  deleteObjects: vi.fn(async () => undefined),
  R2DeleteObjectsError: class extends Error {},
}));

import { deleteObjects } from "@/lib/r2";
import { createTask, updateTask, setTaskStatus, removeTask, setTaskAssignees } from "@/lib/task-service";

const mockDeleteObjects = vi.mocked(deleteObjects);

beforeEach(() => {
  mockDeleteObjects.mockReset();
  mockDeleteObjects.mockResolvedValue(undefined);
});

type FakeParts = {
  /** Row returned by task.findUnique Ã¢â‚¬â€ loadTaskScope's walk-up target. */
  task?: unknown;
  /** Rows returned by task.findMany Ã¢â‚¬â€ the sibling order query. */
  siblings?: { order: number }[];
  /** Row returned by project.findUnique Ã¢â‚¬â€ createTask's own parent lookup. */
  project?: unknown;
  /** Row returned by milestone.findUnique Ã¢â‚¬â€ the pair rule. */
  milestone?: unknown;
  /** Rows returned by user.findMany Ã¢â‚¬â€ resolveAssignees. */
  activeUsers?: { id: string; name: string }[];
  /** Rows returned by taskAssignee.findMany Ã¢â‚¬â€ setTaskAssignees' current set,
   * carrying names so the remove side never needs an active-user lookup. */
  currentAssignees?: { userId: string; user: { name: string } }[];
  /** Thrown by task.delete when set Ã¢â‚¬â€ simulates a concurrent P2025 raised
   * when the row was already gone by the time the transaction ran. */
  taskDeleteError?: unknown;
  /** Rows returned by attachment.findMany Ã¢â‚¬â€ what `removeTask`'s
   * `deleteAttachmentObjectsFor` sweep finds under this task. Absent means a
   * task with nothing attached, which is the shape every pre-existing test
   * in this file assumes. */
  attachments?: { id: string; fileKey: string }[];
};

type Sink = {
  created: Record<string, unknown>[];
  updated: Record<string, unknown>[];
  deleted: unknown[];
  activity: Record<string, unknown>[];
  assigneesCreated: Record<string, unknown>[];
  assigneesDeleted: Record<string, unknown>[];
  /** Rows handed to notification.createMany, flattened. Phase 4: a
   * notification must be written in the SAME transaction as the mutation
   * that caused it, so this sink proves which client it was called on. */
  notifications: Record<string, unknown>[];
  notificationsCleared: Record<string, unknown>[];
  /** `where` clauses handed to attachment.deleteMany by the sweep. In txW
   * for a correct implementation; anything landing in dbW means the sweep
   * escaped `removeTask`'s transaction. */
  attachmentsDeleted: unknown[];
};

function emptySink(): Sink {
  return {
    created: [],
    updated: [],
    deleted: [],
    activity: [],
    assigneesCreated: [],
    assigneesDeleted: [],
    notifications: [],
    notificationsCleared: [],
    attachmentsDeleted: [],
  };
}

/** The Phase 2 fake shape, plus a second capture sink for the transaction
 * client. Reads are shared between `db` and `tx`, but writes go to the sink
 * they were called on Ã¢â‚¬â€ so a write issued on the outer `db` (a
 * non-transactional slip, including `recordActivity(db, Ã¢â‚¬Â¦)` instead of
 * `recordActivity(tx, Ã¢â‚¬Â¦)`) lands in `dbW` and fails any test asserting it
 * empty, instead of silently passing. */
function fakeDb(parts: FakeParts) {
  const dbW = emptySink();
  const txW = emptySink();
  const calls = { projectFindUnique: 0, milestoneFindUnique: 0, taskFindMany: 0, userFindMany: 0 };
  const args: {
    taskFindManyWhere?: unknown;
    userFindManyWhere?: unknown;
    taskAssigneeFindManyWhere?: unknown;
    attachmentFindManyWhere?: unknown;
  } = {};

  const reads = {
    task: {
      findUnique: async () => parts.task ?? null,
      findMany: async (a: { where: unknown }) => {
        calls.taskFindMany++;
        args.taskFindManyWhere = a.where;
        return parts.siblings ?? [];
      },
    },
    project: {
      findUnique: async () => {
        calls.projectFindUnique++;
        return parts.project ?? null;
      },
    },
    milestone: {
      findUnique: async () => {
        calls.milestoneFindUnique++;
        return parts.milestone ?? null;
      },
    },
    user: {
      findMany: async (a: { where: unknown }) => {
        calls.userFindMany++;
        args.userFindManyWhere = a.where;
        return parts.activeUsers ?? [];
      },
    },
    taskAssignee: {
      findMany: async (a: { where: unknown }) => {
        args.taskAssigneeFindManyWhere = a.where;
        return parts.currentAssignees ?? [];
      },
    },
    attachment: {
      // Returns the fixture regardless of `where`, and the scope is asserted
      // separately off `args.attachmentFindManyWhere` Ã¢â‚¬â€ the same call
      // `tests/attachment-service.test.ts`'s own fake makes, for the reason
      // recorded there: a fake that filtered by `where` itself would hide a
      // sweep that dropped `parentId` and deleted every TASK attachment in
      // the database, because the fixture would come back either way.
      findMany: async (a: { where: unknown }) => {
        args.attachmentFindManyWhere = a.where;
        return parts.attachments ?? [];
      },
    },
  };

  const writers = (sink: Sink) => ({
    task: {
      create: async (a: { data: Record<string, unknown> }) => {
        sink.created.push(a.data);
        return { id: "new1", ...a.data };
      },
      update: async (a: { data: Record<string, unknown> }) => {
        sink.updated.push(a.data);
        return a.data;
      },
      delete: async (a: unknown) => {
        if (parts.taskDeleteError) throw parts.taskDeleteError;
        sink.deleted.push(a);
        return {};
      },
    },
    taskAssignee: {
      createMany: async (a: Record<string, unknown>) => {
        sink.assigneesCreated.push(a);
        // What real Postgres returns when ON CONFLICT DO NOTHING absorbs
        // every row: a success carrying a zero count, never a throw.
        return { count: 0 };
      },
      deleteMany: async (a: Record<string, unknown>) => {
        sink.assigneesDeleted.push(a);
        return { count: 0 };
      },
    },
    activityLog: {
      create: async (a: { data: Record<string, unknown> }) => {
        sink.activity.push(a.data);
        return a.data;
      },
    },
    notification: {
      // createManyAndReturn, not createMany: notify() hands the new ids back
      // so the push fan-out can re-read the exact rows the bell will render.
      createManyAndReturn: async (a: { data: Record<string, unknown>[] }) => {
        sink.notifications.push(...a.data);
        return a.data.map((_, i) => ({ id: `notif${i + 1}` }));
      },
      deleteMany: async (a: Record<string, unknown>) => {
        sink.notificationsCleared.push(a);
        return { count: 0 };
      },
    },
    attachment: {
      deleteMany: async (a: unknown) => {
        sink.attachmentsDeleted.push(a);
        return { count: 0 };
      },
    },
  });

  const db = {
    task: { ...reads.task, ...writers(dbW).task },
    project: reads.project,
    milestone: reads.milestone,
    user: reads.user,
    taskAssignee: { ...reads.taskAssignee, ...writers(dbW).taskAssignee },
    activityLog: writers(dbW).activityLog,
    notification: writers(dbW).notification,
    attachment: { ...reads.attachment, ...writers(dbW).attachment },
    // Mirrors real transactional rollback: a thrown error undoes everything
    // this specific call pushed into txW before the error propagates, so a
    // retry that starts a fresh $transaction never inherits a previous
    // failed attempt's partial writes (the way a real rolled-back Postgres
    // transaction never leaves them behind either).
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const before = {
        created: txW.created.length,
        updated: txW.updated.length,
        deleted: txW.deleted.length,
        activity: txW.activity.length,
        assigneesCreated: txW.assigneesCreated.length,
        assigneesDeleted: txW.assigneesDeleted.length,
        notifications: txW.notifications.length,
        notificationsCleared: txW.notificationsCleared.length,
        attachmentsDeleted: txW.attachmentsDeleted.length,
      };
      try {
        return await fn({
          task: { ...reads.task, ...writers(txW).task },
          project: reads.project,
          milestone: reads.milestone,
          user: reads.user,
          taskAssignee: { ...reads.taskAssignee, ...writers(txW).taskAssignee },
          activityLog: writers(txW).activityLog,
          notification: writers(txW).notification,
          attachment: { ...reads.attachment, ...writers(txW).attachment },
        });
      } catch (e) {
        txW.created.length = before.created;
        txW.updated.length = before.updated;
        txW.deleted.length = before.deleted;
        txW.activity.length = before.activity;
        txW.assigneesCreated.length = before.assigneesCreated;
        txW.assigneesDeleted.length = before.assigneesDeleted;
        txW.notifications.length = before.notifications;
        txW.notificationsCleared.length = before.notificationsCleared;
        txW.attachmentsDeleted.length = before.attachmentsDeleted;
        throw e;
      }
    },
  } as unknown as PrismaClient;

  return { db, dbW, txW, calls, args };
}

const project1 = { id: "p1", clientId: "c1" };
const project2 = { id: "p2", clientId: "c2" };

const taskWithProject = {
  id: "t1",
  title: "Draft brand brief",
  description: "Initial notes",
  projectId: "p1",
  milestoneId: "m1",
  status: "TO_DO",
  priority: "MEDIUM",
  dueDate: null,
  project: { clientId: "c1" },
  // Phase 4: setTaskStatus reads these to find who cares about the change.
  creatorId: "u-creator",
  assignees: [{ userId: "u-assignee" }],
};

const personalTask = {
  id: "t2",
  title: "Renew passport",
  description: null,
  projectId: null,
  milestoneId: null,
  status: "TO_DO",
  priority: "LOW",
  dueDate: null,
  project: null,
  creatorId: "u-creator",
  assignees: [{ userId: "u-assignee" }],
};

const baseCreateInput = {
  title: "Draft brand brief",
  description: null as string | null,
  projectId: null as string | null,
  milestoneId: null as string | null,
  priority: "MEDIUM" as TaskPriority,
  dueDate: null as Date | null,
  status: "TO_DO" as TaskStatus,
  assigneeIds: [] as string[],
  actorId: "u1",
};

describe("createTask", () => {
  it("rejects a blank title", async () => {
    const { db } = fakeDb({});
    expect(await createTask(db, { ...baseCreateInput, title: "   " })).toEqual({
      ok: false,
      error: "Task title is required",
    });
  });

  it("errors on an unknown project", async () => {
    const { db } = fakeDb({});
    expect(await createTask(db, { ...baseCreateInput, projectId: "ghost" })).toEqual({
      ok: false,
      error: "Project not found",
    });
  });

  it("scopes the sibling order query to the project", async () => {
    const { db, args } = fakeDb({ project: project1, siblings: [] });
    await createTask(db, { ...baseCreateInput, projectId: "p1" });
    expect(args.taskFindManyWhere).toEqual({ projectId: "p1" });
  });

  it("scopes the sibling order query to the creator's own personal tasks when there is no project", async () => {
    const { db, args } = fakeDb({ siblings: [] });
    await createTask(db, { ...baseCreateInput, projectId: null, actorId: "u1" });
    expect(args.taskFindManyWhere).toEqual({ projectId: null, creatorId: "u1" });
  });

  it("writes order 0 for the first task in its scope", async () => {
    const { db, txW } = fakeDb({ siblings: [] });
    await createTask(db, { ...baseCreateInput });
    expect(txW.created[0].order).toBe(0);
  });

  it("writes one more than the highest existing order", async () => {
    const { db, txW } = fakeDb({ siblings: [{ order: 4 }] });
    await createTask(db, { ...baseCreateInput });
    expect(txW.created[0].order).toBe(5);
  });

  it("stores the creator as the actor", async () => {
    const { db, txW } = fakeDb({ siblings: [] });
    await createTask(db, { ...baseCreateInput, actorId: "u7" });
    expect(txW.created[0].creatorId).toBe("u7");
  });

  it("logs task.created carrying the grandparent clientId", async () => {
    const { db, txW } = fakeDb({ project: project1, siblings: [] });
    await createTask(db, { ...baseCreateInput, projectId: "p1" });
    expect(txW.activity[0]).toMatchObject({
      entityType: "TASK",
      entityId: "new1",
      action: "task.created",
      clientId: "c1",
    });
  });

  it("logs a personal task with a null client scope and issues no project query at all", async () => {
    const { db, txW, calls } = fakeDb({ siblings: [] });
    await createTask(db, { ...baseCreateInput, projectId: null });
    expect(txW.activity[0].clientId).toBeNull();
    expect(calls.projectFindUnique).toBe(0);
  });

  it("logs exactly one activity row even when created with assignees", async () => {
    const { db, txW } = fakeDb({
      siblings: [],
      activeUsers: [{ id: "u2", name: "Riley" }],
    });
    await createTask(db, { ...baseCreateInput, assigneeIds: ["u2"] });
    expect(txW.activity).toHaveLength(1);
    expect(txW.activity[0].action).toBe("task.created");
  });

  it("creates one TaskAssignee row per assignee inside the same transaction as the task and its activity row", async () => {
    const { db, dbW, txW } = fakeDb({
      siblings: [],
      activeUsers: [
        { id: "u2", name: "Riley" },
        { id: "u3", name: "Sam" },
      ],
    });
    await createTask(db, { ...baseCreateInput, assigneeIds: ["u2", "u3"] });
    expect(txW.created).toHaveLength(1);
    expect(txW.assigneesCreated).toHaveLength(1);
    expect(txW.assigneesCreated[0].data).toHaveLength(2);
    expect(txW.activity).toHaveLength(1);
    expect(dbW.created).toHaveLength(0);
    expect(dbW.assigneesCreated).toHaveLength(0);
    expect(dbW.activity).toHaveLength(0);
  });

  it("passes skipDuplicates on the assignee insert", async () => {
    const { db, txW } = fakeDb({ siblings: [], activeUsers: [{ id: "u2", name: "Riley" }] });
    await createTask(db, { ...baseCreateInput, assigneeIds: ["u2"] });
    expect(txW.assigneesCreated[0].skipDuplicates).toBe(true);
  });

  it("rejects an unknown or deactivated assignee id", async () => {
    const { db, dbW, txW } = fakeDb({ siblings: [], activeUsers: [] });
    const result = await createTask(db, { ...baseCreateInput, assigneeIds: ["ghost"] });
    expect(result).toEqual({ ok: false, error: "Invalid input" });
    expect(txW.created).toHaveLength(0);
    expect(txW.assigneesCreated).toHaveLength(0);
    expect(dbW.created).toHaveLength(0);
  });

  it("asks only for active users when resolving assignees", async () => {
    const { db, args } = fakeDb({ siblings: [], activeUsers: [{ id: "u2", name: "Riley" }] });
    await createTask(db, { ...baseCreateInput, assigneeIds: ["u2"] });
    expect(args.userFindManyWhere).toEqual({ id: { in: ["u2"] }, active: true });
  });

  it("rejects a milestone belonging to a different project", async () => {
    const { db } = fakeDb({ project: project1, milestone: { id: "m1", projectId: "p9" } });
    const result = await createTask(db, { ...baseCreateInput, projectId: "p1", milestoneId: "m1" });
    expect(result).toEqual({ ok: false, error: "That milestone belongs to a different project" });
  });

  it("rejects an unknown milestone with the same message", async () => {
    const { db } = fakeDb({ project: project1 });
    const result = await createTask(db, { ...baseCreateInput, projectId: "p1", milestoneId: "ghost" });
    expect(result).toEqual({ ok: false, error: "That milestone belongs to a different project" });
  });

  it("rejects a milestone supplied for a task with no project, with the same message", async () => {
    const { db } = fakeDb({});
    const result = await createTask(db, { ...baseCreateInput, projectId: null, milestoneId: "m1" });
    expect(result).toEqual({ ok: false, error: "That milestone belongs to a different project" });
  });

  it("accepts a milestone belonging to the task's own project", async () => {
    const { db, txW } = fakeDb({
      project: project1,
      milestone: { id: "m1", projectId: "p1" },
      siblings: [],
    });
    const result = await createTask(db, { ...baseCreateInput, projectId: "p1", milestoneId: "m1" });
    expect(result.ok).toBe(true);
    expect(txW.created[0].milestoneId).toBe("m1");
  });
});

const baseUpdateInput = {
  taskId: "t1",
  title: "Draft brand brief",
  description: "Initial notes" as string | null,
  projectId: "p1" as string | null,
  milestoneId: "m1" as string | null,
  priority: "MEDIUM" as TaskPriority,
  dueDate: null as Date | null,
  actorId: "u1",
};

describe("updateTask", () => {
  it("errors on an unknown task", async () => {
    const { db } = fakeDb({});
    expect(await updateTask(db, { ...baseUpdateInput, taskId: "ghost" })).toEqual({
      ok: false,
      error: "Task not found",
    });
  });

  it("writes no activity when nothing changed", async () => {
    const { db, txW, dbW } = fakeDb({ task: taskWithProject, milestone: { id: "m1", projectId: "p1" } });
    const result = await updateTask(db, { ...baseUpdateInput });
    expect(result).toEqual({ ok: true, data: undefined });
    expect(txW.updated).toHaveLength(0);
    expect(txW.activity).toHaveLength(0);
    expect(dbW.updated).toHaveLength(0);
  });

  it("logs task.updated with the changed fields in meta", async () => {
    const { db, txW } = fakeDb({ task: taskWithProject, milestone: { id: "m1", projectId: "p1" } });
    await updateTask(db, { ...baseUpdateInput, priority: "HIGH" });
    expect(txW.activity[0]).toMatchObject({ action: "task.updated", clientId: "c1" });
    expect(txW.activity[0].meta).toMatchObject({
      changes: { priority: { from: "MEDIUM", to: "HIGH" } },
    });
  });

  it("clearing the project clears the milestone in the same write", async () => {
    const { db, txW, calls } = fakeDb({ task: taskWithProject });
    await updateTask(db, { ...baseUpdateInput, projectId: null, milestoneId: null });
    expect(txW.updated[0]).toEqual({ projectId: null, milestoneId: null });
    expect(calls.milestoneFindUnique).toBe(0);
  });

  it("rejects moving a task to another project while it still carries the old project's milestone", async () => {
    const { db } = fakeDb({ task: taskWithProject, milestone: { id: "m1", projectId: "p1" } });
    // milestoneId is left as "m1" (its old value) while projectId moves to "p2".
    const result = await updateTask(db, { ...baseUpdateInput, projectId: "p2" });
    expect(result).toEqual({ ok: false, error: "That milestone belongs to a different project" });
  });

  it("rejects clearing the project while still carrying a milestone id", async () => {
    const { db } = fakeDb({ task: taskWithProject });
    const result = await updateTask(db, { ...baseUpdateInput, projectId: null });
    expect(result).toEqual({ ok: false, error: "That milestone belongs to a different project" });
  });

  it("a cross-client project move logs task.updated under the OLD client's id", async () => {
    // taskWithProject's pre-move project (p1) belongs to client c1; whatever
    // client the new project (p2) belongs to is irrelevant Ã¢â‚¬â€ the row must
    // carry the client whose timeline the task is leaving. project2 must
    // exist so the target-project guard lets the move through.
    const { db, txW } = fakeDb({ task: taskWithProject, project: project2 });
    await updateTask(db, { ...baseUpdateInput, projectId: "p2", milestoneId: null });
    expect(txW.activity[0]).toMatchObject({ action: "task.updated", clientId: "c1" });
  });

  it("errors when moved to a project that does not exist", async () => {
    const { db, txW, dbW } = fakeDb({ task: taskWithProject });
    // milestoneId is cleared so the pair rule doesn't intercept this first Ã¢â‚¬â€
    // the point here is the target project itself is missing.
    const result = await updateTask(db, { ...baseUpdateInput, projectId: "ghost", milestoneId: null });
    expect(result).toEqual({ ok: false, error: "Project not found" });
    expect(txW.updated).toHaveLength(0);
    expect(txW.activity).toHaveLength(0);
    expect(dbW.updated).toHaveLength(0);
    expect(dbW.activity).toHaveLength(0);
  });

  it("issues no project lookup when the project is unchanged", async () => {
    const { db, calls } = fakeDb({ task: taskWithProject, milestone: { id: "m1", projectId: "p1" } });
    await updateTask(db, { ...baseUpdateInput });
    expect(calls.projectFindUnique).toBe(0);
  });

  it("clearing the project to personal logs task.updated under the old client's id", async () => {
    const { db, txW } = fakeDb({ task: taskWithProject });
    await updateTask(db, { ...baseUpdateInput, projectId: null, milestoneId: null });
    expect(txW.activity[0]).toMatchObject({ action: "task.updated", clientId: "c1" });
  });

  // The mirror of the case above, and deliberately NOT symmetric with it. R13
  // narrates a move on the timeline it is leaving, but a personal task has no
  // timeline to leave Ã¢â‚¬â€ scoping to the pre-move client would write null and
  // put the row on no timeline at all.
  it("adopting a personal task into a project logs task.updated under the destination client", async () => {
    const { db, txW } = fakeDb({ task: personalTask, project: project1 });
    await updateTask(db, {
      ...baseUpdateInput,
      taskId: "t2",
      title: personalTask.title,
      description: null,
      priority: "LOW",
      projectId: "p1",
      milestoneId: null,
    });
    expect(txW.activity[0]).toMatchObject({ action: "task.updated", clientId: "c1" });
  });

  // Guards the asymmetry from being "tidied" into always preferring the
  // destination: a project-to-project move must still leave its old timeline.
  it("moving between clients still logs under the pre-move client, not the destination", async () => {
    const { db, txW } = fakeDb({ task: taskWithProject, project: project2 });
    await updateTask(db, { ...baseUpdateInput, projectId: "p2", milestoneId: null });
    expect(txW.activity[0]).toMatchObject({ action: "task.updated", clientId: "c1" });
  });

  it("never writes order, creatorId, status or the assignee set", async () => {
    const { db, txW } = fakeDb({ task: taskWithProject, milestone: { id: "m1", projectId: "p1" } });
    await updateTask(db, { ...baseUpdateInput, priority: "HIGH" });
    const keys = Object.keys(txW.updated[0]);
    expect(keys).not.toContain("order");
    expect(keys).not.toContain("creatorId");
    expect(keys).not.toContain("status");
    expect(keys).not.toContain("assigneeIds");
  });
});

describe("setTaskStatus", () => {
  it("writes nothing at all when the status is unchanged", async () => {
    const { db, txW, dbW } = fakeDb({ task: taskWithProject });
    const result = await setTaskStatus(db, { taskId: "t1", status: "TO_DO", actorId: "u1" });
    expect(result).toEqual({ ok: true, data: undefined });
    expect(txW.updated).toHaveLength(0);
    expect(txW.activity).toHaveLength(0);
    expect(dbW.updated).toHaveLength(0);
  });

  it("logs task.status_changed with from and to in meta and the grandparent clientId", async () => {
    const { db, txW } = fakeDb({ task: taskWithProject });
    await setTaskStatus(db, { taskId: "t1", status: "IN_PROGRESS", actorId: "u1" });
    expect(txW.activity[0]).toMatchObject({ action: "task.status_changed", clientId: "c1" });
    expect(txW.activity[0].meta).toMatchObject({ from: "TO_DO", to: "IN_PROGRESS" });
  });

  it("logs a personal task's status change with a null client scope", async () => {
    const { db, txW } = fakeDb({ task: personalTask });
    await setTaskStatus(db, { taskId: "t2", status: "DONE", actorId: "u1" });
    expect(txW.activity[0]).toMatchObject({ action: "task.status_changed", clientId: null });
  });

  it("writes the update and the activity row inside the transaction", async () => {
    const { db, txW, dbW } = fakeDb({ task: taskWithProject });
    await setTaskStatus(db, { taskId: "t1", status: "DONE", actorId: "u1" });
    expect(txW.updated).toHaveLength(1);
    expect(txW.activity).toHaveLength(1);
    expect(dbW.updated).toHaveLength(0);
    expect(dbW.activity).toHaveLength(0);
  });
});

describe("removeTask", () => {
  it("errors on an unknown task", async () => {
    const { db } = fakeDb({});
    expect(await removeTask(db, { taskId: "ghost", actorId: "u1" })).toEqual({
      ok: false,
      error: "Task not found",
    });
  });

  it("deletes the task and logs task.removed with the title captured before the delete", async () => {
    const { db, txW } = fakeDb({ task: taskWithProject });
    const result = await removeTask(db, { taskId: "t1", actorId: "u1" });
    expect(result).toEqual({ ok: true, data: undefined });
    expect(txW.deleted).toHaveLength(1);
    expect(txW.activity[0]).toMatchObject({ action: "task.removed", clientId: "c1" });
    expect(txW.activity[0].meta).toMatchObject({ name: "Draft brand brief" });
  });

  it("relies on the Cascade for its assignees and checklist", async () => {
    const { db, txW } = fakeDb({ task: taskWithProject });
    await removeTask(db, { taskId: "t1", actorId: "u1" });
    expect(txW.assigneesDeleted).toHaveLength(0);
  });

  it("maps a concurrently-deleted row to the not-found error rather than throwing", async () => {
    const race = new Prisma.PrismaClientKnownRequestError("Record to delete does not exist.", {
      code: "P2025",
      clientVersion: "test",
    });
    const { db } = fakeDb({ task: taskWithProject, taskDeleteError: race });
    const result = await removeTask(db, { taskId: "t1", actorId: "u1" });
    expect(result).toEqual({ ok: false, error: "Task not found" });
  });

  // Spec Ã‚Â§6:111 Ã¢â‚¬â€ "the one place where a missed code path silently leaks
  // storage, and it is the part to review hardest". Until this call site
  // existed, `deleteAttachmentObjectsFor` had no caller at all, so every
  // claim its doc comment makes about running nested inside someone else's
  // transaction was untested reasoning. These are that path's first
  // automated coverage. They cannot prove the objects actually left the
  // bucket Ã¢â‚¬â€ only a real browser pass listing the prefix can, and that is
  // task 7's job Ã¢â‚¬â€ but they can prove the sweep is *reached*, with the right
  // scope, on the right sink, and that no ordinary failure skips it.
  describe("the attachment sweep", () => {
    const attachments = [
      { id: "a1", fileKey: "TASK/t1/uuid1/brief.pdf" },
      { id: "a2", fileKey: "TASK/t1/uuid2/logo.png" },
    ];

    it("deletes every R2 object under the task, and the rows naming them", async () => {
      const { db, txW } = fakeDb({ task: taskWithProject, attachments });
      const result = await removeTask(db, { taskId: "t1", actorId: "u1" });
      expect(result).toEqual({ ok: true, data: undefined });
      expect(mockDeleteObjects).toHaveBeenCalledWith([
        "TASK/t1/uuid1/brief.pdf",
        "TASK/t1/uuid2/logo.png",
      ]);
      expect(txW.attachmentsDeleted).toEqual([{ where: { id: { in: ["a1", "a2"] } } }]);
    });

    // The scope, asserted directly rather than inferred from which rows came
    // back Ã¢â‚¬â€ the fake returns its fixture regardless of `where`, precisely so
    // a sweep that dropped `parentId` (and would delete every TASK
    // attachment in the database) cannot pass by returning the same rows.
    it("scopes the sweep to this task, by both parentType and parentId", async () => {
      const { db, args } = fakeDb({ task: taskWithProject, attachments });
      await removeTask(db, { taskId: "t1", actorId: "u1" });
      expect(args.attachmentFindManyWhere).toEqual({ parentType: "TASK", parentId: "t1" });
    });

    // Nested inside `removeTask`'s own transaction, which is the premise the
    // whole "leak rather than lie" ruling rests on: a sweep running on the
    // outer `db` would commit row deletions the enclosing transaction could
    // no longer roll back.
    it("runs inside the transaction Ã¢â‚¬â€ nothing lands on the outer db", async () => {
      const { db, dbW, txW } = fakeDb({ task: taskWithProject, attachments });
      await removeTask(db, { taskId: "t1", actorId: "u1" });
      expect(dbW.attachmentsDeleted).toHaveLength(0);
      expect(txW.attachmentsDeleted).toHaveLength(1);
    });

    // The leak-not-lie ruling itself. R2 refuses; the rows go anyway; the
    // task delete still succeeds. The alternative Ã¢â‚¬â€ abort Ã¢â‚¬â€ would leave rows
    // pointing at objects that may already be gone, under a task that no
    // longer exists, and would fail a delete the user asked for because a
    // bucket had a hiccup.
    it("still deletes the rows, and still succeeds, when R2 refuses", async () => {
      mockDeleteObjects.mockRejectedValue(new Error("R2 unreachable"));
      const { db, txW } = fakeDb({ task: taskWithProject, attachments });
      const result = await removeTask(db, { taskId: "t1", actorId: "u1" });
      expect(result).toEqual({ ok: true, data: undefined });
      expect(txW.attachmentsDeleted).toEqual([{ where: { id: { in: ["a1", "a2"] } } }]);
      expect(txW.deleted).toHaveLength(1);
    });

    it("touches R2 not at all for a task with nothing attached", async () => {
      const { db, txW } = fakeDb({ task: taskWithProject });
      await removeTask(db, { taskId: "t1", actorId: "u1" });
      expect(mockDeleteObjects).not.toHaveBeenCalled();
      expect(txW.attachmentsDeleted).toHaveLength(0);
    });

    // The ordering decision at this call site: the sweep is the LAST
    // statement in the transaction, so it is never reached by a run that is
    // about to roll back for an unrelated reason. A P2025 on `task.delete`
    // is exactly that run Ã¢â‚¬â€ and if the sweep had been placed first, R2
    // objects would already be gone by the time the rollback restored the
    // rows that name them.
    it("is never reached when the task delete itself loses a race", async () => {
      const race = new Prisma.PrismaClientKnownRequestError("Record to delete does not exist.", {
        code: "P2025",
        clientVersion: "test",
      });
      const { db, txW } = fakeDb({ task: taskWithProject, attachments, taskDeleteError: race });
      await removeTask(db, { taskId: "t1", actorId: "u1" });
      expect(mockDeleteObjects).not.toHaveBeenCalled();
      expect(txW.attachmentsDeleted).toHaveLength(0);
    });
  });
});

const taskForAssign = {
  id: "t1",
  title: "Ship the deck",
  description: null,
  projectId: "p1",
  milestoneId: null,
  status: "TO_DO",
  priority: "MEDIUM",
  dueDate: null,
  project: { clientId: "c1" },
};

describe("setTaskAssignees", () => {
  it("errors on an unknown task", async () => {
    const { db } = fakeDb({});
    expect(await setTaskAssignees(db, { taskId: "ghost", userIds: [], actorId: "u1" })).toEqual({
      ok: false,
      error: "Task not found",
    });
  });

  it("deletes only the departed and creates only the newcomers", async () => {
    const { db, txW, args } = fakeDb({
      task: taskForAssign,
      currentAssignees: [
        { userId: "u1", user: { name: "Alex Kim" } },
        { userId: "u2", user: { name: "Jordan Lee" } },
      ],
      activeUsers: [{ id: "u3", name: "Sam Ortiz" }],
    });
    const result = await setTaskAssignees(db, { taskId: "t1", userIds: ["u2", "u3"], actorId: "u1" });
    // Assignees were added, so notify() wrote rows and returned their ids.
    // This test is about the assignee diff; the ids themselves belong to
    // tests/notifications.test.ts.
    expect(result.ok).toBe(true);
    expect(txW.assigneesDeleted[0].where).toEqual({ taskId: "t1", userId: { in: ["u1"] } });
    expect(txW.assigneesCreated[0].data).toEqual([{ taskId: "t1", userId: "u3" }]);
    // Guards against dropping `where: { taskId }` from the taskAssignee.findMany
    // call, which would make `current` every TaskAssignee row in the database
    // rather than just this task's.
    expect(args.taskAssigneeFindManyWhere).toEqual({ taskId: "t1" });
  });

  it("never issues a blanket delete of every assignee row", async () => {
    const { db, txW } = fakeDb({
      task: taskForAssign,
      currentAssignees: [
        { userId: "u1", user: { name: "Alex Kim" } },
        { userId: "u2", user: { name: "Jordan Lee" } },
      ],
      activeUsers: [{ id: "u3", name: "Sam Ortiz" }],
    });
    await setTaskAssignees(db, { taskId: "t1", userIds: ["u2", "u3"], actorId: "u1" });
    expect(txW.assigneesDeleted[0].where).not.toEqual({ taskId: "t1" });
  });

  it("writes nothing at all when the requested set matches the current one", async () => {
    const { db, txW, dbW } = fakeDb({
      task: taskForAssign,
      currentAssignees: [
        { userId: "u1", user: { name: "Alex Kim" } },
        { userId: "u2", user: { name: "Jordan Lee" } },
      ],
    });
    const result = await setTaskAssignees(db, { taskId: "t1", userIds: ["u2", "u1"], actorId: "u1" });
    expect(result).toEqual({ ok: true, data: { notificationIds: [] } });
    expect(txW.assigneesDeleted).toHaveLength(0);
    expect(txW.assigneesCreated).toHaveLength(0);
    expect(txW.activity).toHaveLength(0);
    expect(dbW.assigneesDeleted).toHaveLength(0);
    expect(dbW.assigneesCreated).toHaveLength(0);
  });

  it("de-duplicates repeated ids in the input", async () => {
    const { db, txW } = fakeDb({
      task: taskForAssign,
      currentAssignees: [],
      activeUsers: [{ id: "u2", name: "Jordan Lee" }],
    });
    await setTaskAssignees(db, { taskId: "t1", userIds: ["u2", "u2", "u2"], actorId: "u1" });
    expect(txW.assigneesCreated[0].data).toEqual([{ taskId: "t1", userId: "u2" }]);
  });

  it("logs exactly one task.assigned row naming everyone added", async () => {
    const { db, txW } = fakeDb({
      task: taskForAssign,
      currentAssignees: [],
      activeUsers: [{ id: "u2", name: "Dana Reeve" }],
    });
    await setTaskAssignees(db, { taskId: "t1", userIds: ["u2"], actorId: "u1" });
    expect(txW.activity).toHaveLength(1);
    expect(txW.activity[0]).toMatchObject({ action: "task.assigned" });
    expect(txW.activity[0].meta).toEqual({ name: "Ship the deck", people: ["Dana Reeve"] });
  });

  it("logs exactly one task.unassigned row naming everyone removed", async () => {
    const { db, txW } = fakeDb({
      task: taskForAssign,
      currentAssignees: [{ userId: "u1", user: { name: "Alex Kim" } }],
    });
    await setTaskAssignees(db, { taskId: "t1", userIds: [], actorId: "u1" });
    expect(txW.activity).toHaveLength(1);
    expect(txW.activity[0]).toMatchObject({ action: "task.unassigned" });
    expect(txW.activity[0].meta).toEqual({ name: "Ship the deck", people: ["Alex Kim"] });
  });

  it("a mixed add-and-remove produces exactly two activity rows", async () => {
    const { db, txW } = fakeDb({
      task: taskForAssign,
      currentAssignees: [{ userId: "u1", user: { name: "Alex Kim" } }],
      activeUsers: [{ id: "u2", name: "Jordan Lee" }],
    });
    await setTaskAssignees(db, { taskId: "t1", userIds: ["u2"], actorId: "u1" });
    expect(txW.activity).toHaveLength(2);
    expect(txW.activity[0].action).toBe("task.assigned");
    expect(txW.activity[1].action).toBe("task.unassigned");
  });

  it("stores names rather than ids in meta", async () => {
    const { db, txW } = fakeDb({
      task: taskForAssign,
      currentAssignees: [{ userId: "u1", user: { name: "Alex Kim" } }],
      activeUsers: [{ id: "u2", name: "Jordan Lee" }],
    });
    await setTaskAssignees(db, { taskId: "t1", userIds: ["u2"], actorId: "u1" });
    const people = txW.activity.flatMap((row) => (row.meta as { people: string[] }).people);
    expect(people).toEqual(["Jordan Lee", "Alex Kim"]);
    expect(people).not.toContain("u1");
    expect(people).not.toContain("u2");
  });

  it("resolves removed names from the current rows, not from an active-user lookup", async () => {
    const { db, args } = fakeDb({
      task: taskForAssign,
      currentAssignees: [{ userId: "u1", user: { name: "Alex Kim" } }],
      activeUsers: [{ id: "u2", name: "Jordan Lee" }],
    });
    await setTaskAssignees(db, { taskId: "t1", userIds: ["u2"], actorId: "u1" });
    expect(args.userFindManyWhere).toEqual({ id: { in: ["u2"] }, active: true });
  });

  it("leaves a deactivated current assignee alone when re-submitted unchanged", async () => {
    // u1 stands in for a deactivated member: still assigned, re-submitted
    // as part of the same set, and never active in this fixture at all.
    const { db, txW, dbW, calls } = fakeDb({
      task: taskForAssign,
      currentAssignees: [
        { userId: "u1", user: { name: "Alex Kim" } },
        { userId: "u2", user: { name: "Jordan Lee" } },
      ],
    });
    const result = await setTaskAssignees(db, { taskId: "t1", userIds: ["u1", "u2"], actorId: "u1" });
    expect(result).toEqual({ ok: true, data: { notificationIds: [] } });
    expect(txW.assigneesDeleted).toHaveLength(0);
    expect(txW.assigneesCreated).toHaveLength(0);
    expect(txW.activity).toHaveLength(0);
    expect(dbW.assigneesDeleted).toHaveLength(0);
    expect(dbW.assigneesCreated).toHaveLength(0);
    // No addedIds at all means resolveAssignees (and its user.findMany) is
    // never called Ã¢â‚¬â€ u1 never reaches the active-user check.
    expect(calls.userFindMany).toBe(0);
  });

  it("leaves a deactivated current assignee's row alone when new ids are also added alongside it", async () => {
    // u1 stands in for a deactivated member: still assigned, re-submitted
    // unchanged as part of the same set, while u3 is a genuinely new id. The
    // obvious refactor to computing survivors from resolved-active ids
    // (instead of a true current/requested diff) would pass every other
    // test in this file while silently deleting u1's row here.
    const { db, txW, args } = fakeDb({
      task: taskForAssign,
      currentAssignees: [
        { userId: "u1", user: { name: "Alex Kim" } },
        { userId: "u2", user: { name: "Jordan Lee" } },
      ],
      activeUsers: [{ id: "u3", name: "Sam Ortiz" }],
    });
    const result = await setTaskAssignees(db, { taskId: "t1", userIds: ["u1", "u2", "u3"], actorId: "u1" });
    // Assignees were added, so notify() wrote rows and returned their ids.
    // This test is about the assignee diff; the ids themselves belong to
    // tests/notifications.test.ts.
    expect(result.ok).toBe(true);
    expect(txW.assigneesDeleted).toHaveLength(0);
    expect(txW.assigneesCreated[0].data).toEqual([{ taskId: "t1", userId: "u3" }]);
    expect(txW.activity).toHaveLength(1);
    expect(txW.activity[0]).toMatchObject({ action: "task.assigned" });
    expect(args.userFindManyWhere).toEqual({ id: { in: ["u3"] }, active: true });
  });

  it("rejects an unknown or deactivated NEW id", async () => {
    const { db, txW, dbW } = fakeDb({
      task: taskForAssign,
      currentAssignees: [{ userId: "u2", user: { name: "Jordan Lee" } }],
      activeUsers: [],
    });
    const result = await setTaskAssignees(db, { taskId: "t1", userIds: ["ghost"], actorId: "u1" });
    expect(result).toEqual({ ok: false, error: "Invalid input" });
    expect(txW.assigneesDeleted).toHaveLength(0);
    expect(txW.assigneesCreated).toHaveLength(0);
    expect(dbW.assigneesDeleted).toHaveLength(0);
    expect(dbW.assigneesCreated).toHaveLength(0);
    expect(txW.activity).toHaveLength(0);
    expect(dbW.activity).toHaveLength(0);
  });

  it("asks only for active users when resolving additions", async () => {
    const { db, args } = fakeDb({
      task: taskForAssign,
      currentAssignees: [],
      activeUsers: [{ id: "u2", name: "Jordan Lee" }],
    });
    await setTaskAssignees(db, { taskId: "t1", userIds: ["u2"], actorId: "u1" });
    expect(args.userFindManyWhere).toEqual({ id: { in: ["u2"] }, active: true });
  });

  it("assigning everybody to an unassigned task creates every join row and logs one task.assigned", async () => {
    const { db, txW } = fakeDb({
      task: taskForAssign,
      currentAssignees: [],
      activeUsers: [
        { id: "u2", name: "Jordan Lee" },
        { id: "u3", name: "Sam Ortiz" },
      ],
    });
    const result = await setTaskAssignees(db, { taskId: "t1", userIds: ["u2", "u3"], actorId: "u1" });
    // Assignees were added, so notify() wrote rows and returned their ids.
    // This test is about the assignee diff; the ids themselves belong to
    // tests/notifications.test.ts.
    expect(result.ok).toBe(true);
    expect(txW.assigneesCreated[0].data).toEqual([
      { taskId: "t1", userId: "u2" },
      { taskId: "t1", userId: "u3" },
    ]);
    expect(txW.activity).toHaveLength(1);
    expect(txW.activity[0]).toMatchObject({ action: "task.assigned" });
  });

  it("clearing every assignee is legitimate", async () => {
    const { db, txW } = fakeDb({
      task: taskForAssign,
      currentAssignees: [
        { userId: "u1", user: { name: "Alex Kim" } },
        { userId: "u2", user: { name: "Jordan Lee" } },
      ],
    });
    const result = await setTaskAssignees(db, { taskId: "t1", userIds: [], actorId: "u1" });
    expect(result).toEqual({ ok: true, data: { notificationIds: [] } });
    expect(txW.assigneesDeleted[0].where).toEqual({ taskId: "t1", userId: { in: ["u1", "u2"] } });
    expect(txW.activity).toHaveLength(1);
    expect(txW.activity[0]).toMatchObject({ action: "task.unassigned" });
    expect(txW.activity[0].meta).toEqual({ name: "Ship the deck", people: ["Alex Kim", "Jordan Lee"] });
  });

  it("logs the grandparent clientId for a project task", async () => {
    const { db, txW } = fakeDb({
      task: taskForAssign,
      currentAssignees: [],
      activeUsers: [{ id: "u2", name: "Jordan Lee" }],
    });
    await setTaskAssignees(db, { taskId: "t1", userIds: ["u2"], actorId: "u1" });
    expect(txW.activity[0].clientId).toBe("c1");
  });

  it("logs a null client scope for a personal task", async () => {
    const { db, txW } = fakeDb({
      task: personalTask,
      currentAssignees: [],
      activeUsers: [{ id: "u2", name: "Jordan Lee" }],
    });
    await setTaskAssignees(db, { taskId: "t2", userIds: ["u2"], actorId: "u1" });
    expect(txW.activity[0].clientId).toBeNull();
  });

  it("passes skipDuplicates on the insert", async () => {
    const { db, txW } = fakeDb({
      task: taskForAssign,
      currentAssignees: [],
      activeUsers: [{ id: "u2", name: "Jordan Lee" }],
    });
    await setTaskAssignees(db, { taskId: "t1", userIds: ["u2"], actorId: "u1" });
    expect(txW.assigneesCreated[0].skipDuplicates).toBe(true);
  });

  // These two replace a pair that asserted a P2002 retry. That retry was
  // removed: `skipDuplicates: true` compiles to INSERT Ã¢â‚¬Â¦ ON CONFLICT DO
  // NOTHING, so Postgres absorbs a concurrent duplicate rather than raising
  // P2002 Ã¢â‚¬â€ verified against the real database, where the duplicate insert
  // returned { count: 0 } and only the same insert WITHOUT skipDuplicates
  // threw. The old tests could only ever witness the fake throwing what the
  // fixture told it to.
  it("relies on skipDuplicates rather than a retry Ã¢â‚¬â€ one insert attempt, ever", async () => {
    const { db, txW } = fakeDb({
      task: taskForAssign,
      currentAssignees: [],
      activeUsers: [{ id: "u2", name: "Jordan Lee" }],
    });
    const result = await setTaskAssignees(db, { taskId: "t1", userIds: ["u2"], actorId: "u1" });
    // Assignees were added, so notify() wrote rows and returned their ids.
    // This test is about the assignee diff; the ids themselves belong to
    // tests/notifications.test.ts.
    expect(result.ok).toBe(true);
    expect(txW.assigneesCreated).toHaveLength(1);
    expect(txW.assigneesCreated[0].skipDuplicates).toBe(true);
  });

  // The race that is actually reachable, and the one the retry never
  // addressed. Two overlapping saves each diff against their own snapshot of
  // `current`; the later one computes `removedIds` from stale data and
  // deletes a row the earlier save just created. Last writer wins Ã¢â‚¬â€ the
  // intended semantics of a set replacement, but it must be deliberate
  // rather than accidental, so it is pinned here.
  it("a save diffing against a stale snapshot removes what a concurrent save just added", async () => {
    // This snapshot predates a concurrent save that added u3. u3 is therefore
    // absent from `current`, absent from the submitted set, and so lands in
    // neither list Ã¢â‚¬â€ the concurrent addition simply survives untouched.
    const stale = fakeDb({
      task: taskForAssign,
      currentAssignees: [{ userId: "u1", user: { name: "Alex Kim" } }],
      activeUsers: [{ id: "u2", name: "Jordan Lee" }],
    });
    await setTaskAssignees(stale.db, { taskId: "t1", userIds: ["u2"], actorId: "u1" });
    expect(stale.txW.assigneesDeleted[0].where).toEqual({ taskId: "t1", userId: { in: ["u1"] } });

    // But when the stale snapshot DOES contain the row a concurrent save
    // meant to keep, the later save deletes it and still reports ok. No
    // retry can detect this: nothing errors.
    const clobber = fakeDb({
      task: taskForAssign,
      currentAssignees: [
        { userId: "u1", user: { name: "Alex Kim" } },
        { userId: "u3", user: { name: "Sam Ruiz" } },
      ],
      activeUsers: [{ id: "u2", name: "Jordan Lee" }],
    });
    const result = await setTaskAssignees(clobber.db, {
      taskId: "t1",
      userIds: ["u2"],
      actorId: "u1",
    });
    // Assignees were added, so notify() wrote rows and returned their ids.
    // This test is about the assignee diff; the ids themselves belong to
    // tests/notifications.test.ts.
    expect(result.ok).toBe(true);
    expect(clobber.txW.assigneesDeleted[0].where).toEqual({
      taskId: "t1",
      userId: { in: ["u1", "u3"] },
    });
  });

  it("writes both assignee changes and both activity rows inside the transaction", async () => {
    const { db, txW, dbW } = fakeDb({
      task: taskForAssign,
      currentAssignees: [{ userId: "u1", user: { name: "Alex Kim" } }],
      activeUsers: [{ id: "u2", name: "Jordan Lee" }],
    });
    await setTaskAssignees(db, { taskId: "t1", userIds: ["u2"], actorId: "u1" });
    expect(txW.assigneesDeleted).toHaveLength(1);
    expect(txW.assigneesCreated).toHaveLength(1);
    expect(txW.activity).toHaveLength(2);
    expect(dbW.assigneesDeleted).toHaveLength(0);
    expect(dbW.assigneesCreated).toHaveLength(0);
    expect(dbW.activity).toHaveLength(0);
  });
});

describe("notifications (Phase 4)", () => {
  it("notifies only the newly assigned, and inside the transaction", async () => {
    const { db, dbW, txW } = fakeDb({
      task: taskWithProject,
      currentAssignees: [{ userId: "u1", user: { name: "Dana Reeve" } }],
      activeUsers: [{ id: "u2", name: "Tom Iversen" }],
    });
    await setTaskAssignees(db, { taskId: "t1", userIds: ["u1", "u2"], actorId: "actor" });

    expect(txW.notifications.map((n) => n.recipientId)).toEqual(["u2"]);
    expect(txW.notifications[0]).toMatchObject({ type: "TASK_ASSIGNED", entityId: "t1" });
    // A write on the outer client would mean a rolled-back assignment could
    // still leave someone told they were assigned.
    expect(dbW.notifications).toEqual([]);
  });

  it("does not notify someone who was only removed", async () => {
    const { db, txW } = fakeDb({
      task: taskWithProject,
      currentAssignees: [{ userId: "u1", user: { name: "Dana Reeve" } }],
      activeUsers: [],
    });
    await setTaskAssignees(db, { taskId: "t1", userIds: [], actorId: "actor" });
    expect(txW.notifications).toEqual([]);
  });

  it("tells the creator and the assignees about a status change, never the actor", async () => {
    const { db, txW, dbW } = fakeDb({ task: taskWithProject });
    await setTaskStatus(db, { taskId: "t1", status: "IN_PROGRESS", actorId: "u-assignee" });

    // creatorId u-creator and assignee u-assignee are both interested; the
    // actor is the assignee, so only the creator is told.
    expect(txW.notifications.map((n) => n.recipientId)).toEqual(["u-creator"]);
    expect(txW.notifications[0]).toMatchObject({
      type: "TASK_STATUS_CHANGED",
      meta: { name: "Draft brand brief", to: "IN_PROGRESS" },
    });
    expect(dbW.notifications).toEqual([]);
  });

  it("writes no notification when the status did not actually change", async () => {
    const { db, txW } = fakeDb({ task: taskWithProject });
    await setTaskStatus(db, { taskId: "t1", status: "TO_DO", actorId: "someone" });
    expect(txW.notifications).toEqual([]);
  });

  // entityId carries no foreign key, so nothing cascades Ã¢â‚¬â€ a notification
  // about a deleted task would be a link to a 404.
  it("clears a removed task's notifications inside the transaction", async () => {
    const { db, txW } = fakeDb({ task: taskWithProject });
    await removeTask(db, { taskId: "t1", actorId: "actor" });
    expect(txW.notificationsCleared).toEqual([
      { where: { entityType: "TASK", entityId: "t1" } },
    ]);
  });

  it("rolls the notification back with the rest of a failed transaction", async () => {
    const { db, txW } = fakeDb({
      task: taskWithProject,
      taskDeleteError: new Prisma.PrismaClientKnownRequestError("gone", {
        code: "P2025",
        clientVersion: "test",
      }),
    });
    const result = await removeTask(db, { taskId: "t1", actorId: "actor" });
    expect(result.ok).toBe(false);
    expect(txW.notificationsCleared).toEqual([]);
  });
});

describe("notifications on task creation", () => {
  // The audit that found this gap put it best: the activity log folds initial
  // assignees into task.created, but a notification cannot. Quick add is the
  // app's fastest way to hand someone work, and it goes through createTask.
  it("notifies the initial assignees, inside the transaction", async () => {
    const { db, txW, dbW } = fakeDb({
      project: project1,
      activeUsers: [
        { id: "u1", name: "Dana Reeve" },
        { id: "u2", name: "Tom Iversen" },
      ],
    });
    // A distinct actor: baseCreateInput.actorId is "u1", who is also being
    // assigned here, and notify() would correctly filter them out.
    await createTask(db, {
      ...baseCreateInput,
      actorId: "actor1",
      projectId: "p1",
      assigneeIds: ["u1", "u2"],
    });

    expect(txW.notifications.map((n) => n.recipientId)).toEqual(["u1", "u2"]);
    expect(txW.notifications[0]).toMatchObject({ type: "TASK_ASSIGNED" });
    expect(dbW.notifications).toEqual([]);
  });

  it("writes no notification when a task is created with nobody on it", async () => {
    const { db, txW } = fakeDb({ project: project1 });
    await createTask(db, { ...baseCreateInput, projectId: "p1", assigneeIds: [] });
    expect(txW.notifications).toEqual([]);
  });

  // Assigning yourself in quick-add is the common case, and it must be silent.
  it("does not notify someone who assigned the task to themselves", async () => {
    const { db, txW } = fakeDb({
      project: project1,
      activeUsers: [{ id: "actor1", name: "Akshat Singh" }],
    });
    await createTask(db, {
      ...baseCreateInput,
      actorId: "actor1",
      projectId: "p1",
      assigneeIds: ["actor1"],
    });
    expect(txW.notifications).toEqual([]);
  });
});
