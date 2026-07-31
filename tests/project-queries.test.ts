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

function fakeDb(parts: { projects?: ProjectRow[]; milestones?: MilestoneRow[]; detail?: unknown }) {
  /** Shared across every delegate so the anti-N+1 assertion is meaningful. */
  let dbCalls = 0;
  const findManyArgs: unknown[] = [];

  const db = {
    project: {
      findMany: async (args: unknown) => {
        dbCalls++;
        findManyArgs.push(args);
        return parts.projects ?? [];
      },
      findUnique: async () => {
        dbCalls++;
        return parts.detail ?? null;
      },
    },
    milestone: {
      findMany: async () => {
        dbCalls++;
        return parts.milestones ?? [];
      },
    },
  } as unknown as PrismaClient;

  return { db, calls: () => dbCalls, findManyArgs };
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

  it("issues exactly two db calls regardless of row count", async () => {
    const { db, calls } = fakeDb({
      projects: [
        projectRow({ id: "p1" }),
        projectRow({ id: "p2" }),
        projectRow({ id: "p3" }),
        projectRow({ id: "p4" }),
        projectRow({ id: "p5" }),
      ],
      milestones: [{ projectId: "p1", completedAt: DONE }],
    });
    await listProjects(db);
    expect(calls()).toBe(2);
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
