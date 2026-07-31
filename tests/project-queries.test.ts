import { describe, it, expect } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  getProjectProgressCounts,
  listProjects,
  getProjectDetail,
} from "@/lib/project-queries";

type MilestoneRow = { projectId: string; completedAt: Date | null };

type ProjectRow = {
  id: string;
  name: string;
  clientId: string;
  status: string;
  health: string;
  dueDate: Date | null;
  progressMode: string;
  manualProgress: number | null;
  client: { name: string };
  _count: { milestones: number };
};

function fakeDb(parts: {
  projects?: ProjectRow[];
  milestones?: MilestoneRow[];
  taskGroups?: { projectId: string | null; status: string; _count: { _all: number } }[];
  detail?: unknown;
}) {
  const byDelegate = { project: 0, task: 0, milestone: 0 };
  const findManyArgs: unknown[] = [];
  const taskGroupByArgs: unknown[] = [];

  const db = {
    project: {
      findMany: async (args: unknown) => {
        byDelegate.project++;
        findManyArgs.push(args);
        return parts.projects ?? [];
      },
      findUnique: async () => {
        byDelegate.project++;
        return parts.detail ?? null;
      },
    },
    task: {
      groupBy: async (args: unknown) => {
        byDelegate.task++;
        taskGroupByArgs.push(args);
        return parts.taskGroups ?? [];
      },
    },
    milestone: {
      findMany: async () => {
        byDelegate.milestone++;
        return parts.milestones ?? [];
      },
    },
  } as unknown as PrismaClient;

  const calls = () => byDelegate.project + byDelegate.task + byDelegate.milestone;
  return { db, calls, callsByDelegate: () => ({ ...byDelegate }), findManyArgs, taskGroupByArgs };
}

const DONE = new Date("2026-06-12T00:00:00.000Z");

function projectRow(overrides: Partial<ProjectRow> = {}): ProjectRow {
  return {
    id: "p1",
    name: "Brand Guidelines v3",
    clientId: "c1",
    status: "IN_PROGRESS",
    health: "ON_TRACK",
    dueDate: new Date("2026-08-14T00:00:00.000Z"),
    progressMode: "AUTO",
    manualProgress: null,
    client: { name: "Harlow & Fitch" },
    _count: { milestones: 2 },
    ...overrides,
  };
}

describe("getProjectProgressCounts", () => {
  it("returns an empty Map and issues no db calls for an empty id list", async () => {
    const { db, calls } = fakeDb({});
    const counts = await getProjectProgressCounts(db, []);
    expect(counts.size).toBe(0);
    expect(calls()).toBe(0);
  });

  it("groups three milestones across two projects into per-project counts", async () => {
    const { db } = fakeDb({
      milestones: [
        { projectId: "p1", completedAt: DONE },
        { projectId: "p1", completedAt: null },
        { projectId: "p2", completedAt: DONE },
      ],
    });
    const counts = await getProjectProgressCounts(db, ["p1", "p2"]);
    expect(counts.get("p1")).toEqual({ completed: 1, total: 2 });
    expect(counts.get("p2")).toEqual({ completed: 1, total: 1 });
  });

  it("includes a project with no milestones in the Map as zero of zero", async () => {
    const { db } = fakeDb({ milestones: [{ projectId: "p1", completedAt: DONE }] });
    const counts = await getProjectProgressCounts(db, ["p1", "p3"]);
    expect(counts.get("p3")).toEqual({ completed: 0, total: 0 });
  });

  it("asks only for the requested projects", async () => {
    const { db, taskGroupByArgs } = fakeDb({});
    await getProjectProgressCounts(db, ["p1", "p2"]);
    expect(taskGroupByArgs[0]).toEqual({
      by: ["projectId", "status"],
      where: { projectId: { in: ["p1", "p2"] } },
      _count: { _all: true },
    });
  });

  it("uses task counts for a project that has tasks and ignores its milestones", async () => {
    const { db } = fakeDb({
      taskGroups: [
        { projectId: "p1", status: "DONE", _count: { _all: 1 } },
        { projectId: "p1", status: "TO_DO", _count: { _all: 1 } },
        { projectId: "p1", status: "IN_PROGRESS", _count: { _all: 1 } },
        { projectId: "p1", status: "REVIEW", _count: { _all: 1 } },
      ],
      milestones: [
        { projectId: "p1", completedAt: DONE },
        { projectId: "p1", completedAt: DONE },
      ],
    });
    const counts = await getProjectProgressCounts(db, ["p1"]);
    expect(counts.get("p1")).toEqual({ completed: 1, total: 4 });
  });

  it("counts only DONE as complete, never REVIEW", async () => {
    const { db } = fakeDb({
      taskGroups: [{ projectId: "p1", status: "REVIEW", _count: { _all: 2 } }],
    });
    const counts = await getProjectProgressCounts(db, ["p1"]);
    expect(counts.get("p1")).toEqual({ completed: 0, total: 2 });
  });

  it("falls back to milestone counts for a project with no tasks", async () => {
    const { db } = fakeDb({
      milestones: [
        { projectId: "p2", completedAt: DONE },
        { projectId: "p2", completedAt: null },
      ],
    });
    const counts = await getProjectProgressCounts(db, ["p2"]);
    expect(counts.get("p2")).toEqual({ completed: 1, total: 2 });
  });

  it("computes both bases in the same result set", async () => {
    const { db } = fakeDb({
      taskGroups: [
        { projectId: "p1", status: "DONE", _count: { _all: 1 } },
        { projectId: "p1", status: "TO_DO", _count: { _all: 1 } },
      ],
      milestones: [{ projectId: "p2", completedAt: DONE }],
    });
    const counts = await getProjectProgressCounts(db, ["p1", "p2", "p3"]);
    expect(counts.get("p1")).toEqual({ completed: 1, total: 2 });
    expect(counts.get("p2")).toEqual({ completed: 1, total: 1 });
    expect(counts.get("p3")).toEqual({ completed: 0, total: 0 });
  });

  it("still seeds every requested id even when it appears in neither query result", async () => {
    const { db } = fakeDb({
      taskGroups: [{ projectId: "p1", status: "DONE", _count: { _all: 1 } }],
    });
    const counts = await getProjectProgressCounts(db, ["p1", "p9"]);
    expect(counts.get("p9")).toEqual({ completed: 0, total: 0 });
    expect(counts.size).toBe(2);
  });

  it("ignores a grouped row whose projectId is null", async () => {
    const { db } = fakeDb({
      taskGroups: [
        { projectId: "p1", status: "DONE", _count: { _all: 1 } },
        { projectId: null, status: "DONE", _count: { _all: 5 } },
      ],
    });
    const counts = await getProjectProgressCounts(db, ["p1"]);
    expect(counts.get("p1")).toEqual({ completed: 1, total: 1 });
    expect(counts.size).toBe(1);
  });
});

describe("listProjects", () => {
  it("composes each row's progress view from the batched counts", async () => {
    const { db } = fakeDb({
      projects: [
        projectRow({ id: "p1" }),
        projectRow({ id: "p2", name: "Patient Portal UX", progressMode: "MANUAL", manualProgress: 90 }),
      ],
      milestones: [
        { projectId: "p1", completedAt: DONE },
        { projectId: "p1", completedAt: null },
      ],
    });
    const rows = await listProjects(db);
    expect(rows[0].progress).toEqual({ percent: 50, mode: "AUTO", hasUnits: true, label: "50%" });
    expect(rows[1].progress).toEqual({ percent: 90, mode: "MANUAL", hasUnits: true, label: "90%" });
  });

  it("excludes DONE by default", async () => {
    const { db, findManyArgs } = fakeDb({ projects: [projectRow()] });
    await listProjects(db);
    expect((findManyArgs[0] as { where: { status?: unknown } }).where.status).toEqual({ not: "DONE" });
  });

  it("drops the status constraint entirely when asked for ALL", async () => {
    const { db, findManyArgs } = fakeDb({ projects: [projectRow()] });
    await listProjects(db, { status: "ALL" });
    expect((findManyArgs[0] as { where: Record<string, unknown> }).where).not.toHaveProperty("status");
  });

  it("filters to a single status when given one — including DONE", async () => {
    const { db, findManyArgs } = fakeDb({ projects: [projectRow({ status: "DONE" })] });
    await listProjects(db, { status: "DONE" });
    expect((findManyArgs[0] as { where: { status?: unknown } }).where.status).toBe("DONE");
  });

  it("passes a health filter through to the where clause and omits the key when null", async () => {
    const { db, findManyArgs } = fakeDb({ projects: [projectRow()] });
    await listProjects(db, { health: "AT_RISK" });
    expect((findManyArgs[0] as { where: { health?: unknown } }).where.health).toBe("AT_RISK");

    const second = fakeDb({ projects: [projectRow()] });
    await listProjects(second.db, { health: null });
    expect((second.findManyArgs[0] as { where: Record<string, unknown> }).where).not.toHaveProperty("health");
  });

  it("issues exactly three db calls regardless of row count", async () => {
    const many = fakeDb({
      projects: [projectRow({ id: "p1" }), projectRow({ id: "p2" }), projectRow({ id: "p3" }), projectRow({ id: "p4" }), projectRow({ id: "p5" })],
    });
    await listProjects(many.db);
    expect(many.callsByDelegate()).toEqual({ project: 1, task: 1, milestone: 1 });

    const one = fakeDb({ projects: [projectRow({ id: "p1" })] });
    await listProjects(one.db);
    expect(one.callsByDelegate()).toEqual({ project: 1, task: 1, milestone: 1 });
  });

  it("reads the task basis for a project's first row on the list", async () => {
    const { db } = fakeDb({
      projects: [projectRow({ id: "p1" })],
      taskGroups: [
        { projectId: "p1", status: "DONE", _count: { _all: 1 } },
        { projectId: "p1", status: "TO_DO", _count: { _all: 1 } },
      ],
      milestones: [
        { projectId: "p1", completedAt: DONE },
        { projectId: "p1", completedAt: DONE },
      ],
    });
    const rows = await listProjects(db);
    expect(rows[0].progress).toEqual({ percent: 50, mode: "AUTO", hasUnits: true, label: "50%" });
  });

  it("carries a milestoneCount and a subtitle on every row", async () => {
    const { db } = fakeDb({
      projects: [projectRow({ _count: { milestones: 3 } })],
      milestones: [],
    });
    const rows = await listProjects(db);
    expect(rows[0].milestoneCount).toBe(3);
    expect(rows[0].subtitle).toBe("3 milestones · due 14 Aug");
    expect(rows[0].clientName).toBe("Harlow & Fitch");
  });
});

describe("getProjectDetail", () => {
  it("returns null for an unknown id", async () => {
    const { db } = fakeDb({});
    expect(await getProjectDetail(db, "ghost")).toBeNull();
  });
});
