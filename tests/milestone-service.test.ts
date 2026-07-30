import { describe, it, expect } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  addMilestone,
  updateMilestone,
  setMilestoneComplete,
  removeMilestone,
} from "@/lib/milestone-service";

type FakeParts = {
  project?: unknown;
  milestone?: unknown;
  /** Rows returned by milestone.findMany — the order source. */
  siblings?: { order: number }[];
};

function fakeDb(parts: FakeParts) {
  const created: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  const deletes: unknown[] = [];
  const activity: Record<string, unknown>[] = [];

  const milestoneDelegate = {
    findUnique: async () => parts.milestone ?? null,
    findMany: async () => parts.siblings ?? [],
    create: async (args: { data: Record<string, unknown> }) => {
      created.push(args.data);
      return { id: "new1", ...args.data };
    },
    update: async (args: { data: Record<string, unknown> }) => {
      updates.push(args.data);
      return args.data;
    },
    delete: async (args: unknown) => {
      deletes.push(args);
      return {};
    },
  };
  const logCreate = async (args: { data: Record<string, unknown> }) => {
    activity.push(args.data);
    return args.data;
  };

  const db = {
    milestone: milestoneDelegate,
    project: { findUnique: async () => parts.project ?? null },
    activityLog: { create: logCreate },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = { milestone: milestoneDelegate, activityLog: { create: logCreate } };
      return fn(tx);
    },
  } as unknown as PrismaClient;

  return { db, created, updates, deletes, activity };
}

const project = { id: "p1", clientId: "c1", name: "Brand Guidelines v3" };
const milestone = {
  id: "m1",
  projectId: "p1",
  title: "Design system freeze",
  dueDate: new Date("2026-08-14T00:00:00.000Z"),
  completedAt: null,
  order: 1,
};

describe("addMilestone", () => {
  it("errors on an unknown project", async () => {
    const { db } = fakeDb({});
    expect(
      await addMilestone(db, { projectId: "ghost", title: "Kickoff", dueDate: null, actorId: "actor1" })
    ).toEqual({ ok: false, error: "Project not found" });
  });

  it("writes order 0 for a project's first milestone", async () => {
    const { db, created } = fakeDb({ project, siblings: [] });
    await addMilestone(db, { projectId: "p1", title: "Kickoff", dueDate: null, actorId: "actor1" });
    expect(created[0].order).toBe(0);
  });

  it("writes one more than the highest existing order", async () => {
    const { db, created } = fakeDb({ project, siblings: [{ order: 4 }] });
    await addMilestone(db, { projectId: "p1", title: "Kickoff", dueDate: null, actorId: "actor1" });
    expect(created[0].order).toBe(5);
  });

  it("stores a null due date when none is given", async () => {
    const { db, created } = fakeDb({ project, siblings: [] });
    await addMilestone(db, { projectId: "p1", title: "Kickoff", dueDate: null, actorId: "actor1" });
    expect(created[0].dueDate).toBeNull();
  });

  it("logs milestone.added carrying the grandparent clientId", async () => {
    const { db, activity } = fakeDb({ project, siblings: [] });
    await addMilestone(db, { projectId: "p1", title: "Kickoff", dueDate: null, actorId: "actor1" });
    expect(activity[0]).toMatchObject({
      entityType: "MILESTONE",
      entityId: "new1",
      action: "milestone.added",
      clientId: "c1",
    });
    expect(activity[0].meta).toMatchObject({ name: "Kickoff" });
  });
});

describe("updateMilestone", () => {
  it("errors on an unknown milestone", async () => {
    const { db } = fakeDb({ project });
    expect(
      await updateMilestone(db, { milestoneId: "ghost", title: "x", dueDate: null, actorId: "actor1" })
    ).toEqual({ ok: false, error: "Milestone not found" });
  });

  it("updates title and due date without touching order or completedAt", async () => {
    const { db, updates } = fakeDb({ project, milestone });
    await updateMilestone(db, {
      milestoneId: "m1",
      title: "Design system sign-off",
      dueDate: new Date("2026-08-20T00:00:00.000Z"),
      actorId: "actor1",
    });
    expect(Object.keys(updates[0]).sort()).toEqual(["dueDate", "title"]);
  });

  it("writes no activity when nothing changed", async () => {
    const { db, updates, activity } = fakeDb({ project, milestone });
    const result = await updateMilestone(db, {
      milestoneId: "m1",
      title: "Design system freeze",
      dueDate: new Date("2026-08-14T00:00:00.000Z"),
      actorId: "actor1",
    });
    expect(result).toEqual({ ok: true, data: undefined });
    expect(updates).toHaveLength(0);
    expect(activity).toHaveLength(0);
  });
});

describe("setMilestoneComplete", () => {
  const now = new Date("2026-07-30T12:00:00.000Z");

  it("stamps completedAt when completing and logs milestone.completed", async () => {
    const { db, updates, activity } = fakeDb({ project, milestone });
    const result = await setMilestoneComplete(db, {
      milestoneId: "m1",
      complete: true,
      actorId: "actor1",
      now,
    });
    expect(result).toEqual({ ok: true, data: undefined });
    expect(updates[0]).toEqual({ completedAt: now });
    expect(activity[0]).toMatchObject({ action: "milestone.completed", clientId: "c1" });
    expect(activity[0].meta).toMatchObject({ name: "Design system freeze" });
  });

  it("clears completedAt when reopening and logs milestone.reopened", async () => {
    const { db, updates, activity } = fakeDb({
      project,
      milestone: { ...milestone, completedAt: new Date("2026-07-03T00:00:00.000Z") },
    });
    await setMilestoneComplete(db, { milestoneId: "m1", complete: false, actorId: "actor1", now });
    expect(updates[0]).toEqual({ completedAt: null });
    expect(activity[0]).toMatchObject({ action: "milestone.reopened", clientId: "c1" });
  });

  it("completing an already-complete milestone is a no-op that writes no activity", async () => {
    const { db, updates, activity } = fakeDb({
      project,
      milestone: { ...milestone, completedAt: new Date("2026-07-03T00:00:00.000Z") },
    });
    const result = await setMilestoneComplete(db, {
      milestoneId: "m1",
      complete: true,
      actorId: "actor1",
      now,
    });
    expect(result).toEqual({ ok: true, data: undefined });
    expect(updates).toHaveLength(0);
    expect(activity).toHaveLength(0);
  });
});

describe("removeMilestone", () => {
  it("deletes it and logs milestone.removed with the title captured before the delete", async () => {
    const { db, deletes, activity } = fakeDb({ project, milestone });
    const result = await removeMilestone(db, { milestoneId: "m1", actorId: "actor1" });
    expect(result).toEqual({ ok: true, data: undefined });
    expect(deletes).toHaveLength(1);
    expect(activity[0]).toMatchObject({ action: "milestone.removed", clientId: "c1" });
    expect(activity[0].meta).toMatchObject({ name: "Design system freeze" });
  });
});
