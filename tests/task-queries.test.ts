import { describe, it, expect } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  listAssignedTasks,
  listAllTasks,
  listProjectTasks,
  getTaskDetail,
  listTasksInRange,
  listMySequences,
} from "@/lib/task-queries";

type TaskRow = {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate: Date | null;
  projectId: string | null;
  project: { name: string; clientId: string; client: { name: string } } | null;
  assignees: { user: { id: string; name: string } }[];
  blockedBy: { blocker: { reference: number; status: string } }[];
};

type DetailRow = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  dueDate: Date | null;
  projectId: string | null;
  milestoneId: string | null;
  project: { name: string; clientId: string; client: { name: string } } | null;
  milestone: { title: string } | null;
  creator: { id: string; name: string };
  assignees: { user: { id: string; name: string } }[];
  checklist: { id: string; title: string; done: boolean; order: number }[];
  blockedBy: { blocker: { id: string; reference: number; title: string; status: string } }[];
  blocking: { blockedTask: { id: string; reference: number; title: string; status: string } }[];
};

function fakeDb(parts: { tasks?: TaskRow[]; detail?: unknown }) {
  const byDelegate = { task: 0 };
  const findManyArgs: unknown[] = [];
  const findUniqueArgs: unknown[] = [];

  const db = {
    task: {
      findMany: async (args: unknown) => {
        byDelegate.task++;
        findManyArgs.push(args);
        return parts.tasks ?? [];
      },
      findUnique: async (args: unknown) => {
        byDelegate.task++;
        findUniqueArgs.push(args);
        return parts.detail ?? null;
      },
    },
  } as unknown as PrismaClient;

  return { db, callsByDelegate: () => ({ ...byDelegate }), findManyArgs, findUniqueArgs };
}

const DUE = new Date("2026-08-14T00:00:00.000Z");
const PAST = new Date("2020-01-01T00:00:00.000Z");

function taskRow(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id: "t1",
    title: "Brand Guidelines v3",
    status: "TO_DO",
    priority: "MEDIUM",
    dueDate: DUE,
    projectId: "p1",
    project: { name: "Brand Guidelines v3", clientId: "c1", client: { name: "Harlow & Fitch" } },
    assignees: [],
    // Unblocked by default, so every pre-existing fixture keeps meaning what
    // it meant before sequencing existed.
    blockedBy: [],
    ...overrides,
  };
}

function detailRow(overrides: Partial<DetailRow> = {}): DetailRow {
  return {
    id: "t1",
    title: "Brand Guidelines v3",
    description: "Deliver the v3 palette",
    status: "TO_DO",
    priority: "MEDIUM",
    dueDate: DUE,
    projectId: "p1",
    milestoneId: "m1",
    project: { name: "Brand Guidelines v3", clientId: "c1", client: { name: "Harlow & Fitch" } },
    milestone: { title: "Kickoff" },
    creator: { id: "creator1", name: "Alex Chen" },
    assignees: [],
    checklist: [],
    blockedBy: [],
    blocking: [],
    ...overrides,
  };
}

describe("listAssignedTasks", () => {
  it("returns only tasks assigned to the viewer", async () => {
    const { db, findManyArgs } = fakeDb({ tasks: [taskRow()] });
    await listAssignedTasks(db, { userId: "u1" });
    expect((findManyArgs[0] as { where: { assignees?: unknown } }).where.assignees).toEqual({
      some: { userId: "u1" },
    });
  });

  it("excludes DONE by default", async () => {
    const { db, findManyArgs } = fakeDb({ tasks: [taskRow()] });
    await listAssignedTasks(db, { userId: "u1" });
    expect((findManyArgs[0] as { where: { status?: unknown } }).where.status).toEqual({ not: "DONE" });
  });

  it("drops the status constraint entirely when asked for ALL", async () => {
    const { db, findManyArgs } = fakeDb({ tasks: [taskRow()] });
    await listAssignedTasks(db, { userId: "u1", status: "ALL" });
    expect((findManyArgs[0] as { where: Record<string, unknown> }).where).not.toHaveProperty("status");
  });

  it("filters to a single status when given one, including DONE", async () => {
    const { db, findManyArgs } = fakeDb({ tasks: [taskRow({ status: "DONE" })] });
    await listAssignedTasks(db, { userId: "u1", status: "DONE" });
    expect((findManyArgs[0] as { where: { status?: unknown } }).where.status).toBe("DONE");
  });

  it("orders the query by createdAt ascending so the stable sort has a deterministic input", async () => {
    const { db, findManyArgs } = fakeDb({ tasks: [taskRow()] });
    await listAssignedTasks(db, { userId: "u1" });
    expect((findManyArgs[0] as { orderBy: unknown }).orderBy).toEqual({ createdAt: "asc" });
  });

  it("sorts by due date with undated last, then priority", async () => {
    const a = taskRow({ id: "a", dueDate: null, priority: "LOW" });
    const b = taskRow({ id: "b", dueDate: new Date("2026-08-20T00:00:00.000Z"), priority: "MEDIUM" });
    const c = taskRow({ id: "c", dueDate: new Date("2026-08-10T00:00:00.000Z"), priority: "HIGH" });
    const d = taskRow({ id: "d", dueDate: null, priority: "URGENT" });
    const { db } = fakeDb({ tasks: [a, b, c, d] });
    const rows = await listAssignedTasks(db, { userId: "u1" });
    expect(rows.map((r) => r.id)).toEqual(["c", "b", "d", "a"]);
  });

  it("issues exactly one db call regardless of row count", async () => {
    const three = fakeDb({ tasks: [taskRow({ id: "1" }), taskRow({ id: "2" }), taskRow({ id: "3" })] });
    await listAssignedTasks(three.db, { userId: "u1" });
    expect(three.callsByDelegate()).toEqual({ task: 1 });

    const nine = fakeDb({ tasks: Array.from({ length: 9 }, (_, i) => taskRow({ id: `t${i}` })) });
    await listAssignedTasks(nine.db, { userId: "u1" });
    expect(nine.callsByDelegate()).toEqual({ task: 1 });
  });

  it("carries a subtitle naming the client and project", async () => {
    const { db } = fakeDb({ tasks: [taskRow()] });
    const rows = await listAssignedTasks(db, { userId: "u1" });
    expect(rows[0].subtitle).toBe("Harlow & Fitch · Brand Guidelines v3 · due 14 Aug");
  });

  it('carries "Personal" for a task with no project', async () => {
    const { db } = fakeDb({ tasks: [taskRow({ projectId: null, project: null })] });
    const rows = await listAssignedTasks(db, { userId: "u1" });
    expect(rows[0].subtitle).toBe("Personal · due 14 Aug");
    expect(rows[0].projectId).toBeNull();
    expect(rows[0].projectName).toBeNull();
    expect(rows[0].clientId).toBeNull();
    expect(rows[0].clientName).toBeNull();
  });

  it("carries every assignee with initials", async () => {
    const { db } = fakeDb({
      tasks: [taskRow({ assignees: [{ user: { id: "u1", name: "Dana Reeve" } }] })],
    });
    const rows = await listAssignedTasks(db, { userId: "u1" });
    expect(rows[0].assignees).toEqual([{ id: "u1", name: "Dana Reeve", initials: "DR" }]);
  });

  it("flags an overdue open task and never flags a DONE one", async () => {
    const { db } = fakeDb({
      tasks: [
        taskRow({ id: "open", status: "TO_DO", dueDate: PAST }),
        taskRow({ id: "done", status: "DONE", dueDate: PAST }),
      ],
    });
    const rows = await listAssignedTasks(db, { userId: "u1", status: "ALL" });
    expect(rows.find((r) => r.id === "open")?.overdue).toBe(true);
    expect(rows.find((r) => r.id === "done")?.overdue).toBe(false);
  });
});

describe("listAllTasks", () => {
  // The defining difference from listAssignedTasks, and the reason the admin
  // page's own guard is the only thing standing between a member and every
  // task in the studio. If an assignee constraint ever appears here the page
  // silently narrows; if one ever disappears from listAssignedTasks, /my-tasks
  // silently widens. Asserted on the whole where clause so neither can happen
  // unnoticed.
  it("applies no assignee constraint at all", async () => {
    const { db, findManyArgs } = fakeDb({ tasks: [taskRow()] });
    await listAllTasks(db);
    expect((findManyArgs[0] as { where: Record<string, unknown> }).where).toEqual({
      status: { not: "DONE" },
    });
  });

  it("excludes DONE by default, drops the constraint for ALL, and filters to one status", async () => {
    const base = fakeDb({ tasks: [taskRow()] });
    await listAllTasks(base.db);
    expect((base.findManyArgs[0] as { where: { status?: unknown } }).where.status).toEqual({
      not: "DONE",
    });

    const all = fakeDb({ tasks: [taskRow()] });
    await listAllTasks(all.db, { status: "ALL" });
    expect((all.findManyArgs[0] as { where: Record<string, unknown> }).where).not.toHaveProperty(
      "status"
    );

    const done = fakeDb({ tasks: [taskRow({ status: "DONE" })] });
    await listAllTasks(done.db, { status: "DONE" });
    expect((done.findManyArgs[0] as { where: { status?: unknown } }).where.status).toBe("DONE");
  });

  // Unassigned work is the first thing an admin opens this page to find, so
  // it must survive the query rather than being filtered out with the rest.
  it("returns tasks that have no assignee", async () => {
    const { db } = fakeDb({ tasks: [taskRow({ id: "orphan", assignees: [] })] });
    const rows = await listAllTasks(db);
    expect(rows.map((r) => r.id)).toEqual(["orphan"]);
    expect(rows[0].assignees).toEqual([]);
  });

  it("issues exactly one db call whatever the row count", async () => {
    const many = fakeDb({ tasks: [taskRow({ id: "a" }), taskRow({ id: "b" }), taskRow({ id: "c" })] });
    await listAllTasks(many.db);
    expect(many.callsByDelegate()).toEqual({ task: 1 });
  });

  it("honours the sort argument", async () => {
    const urgentLater = taskRow({
      id: "urgent",
      dueDate: new Date("2026-09-01T00:00:00.000Z"),
      priority: "URGENT",
    });
    const lowSooner = taskRow({
      id: "low",
      dueDate: new Date("2026-08-01T00:00:00.000Z"),
      priority: "LOW",
    });

    const byDue = fakeDb({ tasks: [urgentLater, lowSooner] });
    expect((await listAllTasks(byDue.db)).map((r) => r.id)).toEqual(["low", "urgent"]);

    const byPriority = fakeDb({ tasks: [urgentLater, lowSooner] });
    expect((await listAllTasks(byPriority.db, { sort: "PRIORITY" })).map((r) => r.id)).toEqual([
      "urgent",
      "low",
    ]);
  });
});

describe("listProjectTasks", () => {
  it("orders by status, then order, then createdAt", async () => {
    const { db, findManyArgs } = fakeDb({ tasks: [taskRow()] });
    await listProjectTasks(db, "p1");
    expect((findManyArgs[0] as { orderBy: unknown }).orderBy).toEqual([
      { status: "asc" },
      { order: "asc" },
      { createdAt: "asc" },
    ]);
  });

  it("includes every status so completed work stays visible on the project page", async () => {
    const { db, findManyArgs } = fakeDb({ tasks: [taskRow()] });
    await listProjectTasks(db, "p1");
    expect((findManyArgs[0] as { where: unknown }).where).toEqual({ projectId: "p1" });
  });

  it("builds a subtitle that is the due clause alone", async () => {
    const { db } = fakeDb({ tasks: [taskRow()] });
    const rows = await listProjectTasks(db, "p1");
    expect(rows[0].subtitle).toBe("due 14 Aug");
  });

  it("issues exactly one db call regardless of row count", async () => {
    const three = fakeDb({ tasks: [taskRow({ id: "1" }), taskRow({ id: "2" }), taskRow({ id: "3" })] });
    await listProjectTasks(three.db, "p1");
    expect(three.callsByDelegate()).toEqual({ task: 1 });

    const nine = fakeDb({ tasks: Array.from({ length: 9 }, (_, i) => taskRow({ id: `t${i}` })) });
    await listProjectTasks(nine.db, "p1");
    expect(nine.callsByDelegate()).toEqual({ task: 1 });
  });
});

describe("getTaskDetail", () => {
  it("returns null for an unknown id", async () => {
    const { db } = fakeDb({});
    expect(await getTaskDetail(db, "ghost")).toBeNull();
  });

  it("issues exactly one db call", async () => {
    const { db, callsByDelegate } = fakeDb({ detail: detailRow() });
    await getTaskDetail(db, "t1");
    expect(callsByDelegate()).toEqual({ task: 1 });
  });

  it("carries the project, client and milestone names for a project task", async () => {
    const { db } = fakeDb({ detail: detailRow() });
    const detail = await getTaskDetail(db, "t1");
    expect(detail?.projectId).toBe("p1");
    expect(detail?.projectName).toBe("Brand Guidelines v3");
    expect(detail?.clientId).toBe("c1");
    expect(detail?.clientName).toBe("Harlow & Fitch");
    expect(detail?.milestoneId).toBe("m1");
    expect(detail?.milestoneTitle).toBe("Kickoff");
  });

  it("carries nulls for project, client and milestone on a personal task", async () => {
    const { db } = fakeDb({
      detail: detailRow({ projectId: null, project: null, milestoneId: null, milestone: null }),
    });
    const detail = await getTaskDetail(db, "t1");
    expect(detail?.projectId).toBeNull();
    expect(detail?.projectName).toBeNull();
    expect(detail?.clientId).toBeNull();
    expect(detail?.clientName).toBeNull();
    expect(detail?.milestoneId).toBeNull();
    expect(detail?.milestoneTitle).toBeNull();
  });

  it("orders checklist items by order then createdAt", async () => {
    const { db, findUniqueArgs } = fakeDb({ detail: detailRow() });
    await getTaskDetail(db, "t1");
    const select = (findUniqueArgs[0] as { select: { checklist: { orderBy: unknown } } }).select;
    expect(select.checklist.orderBy).toEqual([{ order: "asc" }, { createdAt: "asc" }]);
  });

  it("reports checklist done and total counts", async () => {
    const { db } = fakeDb({
      detail: detailRow({
        checklist: [
          { id: "c1", title: "Draft palette", done: true, order: 0 },
          { id: "c2", title: "Review with client", done: false, order: 1 },
          { id: "c3", title: "Finalize", done: false, order: 2 },
        ],
      }),
    });
    const detail = await getTaskDetail(db, "t1");
    expect(detail?.checklistDone).toBe(1);
    expect(detail?.checklistTotal).toBe(3);
  });

  it("carries assignees with initials", async () => {
    const { db } = fakeDb({
      detail: detailRow({ assignees: [{ user: { id: "u1", name: "Dana Reeve" } }] }),
    });
    const detail = await getTaskDetail(db, "t1");
    expect(detail?.assignees).toEqual([{ id: "u1", name: "Dana Reeve", initials: "DR" }]);
  });
});

describe("listTasksInRange", () => {
  const FROM = new Date("2026-07-27T00:00:00.000Z");
  const TO = new Date("2026-09-07T00:00:00.000Z");
  const where = (args: unknown) => (args as { where: Record<string, unknown> }).where;

  it("filters by a half-open due-date window", async () => {
    const { db, findManyArgs } = fakeDb({ tasks: [] });
    await listTasksInRange(db, { from: FROM, to: TO });
    expect(where(findManyArgs[0]).dueDate).toEqual({ gte: FROM, lt: TO });
  });

  it("issues exactly one query", async () => {
    const { db, callsByDelegate } = fakeDb({ tasks: [taskRow()] });
    await listTasksInRange(db, { from: FROM, to: TO });
    expect(callsByDelegate()).toEqual({ task: 1 });
  });

  // Same rule as listProjects and listAssignedTasks.
  it("hides DONE by default", async () => {
    const { db, findManyArgs } = fakeDb({ tasks: [] });
    await listTasksInRange(db, { from: FROM, to: TO });
    expect(where(findManyArgs[0]).status).toEqual({ not: "DONE" });
  });

  it("drops the status constraint for ALL", async () => {
    const { db, findManyArgs } = fakeDb({ tasks: [] });
    await listTasksInRange(db, { from: FROM, to: TO, status: "ALL" });
    expect(where(findManyArgs[0]).status).toBeUndefined();
  });

  it("filters to one status when given one", async () => {
    const { db, findManyArgs } = fakeDb({ tasks: [] });
    await listTasksInRange(db, { from: FROM, to: TO, status: "IN_PROGRESS" });
    expect(where(findManyArgs[0]).status).toBe("IN_PROGRESS");
  });

  it("adds a person filter only when asked", async () => {
    const { db, findManyArgs } = fakeDb({ tasks: [] });
    await listTasksInRange(db, { from: FROM, to: TO });
    expect(where(findManyArgs[0]).assignees).toBeUndefined();

    const second = fakeDb({ tasks: [] });
    await listTasksInRange(second.db, { from: FROM, to: TO, userId: "u1" });
    expect(where(second.findManyArgs[0]).assignees).toEqual({ some: { userId: "u1" } });
  });

  it("adds a project filter only when asked", async () => {
    const { db, findManyArgs } = fakeDb({ tasks: [] });
    await listTasksInRange(db, { from: FROM, to: TO, projectId: "p1" });
    expect(where(findManyArgs[0]).projectId).toBe("p1");
  });

  // An empty string is what an unselected <select> submits; it must not
  // become a filter matching nothing.
  it("ignores empty-string filters", async () => {
    const { db, findManyArgs } = fakeDb({ tasks: [] });
    await listTasksInRange(db, { from: FROM, to: TO, userId: "", projectId: "" });
    expect(where(findManyArgs[0]).assignees).toBeUndefined();
    expect(where(findManyArgs[0]).projectId).toBeUndefined();
  });

  it("maps rows through the shared row shape", async () => {
    const { db } = fakeDb({ tasks: [taskRow({ dueDate: DUE })] });
    const rows = await listTasksInRange(db, { from: FROM, to: TO });
    expect(rows[0]).toMatchObject({ id: "t1", dueDate: DUE });
    expect(rows[0].subtitle).toBeTruthy();
  });
});

describe("blockers on the read models", () => {
  it("carries blockers onto every list row", async () => {
    const { db } = fakeDb({
      tasks: [taskRow({ blockedBy: [{ blocker: { reference: 18, status: "TO_DO" } }] })],
    });

    const rows = await listAssignedTasks(db, { userId: "u1" });
    expect(rows[0].blockers).toEqual([{ reference: 18, status: "TO_DO" }]);
  });

  // Not pre-filtered in the query: a row that arrived with the DONE ones
  // already stripped could not tell "no dependencies" from "all satisfied".
  it("carries satisfied blockers through too, and lets the pure helpers filter", async () => {
    const { db } = fakeDb({
      tasks: [taskRow({ blockedBy: [{ blocker: { reference: 18, status: "DONE" } }] })],
    });

    const rows = await listAssignedTasks(db, { userId: "u1" });
    expect(rows[0].blockers).toEqual([{ reference: 18, status: "DONE" }]);
  });

  it("reports a task with no dependencies as unblocked", async () => {
    const { db } = fakeDb({ tasks: [taskRow()] });
    const rows = await listAssignedTasks(db, { userId: "u1" });
    expect(rows[0].blockers).toEqual([]);
  });

  it("reads both directions on task detail", async () => {
    const { db } = fakeDb({
      detail: detailRow({
        blockedBy: [{ blocker: { id: "b", reference: 18, title: "Payment", status: "TO_DO" } }],
        blocking: [{ blockedTask: { id: "c", reference: 30, title: "Launch", status: "TO_DO" } }],
      }),
    });

    const detail = await getTaskDetail(db, "t1");
    expect(detail?.blockers).toEqual([
      { id: "b", reference: 18, title: "Payment", status: "TO_DO" },
    ]);
    // The reverse direction, read through @@index([blockerTaskId]).
    expect(detail?.blocking[0].reference).toBe(30);
  });

  it("still reads both directions in ONE query", async () => {
    const { db, callsByDelegate } = fakeDb({ detail: detailRow() });
    await getTaskDetail(db, "t1");
    // The whole point of taskDetailSelect: no call per section.
    expect(callsByDelegate().task).toBe(1);
  });
});

describe("listMySequences", () => {
  /** Dispatches on the `where` clause, never on call order. Call order is not
   * stable here: when nothing is linked, listMySequences skips the
   * grouped-tasks query entirely, so the unsequenced read is the second call
   * rather than the third. A fake keyed on a counter passes the linked cases
   * and silently lies about the unlinked one. */
  function fakeSequenceDb(parts: {
    deps?: { blockedTaskId: string; blockerTaskId: string }[];
    myTasks?: { id: string }[];
    tasks?: unknown[];
    unsequenced?: unknown[];
  }) {
    const findManyArgs: Record<string, unknown>[] = [];
    const db = {
      taskDependency: { findMany: async () => parts.deps ?? [] },
      task: {
        findMany: async (args: { where: Record<string, unknown> }) => {
          findManyArgs.push(args);
          const where = args.where ?? {};
          if ("status" in where) return parts.unsequenced ?? [];
          if ("id" in where) return parts.tasks ?? [];
          return parts.myTasks ?? [];
        },
      },
    } as unknown as PrismaClient;

    const unsequencedArgs = () =>
      findManyArgs.find((a) => "status" in ((a.where ?? {}) as Record<string, unknown>));

    return { db, findManyArgs, unsequencedArgs };
  }

  const seqTask = (id: string, reference: number, status = "TO_DO") => ({
    id,
    reference,
    title: `Task ${id}`,
    status,
    assignees: [],
  });

  it("returns an ordered sequence for a linked pair", async () => {
    const { db } = fakeSequenceDb({
      deps: [{ blockedTaskId: "a", blockerTaskId: "b" }],
      myTasks: [{ id: "a" }],
      tasks: [seqTask("a", 24), seqTask("b", 18, "DONE")],
    });

    const { sequences } = await listMySequences(db, { userId: "u1" });
    expect(sequences).toHaveLength(1);
    expect(sequences[0].nodes.map((n) => n.task.reference)).toEqual([18, 24]);
  });

  // Spec §8, first half: a DONE task inside a group is what explains why the
  // next one is ready, so it is always returned regardless of any filter.
  it("keeps a DONE task inside a sequence", async () => {
    const { db } = fakeSequenceDb({
      deps: [{ blockedTaskId: "a", blockerTaskId: "b" }],
      myTasks: [{ id: "a" }],
      tasks: [seqTask("a", 24), seqTask("b", 18, "DONE")],
    });

    const { sequences } = await listMySequences(db, { userId: "u1" });
    expect(sequences[0].nodes.map((n) => n.state)).toEqual(["done", "ready"]);
  });

  // Spec §8, second half, and the asymmetry most likely to be "tidied" into
  // consistency by someone who has not read the reasoning.
  it("excludes DONE from the unsequenced query", async () => {
    const { db, unsequencedArgs } = fakeSequenceDb({ myTasks: [{ id: "a" }] });
    await listMySequences(db, { userId: "u1" });
    const where = (unsequencedArgs() as { where: Record<string, unknown> }).where;
    expect(where.status).toEqual({ not: "DONE" });
  });

  it("returns no sequences and all rows when nothing is linked", async () => {
    const { db } = fakeSequenceDb({
      myTasks: [{ id: "a" }],
      unsequenced: [taskRow({ id: "a" })],
    });

    const { sequences, unsequenced } = await listMySequences(db, { userId: "u1" });
    expect(sequences).toEqual([]);
    expect(unsequenced).toHaveLength(1);
  });

  it("keeps a sequenced task out of the unsequenced list", async () => {
    const { db, unsequencedArgs } = fakeSequenceDb({
      deps: [{ blockedTaskId: "a", blockerTaskId: "b" }],
      myTasks: [{ id: "a" }],
      tasks: [seqTask("a", 24), seqTask("b", 18)],
    });

    await listMySequences(db, { userId: "u1" });
    const where = (unsequencedArgs() as { where: { id: { notIn: string[] } } }).where;
    expect([...where.id.notIn].sort()).toEqual(["a", "b"]);
  });
});
