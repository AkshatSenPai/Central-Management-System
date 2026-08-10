import { describe, it, expect, vi } from "vitest";

// task-service.ts reaches r2.ts through attachment-service.ts, and r2.ts
// builds its S3Client at module scope from four env vars that do not exist in
// a test run. Without this mock the module graph throws on import and this
// whole file fails to load before a single test runs. The same mock, for the
// same reason, as tests/task-service.test.ts.
vi.mock("@/lib/r2", () => ({
  deleteObjects: vi.fn(async () => undefined),
  R2DeleteObjectsError: class extends Error {},
}));

import { wouldCloseCycle, addTaskDependency, removeTaskDependency } from "@/lib/task-service";

/** An in-memory edge list. `edges` are [blockedTaskId, blockerTaskId] pairs,
 * read exactly as wouldCloseCycle reads them: "the first waits on the
 * second". */
function fakeDeps(edges: [string, string][]) {
  return {
    taskDependency: {
      findMany: async (a: { where: { blockedTaskId: { in: string[] } } }) => {
        const frontier = new Set(a.where.blockedTaskId.in);
        return edges
          .filter(([blocked]) => frontier.has(blocked))
          .map(([blockedTaskId, blockerTaskId]) => ({ blockedTaskId, blockerTaskId }));
      },
    },
  } as never;
}

describe("wouldCloseCycle", () => {
  it("refuses a task blocking itself", async () => {
    const db = fakeDeps([]);
    expect(await wouldCloseCycle(db, { blockedTaskId: "a", blockerTaskId: "a" })).toBe(true);
  });

  it("allows an unrelated pair", async () => {
    const db = fakeDeps([]);
    expect(await wouldCloseCycle(db, { blockedTaskId: "a", blockerTaskId: "b" })).toBe(false);
  });

  // B already waits on A, so making A wait on B closes the loop.
  it("refuses a direct two-task cycle", async () => {
    const db = fakeDeps([["b", "a"]]);
    expect(await wouldCloseCycle(db, { blockedTaskId: "a", blockerTaskId: "b" })).toBe(true);
  });

  // C waits on B waits on A. Making A wait on C closes it.
  it("refuses a transitive cycle", async () => {
    const db = fakeDeps([
      ["c", "b"],
      ["b", "a"],
    ]);
    expect(await wouldCloseCycle(db, { blockedTaskId: "a", blockerTaskId: "c" })).toBe(true);
  });

  // A blocked by both B and C, both blocked by D. A DAG, and a perfectly
  // ordinary plan — "launch needs six things". `seen` is what stops the walk
  // revisiting D, and is why this passes rather than falsely refusing.
  it("allows a diamond", async () => {
    const db = fakeDeps([
      ["a", "b"],
      ["b", "d"],
      ["c", "d"],
    ]);
    expect(await wouldCloseCycle(db, { blockedTaskId: "a", blockerTaskId: "c" })).toBe(false);
  });

  // Should be impossible to create, but the walk must terminate if it ever
  // is — a page that hangs is worse than a wrong answer.
  it("terminates on a pre-existing cycle in the data", async () => {
    const db = fakeDeps([
      ["x", "y"],
      ["y", "x"],
    ]);
    expect(await wouldCloseCycle(db, { blockedTaskId: "a", blockerTaskId: "x" })).toBe(false);
  });

  // One query per LEVEL, not per node. At six people a chain is single
  // digits, but the shape is what keeps it that way.
  it("walks a long chain in one query per level", async () => {
    let queries = 0;
    const edges: [string, string][] = [
      ["t1", "t2"],
      ["t2", "t3"],
      ["t3", "t4"],
    ];
    const db = {
      taskDependency: {
        findMany: async (a: { where: { blockedTaskId: { in: string[] } } }) => {
          queries++;
          const frontier = new Set(a.where.blockedTaskId.in);
          return edges
            .filter(([blocked]) => frontier.has(blocked))
            .map(([blockedTaskId, blockerTaskId]) => ({ blockedTaskId, blockerTaskId }));
        },
      },
    } as never;

    expect(await wouldCloseCycle(db, { blockedTaskId: "a", blockerTaskId: "t1" })).toBe(false);
    // t1 -> t2 -> t3 -> t4 -> (empty). Four levels walked, not four per node.
    expect(queries).toBe(4);
  });
});

/** Reads for the two task lookups and the cycle walk, plus a capture sink per
 * client. Writes go to the sink they were called on, so a write issued on the
 * outer `db` — including recordActivity(db, ...) instead of
 * recordActivity(tx, ...) — lands in dbW and fails any test asserting it
 * empty, instead of silently passing. The same trick tests/task-service.test.ts
 * uses, for the same reason. */
function fakeDepDb(parts: {
  edges?: [string, string][];
  tasks?: Record<string, { id: string; title: string; reference: number }>;
}) {
  const edges = parts.edges ?? [];
  const tasks = parts.tasks ?? {};
  const empty = () => ({ created: [] as unknown[], deleted: [] as unknown[], activity: [] as Record<string, unknown>[] });
  const dbW = empty();
  const txW = empty();

  const reads = {
    taskDependency: {
      findMany: async (a: { where: { blockedTaskId: { in: string[] } } }) => {
        const frontier = new Set(a.where.blockedTaskId.in);
        return edges
          .filter(([blocked]) => frontier.has(blocked))
          .map(([blockedTaskId, blockerTaskId]) => ({ blockedTaskId, blockerTaskId }));
      },
    },
    task: {
      // loadTaskScope's walk-up.
      findUnique: async (a: { where: { id: string } }) => {
        const t = tasks[a.where.id];
        if (!t) return null;
        return {
          id: t.id,
          title: t.title,
          description: null,
          projectId: null,
          milestoneId: null,
          status: "TO_DO",
          priority: "MEDIUM",
          dueDate: null,
          project: null,
        };
      },
      // loadDependencyPair reads both ends in one query.
      findMany: async (a: { where: { id: { in: string[] } } }) =>
        a.where.id.in.map((id) => tasks[id]).filter(Boolean),
    },
  };

  function writes(sink: ReturnType<typeof empty>) {
    return {
      taskDependency: {
        ...reads.taskDependency,
        create: async (a: unknown) => {
          sink.created.push(a);
          return {};
        },
        delete: async (a: unknown) => {
          sink.deleted.push(a);
          return {};
        },
      },
      activityLog: {
        create: async (a: { data: Record<string, unknown> }) => {
          sink.activity.push(a.data);
          return {};
        },
      },
    };
  }

  const db = {
    ...reads,
    ...writes(dbW),
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ ...reads, ...writes(txW) }),
  };

  return { db: db as never, txW, dbW };
}

const TASKS = {
  a: { id: "a", title: "Campaign", reference: 24 },
  b: { id: "b", title: "Payment", reference: 18 },
};

describe("addTaskDependency", () => {
  it("writes the row and logs, both inside the transaction", async () => {
    const { db, txW, dbW } = fakeDepDb({ tasks: TASKS });
    const result = await addTaskDependency(db, { blockedTaskId: "a", blockerTaskId: "b", actorId: "u1" });

    expect(result.ok).toBe(true);
    expect(txW.created).toHaveLength(1);
    expect(txW.activity).toHaveLength(1);
    expect(txW.activity[0].action).toBe("task.dependency_added");
    // Nothing may escape the transaction.
    expect(dbW.created).toHaveLength(0);
    expect(dbW.activity).toHaveLength(0);
  });

  it("names the blocker by reference in the activity meta", async () => {
    const { db, txW } = fakeDepDb({ tasks: TASKS });
    await addTaskDependency(db, { blockedTaskId: "a", blockerTaskId: "b", actorId: "u1" });
    expect(txW.activity[0].meta).toMatchObject({ name: "Campaign", blocker: "MER-018" });
  });

  // The message must name the BLOCKER (b, MER-018) — the option just picked —
  // not the task whose page you are on (a, MER-024). Getting this backwards
  // renders as "MER-024 already depends on this task" while you are looking
  // at MER-024, which reads as a task depending on itself. The original
  // version of this test asserted the wrong end and agreed with the bug;
  // browser QA is what caught it.
  it("refuses a cycle, naming the picked task, and writes nothing", async () => {
    const { db, txW } = fakeDepDb({ tasks: TASKS, edges: [["b", "a"]] });
    const result = await addTaskDependency(db, { blockedTaskId: "a", blockerTaskId: "b", actorId: "u1" });

    expect(result).toEqual({
      ok: false,
      error: "MER-018 already depends on this task, so this would create a loop.",
    });
    expect(txW.created).toHaveLength(0);
    expect(txW.activity).toHaveLength(0);
  });

  it("refuses a task blocking itself", async () => {
    const { db, txW } = fakeDepDb({ tasks: TASKS });
    const result = await addTaskDependency(db, { blockedTaskId: "a", blockerTaskId: "a", actorId: "u1" });
    expect(result.ok).toBe(false);
    expect(txW.created).toHaveLength(0);
  });

  it("refuses an unknown task", async () => {
    const { db } = fakeDepDb({ tasks: { a: TASKS.a } });
    const result = await addTaskDependency(db, { blockedTaskId: "a", blockerTaskId: "ghost", actorId: "u1" });
    expect(result).toEqual({ ok: false, error: "Task not found" });
  });
});

describe("removeTaskDependency", () => {
  it("deletes the row and logs inside the transaction", async () => {
    const { db, txW, dbW } = fakeDepDb({ tasks: TASKS, edges: [["a", "b"]] });
    const result = await removeTaskDependency(db, { blockedTaskId: "a", blockerTaskId: "b", actorId: "u1" });

    expect(result.ok).toBe(true);
    expect(txW.deleted).toHaveLength(1);
    expect(txW.activity).toHaveLength(1);
    expect(txW.activity[0].action).toBe("task.dependency_removed");
    expect(dbW.deleted).toHaveLength(0);
  });

  it("refuses an unknown task", async () => {
    const { db } = fakeDepDb({ tasks: { a: TASKS.a } });
    const result = await removeTaskDependency(db, { blockedTaskId: "a", blockerTaskId: "ghost", actorId: "u1" });
    expect(result).toEqual({ ok: false, error: "Task not found" });
  });
});
