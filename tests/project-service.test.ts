import { describe, it, expect } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  createProject,
  updateProject,
  setProjectStatus,
  setProjectHealth,
  setProjectProgress,
} from "@/lib/project-service";

type FakeParts = {
  client?: unknown;
  project?: unknown;
  /** Returned by project.findFirst only when the where clause targets this
   * duplicate's client — so "same name, different client" is a real test. */
  duplicate?: { id: string; clientId: string; name: string };
  transactionError?: unknown;
};

function fakeDb(parts: FakeParts) {
  const created: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  const activity: Record<string, unknown>[] = [];

  const create = async (args: { data: Record<string, unknown> }) => {
    created.push(args.data);
    return { id: "new1", ...args.data };
  };
  const update = async (args: { data: Record<string, unknown> }) => {
    updates.push(args.data);
    return args.data;
  };
  const logCreate = async (args: { data: Record<string, unknown> }) => {
    activity.push(args.data);
    return args.data;
  };

  const projectDelegate = {
    findFirst: async (args: { where: { clientId: string } }) =>
      parts.duplicate && parts.duplicate.clientId === args.where.clientId ? parts.duplicate : null,
    findUnique: async () => parts.project ?? null,
    create,
    update,
  };

  const db = {
    client: { findUnique: async () => parts.client ?? null },
    project: projectDelegate,
    activityLog: { create: logCreate },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      if (parts.transactionError) throw parts.transactionError;
      const tx = { project: projectDelegate, activityLog: { create: logCreate } };
      return fn(tx);
    },
  } as unknown as PrismaClient;

  return { db, created, updates, activity };
}

const client = { id: "c1", name: "Harlow & Fitch" };

const createInput = {
  clientId: "c1",
  name: "Brand Guidelines v3",
  description: "Refresh the identity system.",
  status: "IN_PROGRESS" as const,
  health: "ON_TRACK" as const,
  startDate: new Date("2026-06-01T00:00:00.000Z"),
  dueDate: new Date("2026-08-14T00:00:00.000Z"),
  actorId: "actor1",
};

const existingProject = {
  id: "p1",
  clientId: "c1",
  name: "Brand Guidelines v3",
  description: "Refresh the identity system.",
  status: "IN_PROGRESS",
  health: "ON_TRACK",
  progressMode: "AUTO",
  manualProgress: null,
  startDate: new Date("2026-06-01T00:00:00.000Z"),
  dueDate: new Date("2026-08-14T00:00:00.000Z"),
};

const DUPLICATE = "A project with this name already exists for this client";

describe("createProject", () => {
  it("errors on an unknown client", async () => {
    const { db } = fakeDb({});
    expect(await createProject(db, createInput)).toEqual({ ok: false, error: "Client not found" });
  });

  it("rejects a duplicate project name for the same client", async () => {
    const { db } = fakeDb({
      client,
      duplicate: { id: "p9", clientId: "c1", name: "brand guidelines v3" },
    });
    expect(await createProject(db, createInput)).toEqual({ ok: false, error: DUPLICATE });
  });

  it("allows the same name under a different client", async () => {
    const { db, created } = fakeDb({
      client,
      duplicate: { id: "p9", clientId: "c2", name: "Brand Guidelines v3" },
    });
    const result = await createProject(db, createInput);
    expect(result).toEqual({ ok: true, data: { id: "new1" } });
    expect(created).toHaveLength(1);
  });

  it("maps a P2002 race to the duplicate-name error", async () => {
    const race = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "test",
    });
    const { db } = fakeDb({ client, transactionError: race });
    expect(await createProject(db, createInput)).toEqual({ ok: false, error: DUPLICATE });
  });

  it("rethrows an unrecognised database error", async () => {
    const other = new Prisma.PrismaClientKnownRequestError("Some other DB error", {
      code: "P2025",
      clientVersion: "test",
    });
    const { db } = fakeDb({ client, transactionError: other });
    await expect(createProject(db, createInput)).rejects.toBe(other);
  });

  it("creates in AUTO mode with a null manualProgress and logs project.created scoped to the client", async () => {
    const { db, created, activity } = fakeDb({ client });
    await createProject(db, createInput);
    expect(created[0]).toMatchObject({
      clientId: "c1",
      name: "Brand Guidelines v3",
      status: "IN_PROGRESS",
      health: "ON_TRACK",
      progressMode: "AUTO",
      manualProgress: null,
    });
    expect(activity[0]).toMatchObject({
      entityType: "PROJECT",
      entityId: "new1",
      action: "project.created",
      clientId: "c1",
    });
  });
});

describe("updateProject", () => {
  it("errors on an unknown project", async () => {
    const { db } = fakeDb({});
    expect(await updateProject(db, { ...createInput, projectId: "ghost" })).toEqual({
      ok: false,
      error: "Project not found",
    });
  });

  it("writes no activity when nothing changed", async () => {
    const { db, updates, activity } = fakeDb({ project: existingProject });
    const result = await updateProject(db, { ...createInput, projectId: "p1" });
    expect(result).toEqual({ ok: true, data: undefined });
    expect(updates).toHaveLength(0);
    expect(activity).toHaveLength(0);
  });

  it("logs project.updated with the changed fields in meta", async () => {
    const { db, activity } = fakeDb({ project: existingProject });
    await updateProject(db, { ...createInput, projectId: "p1", description: "New scope." });
    expect(activity).toHaveLength(1);
    expect(activity[0]).toMatchObject({ action: "project.updated", clientId: "c1" });
    expect(activity[0].meta).toMatchObject({
      name: "Brand Guidelines v3",
      changes: { description: { from: "Refresh the identity system.", to: "New scope." } },
    });
  });

  it("logs project.health_changed when the edit changes health", async () => {
    const { db, activity } = fakeDb({ project: existingProject });
    await updateProject(db, { ...createInput, projectId: "p1", health: "AT_RISK" });
    expect(activity).toHaveLength(1);
    expect(activity[0]).toMatchObject({ action: "project.health_changed" });
    expect(activity[0].meta).toMatchObject({ from: "ON_TRACK", to: "AT_RISK" });
  });
});

describe("setProjectHealth", () => {
  it("logs project.health_changed with from and to", async () => {
    const { db, updates, activity } = fakeDb({ project: existingProject });
    const result = await setProjectHealth(db, { projectId: "p1", health: "AT_RISK", actorId: "actor1" });
    expect(result).toEqual({ ok: true, data: undefined });
    expect(updates[0]).toEqual({ health: "AT_RISK" });
    expect(activity[0]).toMatchObject({ action: "project.health_changed", clientId: "c1" });
    expect(activity[0].meta).toMatchObject({ name: "Brand Guidelines v3", from: "ON_TRACK", to: "AT_RISK" });
  });

  it("writes nothing at all when the value is unchanged", async () => {
    const { db, updates, activity } = fakeDb({ project: existingProject });
    const result = await setProjectHealth(db, { projectId: "p1", health: "ON_TRACK", actorId: "actor1" });
    expect(result).toEqual({ ok: true, data: undefined });
    expect(updates).toHaveLength(0);
    expect(activity).toHaveLength(0);
  });
});

describe("setProjectStatus", () => {
  it("logs project.status_changed", async () => {
    const { db, updates, activity } = fakeDb({ project: existingProject });
    await setProjectStatus(db, { projectId: "p1", status: "DONE", actorId: "actor1" });
    expect(updates[0]).toEqual({ status: "DONE" });
    expect(activity[0]).toMatchObject({ action: "project.status_changed", clientId: "c1" });
    expect(activity[0].meta).toMatchObject({ from: "IN_PROGRESS", to: "DONE" });
  });
});

describe("setProjectProgress", () => {
  it("rejects a manual value of 150", async () => {
    const { db, updates } = fakeDb({ project: existingProject });
    expect(
      await setProjectProgress(db, {
        projectId: "p1",
        progressMode: "MANUAL",
        manualProgress: 150,
        actorId: "actor1",
      })
    ).toEqual({ ok: false, error: "Progress must be a whole number between 0 and 100" });
    expect(updates).toHaveLength(0);
  });

  it("stores both progressMode and manualProgress when switching to MANUAL", async () => {
    const { db, updates } = fakeDb({ project: existingProject });
    await setProjectProgress(db, {
      projectId: "p1",
      progressMode: "MANUAL",
      manualProgress: 90,
      actorId: "actor1",
    });
    expect(updates[0]).toEqual({ progressMode: "MANUAL", manualProgress: 90 });
  });

  it("switching back to AUTO changes only progressMode and preserves the stored manualProgress", async () => {
    const { db, updates } = fakeDb({
      project: { ...existingProject, progressMode: "MANUAL", manualProgress: 90 },
    });
    await setProjectProgress(db, {
      projectId: "p1",
      progressMode: "AUTO",
      manualProgress: null,
      actorId: "actor1",
    });
    expect(updates).toHaveLength(1);
    expect(Object.keys(updates[0])).not.toContain("manualProgress");
    expect(updates[0]).toEqual({ progressMode: "AUTO" });
  });
});
