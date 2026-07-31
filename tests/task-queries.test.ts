import { describe, it, expect } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { listMyTasks, listProjectTasks, getTaskDetail } from "@/lib/task-queries";

type TaskRow = {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate: Date | null;
  projectId: string | null;
  project: { name: string; clientId: string; client: { name: string } } | null;
  assignees: { user: { id: string; name: string } }[];
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
    ...overrides,
  };
}

describe("listMyTasks", () => {
  it("returns only tasks assigned to the viewer", async () => {
    const { db, findManyArgs } = fakeDb({ tasks: [taskRow()] });
    await listMyTasks(db, { userId: "u1" });
    expect((findManyArgs[0] as { where: { assignees?: unknown } }).where.assignees).toEqual({
      some: { userId: "u1" },
    });
  });

  it("excludes DONE by default", async () => {
    const { db, findManyArgs } = fakeDb({ tasks: [taskRow()] });
    await listMyTasks(db, { userId: "u1" });
    expect((findManyArgs[0] as { where: { status?: unknown } }).where.status).toEqual({ not: "DONE" });
  });

  it("drops the status constraint entirely when asked for ALL", async () => {
    const { db, findManyArgs } = fakeDb({ tasks: [taskRow()] });
    await listMyTasks(db, { userId: "u1", status: "ALL" });
    expect((findManyArgs[0] as { where: Record<string, unknown> }).where).not.toHaveProperty("status");
  });

  it("filters to a single status when given one, including DONE", async () => {
    const { db, findManyArgs } = fakeDb({ tasks: [taskRow({ status: "DONE" })] });
    await listMyTasks(db, { userId: "u1", status: "DONE" });
    expect((findManyArgs[0] as { where: { status?: unknown } }).where.status).toBe("DONE");
  });

  it("orders the query by createdAt ascending so the stable sort has a deterministic input", async () => {
    const { db, findManyArgs } = fakeDb({ tasks: [taskRow()] });
    await listMyTasks(db, { userId: "u1" });
    expect((findManyArgs[0] as { orderBy: unknown }).orderBy).toEqual({ createdAt: "asc" });
  });

  it("sorts by due date with undated last, then priority", async () => {
    const a = taskRow({ id: "a", dueDate: null, priority: "LOW" });
    const b = taskRow({ id: "b", dueDate: new Date("2026-08-20T00:00:00.000Z"), priority: "MEDIUM" });
    const c = taskRow({ id: "c", dueDate: new Date("2026-08-10T00:00:00.000Z"), priority: "HIGH" });
    const d = taskRow({ id: "d", dueDate: null, priority: "URGENT" });
    const { db } = fakeDb({ tasks: [a, b, c, d] });
    const rows = await listMyTasks(db, { userId: "u1" });
    expect(rows.map((r) => r.id)).toEqual(["c", "b", "d", "a"]);
  });

  it("issues exactly one db call regardless of row count", async () => {
    const three = fakeDb({ tasks: [taskRow({ id: "1" }), taskRow({ id: "2" }), taskRow({ id: "3" })] });
    await listMyTasks(three.db, { userId: "u1" });
    expect(three.callsByDelegate()).toEqual({ task: 1 });

    const nine = fakeDb({ tasks: Array.from({ length: 9 }, (_, i) => taskRow({ id: `t${i}` })) });
    await listMyTasks(nine.db, { userId: "u1" });
    expect(nine.callsByDelegate()).toEqual({ task: 1 });
  });

  it("carries a subtitle naming the client and project", async () => {
    const { db } = fakeDb({ tasks: [taskRow()] });
    const rows = await listMyTasks(db, { userId: "u1" });
    expect(rows[0].subtitle).toBe("Harlow & Fitch · Brand Guidelines v3 · due 14 Aug");
  });

  it('carries "Personal" for a task with no project', async () => {
    const { db } = fakeDb({ tasks: [taskRow({ projectId: null, project: null })] });
    const rows = await listMyTasks(db, { userId: "u1" });
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
    const rows = await listMyTasks(db, { userId: "u1" });
    expect(rows[0].assignees).toEqual([{ id: "u1", name: "Dana Reeve", initials: "DR" }]);
  });

  it("flags an overdue open task and never flags a DONE one", async () => {
    const { db } = fakeDb({
      tasks: [
        taskRow({ id: "open", status: "TO_DO", dueDate: PAST }),
        taskRow({ id: "done", status: "DONE", dueDate: PAST }),
      ],
    });
    const rows = await listMyTasks(db, { userId: "u1", status: "ALL" });
    expect(rows.find((r) => r.id === "open")?.overdue).toBe(true);
    expect(rows.find((r) => r.id === "done")?.overdue).toBe(false);
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
