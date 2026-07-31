import { describe, it, expect } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { TaskPriority, TaskStatus } from "@/lib/task";
import { createTask, updateTask, setTaskStatus, removeTask, setTaskAssignees } from "@/lib/task-service";

type FakeParts = {
  /** Row returned by task.findUnique — loadTaskScope's walk-up target. */
  task?: unknown;
  /** Rows returned by task.findMany — the sibling order query. */
  siblings?: { order: number }[];
  /** Row returned by project.findUnique — createTask's own parent lookup. */
  project?: unknown;
  /** Row returned by milestone.findUnique — the pair rule. */
  milestone?: unknown;
  /** Rows returned by user.findMany — resolveAssignees. */
  activeUsers?: { id: string; name: string }[];
  /** Rows returned by taskAssignee.findMany — setTaskAssignees' current set,
   * carrying names so the remove side never needs an active-user lookup. */
  currentAssignees?: { userId: string; user: { name: string } }[];
  /** Thrown by taskAssignee.createMany when set — simulates the concurrent
   * P2002 race setTaskAssignees maps to a clean success. */
  assigneeCreateError?: unknown;
  /** Thrown by taskAssignee.createMany on its FIRST invocation only, then
   * succeeds on every call after — simulates a race that clears on retry. */
  assigneeCreateErrorOnce?: unknown;
};

type Sink = {
  created: Record<string, unknown>[];
  updated: Record<string, unknown>[];
  deleted: unknown[];
  activity: Record<string, unknown>[];
  assigneesCreated: Record<string, unknown>[];
  assigneesDeleted: Record<string, unknown>[];
};

function emptySink(): Sink {
  return {
    created: [],
    updated: [],
    deleted: [],
    activity: [],
    assigneesCreated: [],
    assigneesDeleted: [],
  };
}

/** The Phase 2 fake shape, plus a second capture sink for the transaction
 * client. Reads are shared between `db` and `tx`, but writes go to the sink
 * they were called on — so a write issued on the outer `db` (a
 * non-transactional slip, including `recordActivity(db, …)` instead of
 * `recordActivity(tx, …)`) lands in `dbW` and fails any test asserting it
 * empty, instead of silently passing. */
function fakeDb(parts: FakeParts) {
  const dbW = emptySink();
  const txW = emptySink();
  const calls = { projectFindUnique: 0, milestoneFindUnique: 0, taskFindMany: 0, userFindMany: 0 };
  let assigneeCreateCalls = 0;
  const args: {
    taskFindManyWhere?: unknown;
    userFindManyWhere?: unknown;
    taskAssigneeFindManyWhere?: unknown;
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
        sink.deleted.push(a);
        return {};
      },
    },
    taskAssignee: {
      createMany: async (a: Record<string, unknown>) => {
        assigneeCreateCalls++;
        // Simulates a concurrent P2002 raised by the real driver on the
        // insert itself, so setTaskAssignees' catch has something real to
        // narrow on. assigneeCreateErrorOnce only fires the first time this
        // is ever called across the whole test (including a retry's second
        // attempt), so the retry's own insert goes through cleanly.
        if (parts.assigneeCreateErrorOnce && assigneeCreateCalls === 1) {
          throw parts.assigneeCreateErrorOnce;
        }
        if (parts.assigneeCreateError) throw parts.assigneeCreateError;
        sink.assigneesCreated.push(a);
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
  });

  const db = {
    task: { ...reads.task, ...writers(dbW).task },
    project: reads.project,
    milestone: reads.milestone,
    user: reads.user,
    taskAssignee: { ...reads.taskAssignee, ...writers(dbW).taskAssignee },
    activityLog: writers(dbW).activityLog,
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
      };
      try {
        return await fn({
          task: { ...reads.task, ...writers(txW).task },
          project: reads.project,
          milestone: reads.milestone,
          user: reads.user,
          taskAssignee: { ...reads.taskAssignee, ...writers(txW).taskAssignee },
          activityLog: writers(txW).activityLog,
        });
      } catch (e) {
        txW.created.length = before.created;
        txW.updated.length = before.updated;
        txW.deleted.length = before.deleted;
        txW.activity.length = before.activity;
        txW.assigneesCreated.length = before.assigneesCreated;
        txW.assigneesDeleted.length = before.assigneesDeleted;
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
    // client the new project (p2) belongs to is irrelevant — the row must
    // carry the client whose timeline the task is leaving. project2 must
    // exist so the target-project guard lets the move through.
    const { db, txW } = fakeDb({ task: taskWithProject, project: project2 });
    await updateTask(db, { ...baseUpdateInput, projectId: "p2", milestoneId: null });
    expect(txW.activity[0]).toMatchObject({ action: "task.updated", clientId: "c1" });
  });

  it("errors when moved to a project that does not exist", async () => {
    const { db, txW, dbW } = fakeDb({ task: taskWithProject });
    // milestoneId is cleared so the pair rule doesn't intercept this first —
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
    const { db, txW } = fakeDb({
      task: taskForAssign,
      currentAssignees: [
        { userId: "u1", user: { name: "Alex Kim" } },
        { userId: "u2", user: { name: "Jordan Lee" } },
      ],
      activeUsers: [{ id: "u3", name: "Sam Ortiz" }],
    });
    const result = await setTaskAssignees(db, { taskId: "t1", userIds: ["u2", "u3"], actorId: "u1" });
    expect(result).toEqual({ ok: true, data: undefined });
    expect(txW.assigneesDeleted[0].where).toEqual({ taskId: "t1", userId: { in: ["u1"] } });
    expect(txW.assigneesCreated[0].data).toEqual([{ taskId: "t1", userId: "u3" }]);
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
    expect(result).toEqual({ ok: true, data: undefined });
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
    expect(result).toEqual({ ok: true, data: undefined });
    expect(txW.assigneesDeleted).toHaveLength(0);
    expect(txW.assigneesCreated).toHaveLength(0);
    expect(txW.activity).toHaveLength(0);
    expect(dbW.assigneesDeleted).toHaveLength(0);
    expect(dbW.assigneesCreated).toHaveLength(0);
    // No addedIds at all means resolveAssignees (and its user.findMany) is
    // never called — u1 never reaches the active-user check.
    expect(calls.userFindMany).toBe(0);
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
    expect(result).toEqual({ ok: true, data: undefined });
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
    expect(result).toEqual({ ok: true, data: undefined });
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

  it("maps a concurrent P2002 on the insert to a clean success", async () => {
    const race = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "test",
    });
    const { db } = fakeDb({
      task: taskForAssign,
      currentAssignees: [],
      activeUsers: [{ id: "u2", name: "Jordan Lee" }],
      assigneeCreateError: race,
    });
    const result = await setTaskAssignees(db, { taskId: "t1", userIds: ["u2"], actorId: "u1" });
    expect(result).toEqual({ ok: true, data: undefined });
  });

  it("a P2002 on the first attempt retries and still applies the removal", async () => {
    // current [u1], requested [u2]: a mixed add-and-remove, so the first
    // attempt's deleteMany for u1 applies inside the same transaction whose
    // createMany then races into P2002 and rolls the whole thing back — if
    // setTaskAssignees didn't retry, that removal would be silently lost
    // even though the call reports success.
    const race = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "test",
    });
    const { db, txW } = fakeDb({
      task: taskForAssign,
      currentAssignees: [{ userId: "u1", user: { name: "Alex Kim" } }],
      activeUsers: [{ id: "u2", name: "Jordan Lee" }],
      assigneeCreateErrorOnce: race,
    });
    const result = await setTaskAssignees(db, { taskId: "t1", userIds: ["u2"], actorId: "u1" });
    expect(result).toEqual({ ok: true, data: undefined });
    expect(txW.assigneesDeleted[0].where).toEqual({ taskId: "t1", userId: { in: ["u1"] } });
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
