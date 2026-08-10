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

import { wouldCloseCycle } from "@/lib/task-service";

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
