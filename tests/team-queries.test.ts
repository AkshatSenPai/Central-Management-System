import { describe, it, expect } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { listTeamCards } from "@/lib/team-queries";

type UserRow = { id: string; name: string; title: string | null };
type GroupRow = { userId: string; _count: { _all: number } };
type InProgressRow = {
  userId: string;
  task: {
    id: string;
    title: string;
    dueDate: Date | null;
    priority: string;
    project: { id: string; name: string; client: { id: string; name: string } } | null;
  };
};

function fakeDb(parts: { users?: UserRow[]; groups?: GroupRow[]; inProgress?: InProgressRow[] }) {
  const byDelegate = { user: 0, taskAssigneeGroupBy: 0, taskAssigneeFindMany: 0 };
  const userFindManyArgs: unknown[] = [];
  const groupByArgs: unknown[] = [];
  const findManyArgs: unknown[] = [];

  const db = {
    user: {
      findMany: async (args: unknown) => {
        byDelegate.user++;
        userFindManyArgs.push(args);
        return parts.users ?? [];
      },
    },
    taskAssignee: {
      groupBy: async (args: unknown) => {
        byDelegate.taskAssigneeGroupBy++;
        groupByArgs.push(args);
        return parts.groups ?? [];
      },
      findMany: async (args: unknown) => {
        byDelegate.taskAssigneeFindMany++;
        findManyArgs.push(args);
        return parts.inProgress ?? [];
      },
    },
  } as unknown as PrismaClient;

  return {
    db,
    callsByDelegate: () => ({ ...byDelegate }),
    userFindManyArgs,
    groupByArgs,
    findManyArgs,
  };
}

const DUE = new Date("2026-08-14T00:00:00.000Z");

function userRow(overrides: Partial<UserRow> = {}): UserRow {
  return { id: "u1", name: "Dana Reeve", title: "Designer", ...overrides };
}

function groupRow(overrides: Partial<GroupRow> = {}): GroupRow {
  return { userId: "u1", _count: { _all: 3 }, ...overrides };
}

function inProgressRow(overrides: Partial<InProgressRow> = {}): InProgressRow {
  return {
    userId: "u1",
    task: {
      id: "t1",
      title: "Draft the brief",
      dueDate: DUE,
      priority: "HIGH",
      project: { id: "p1", name: "Brand Guidelines v3", client: { id: "c1", name: "Harlow & Fitch" } },
    },
    ...overrides,
  };
}

describe("listTeamCards", () => {
  it("asks only for active members, ordered by name", async () => {
    const { db, userFindManyArgs } = fakeDb({ users: [userRow()] });
    await listTeamCards(db);
    expect((userFindManyArgs[0] as { where: unknown }).where).toEqual({ active: true });
    expect((userFindManyArgs[0] as { orderBy: unknown }).orderBy).toEqual({ name: "asc" });
  });

  it("issues exactly one db call and returns an empty array when no member is active", async () => {
    const { db, callsByDelegate } = fakeDb({ users: [] });
    const cards = await listTeamCards(db);
    expect(cards).toEqual([]);
    expect(callsByDelegate()).toEqual({ user: 1, taskAssigneeGroupBy: 0, taskAssigneeFindMany: 0 });
  });

  it("issues exactly three db calls regardless of team size", async () => {
    const five = fakeDb({
      users: [
        userRow({ id: "u1" }),
        userRow({ id: "u2" }),
        userRow({ id: "u3" }),
        userRow({ id: "u4" }),
        userRow({ id: "u5" }),
      ],
      groups: [groupRow({ userId: "u1", _count: { _all: 2 } })],
      inProgress: [inProgressRow({ userId: "u1" })],
    });
    await listTeamCards(five.db);
    expect(five.callsByDelegate()).toEqual({ user: 1, taskAssigneeGroupBy: 1, taskAssigneeFindMany: 1 });

    const one = fakeDb({ users: [userRow({ id: "u1" })] });
    await listTeamCards(one.db);
    expect(one.callsByDelegate()).toEqual({ user: 1, taskAssigneeGroupBy: 1, taskAssigneeFindMany: 1 });
  });

  it("counts every non-DONE status as open", async () => {
    const { db, groupByArgs } = fakeDb({
      users: [userRow({ id: "u1" }), userRow({ id: "u2" })],
      // Stands in for a REVIEW task the db already counted as open server-side.
      groups: [groupRow({ userId: "u1", _count: { _all: 1 } })],
    });
    const cards = await listTeamCards(db);
    expect(groupByArgs[0]).toEqual({
      by: ["userId"],
      where: { userId: { in: ["u1", "u2"] }, task: { status: { not: "DONE" } } },
      _count: { _all: true },
    });
    expect(cards.find((c) => c.id === "u1")?.openTaskCount).toBe(1);
  });

  it("folds the grouped counts onto the right member and reports zero for a member with none", async () => {
    const { db } = fakeDb({
      users: [userRow({ id: "u1" }), userRow({ id: "u2" })],
      groups: [groupRow({ userId: "u1", _count: { _all: 4 } })],
    });
    const cards = await listTeamCards(db);
    expect(cards.find((c) => c.id === "u1")?.openTaskCount).toBe(4);
    expect(cards.find((c) => c.id === "u2")?.openTaskCount).toBe(0);
  });

  it("renders the open-task count through openTaskSummary", async () => {
    const { db } = fakeDb({
      users: [userRow({ id: "u1" }), userRow({ id: "u2" })],
      groups: [groupRow({ userId: "u1", _count: { _all: 3 } })],
    });
    const cards = await listTeamCards(db);
    expect(cards.find((c) => c.id === "u1")?.openTaskLabel).toBe("3 open tasks");
    expect(cards.find((c) => c.id === "u2")?.openTaskLabel).toBe("No open tasks");
  });

  it("asks only for IN_PROGRESS tasks in the third query", async () => {
    const { db, findManyArgs } = fakeDb({ users: [userRow()] });
    await listTeamCards(db);
    const where = (findManyArgs[0] as { where: { task?: unknown } }).where;
    expect(where.task).toEqual({ status: "IN_PROGRESS" });
  });

  it("names the client and project on each In Progress task", async () => {
    const { db } = fakeDb({
      users: [userRow({ id: "u1" })],
      inProgress: [inProgressRow({ userId: "u1" })],
    });
    const cards = await listTeamCards(db);
    expect(cards[0].inProgress[0]).toEqual({
      id: "t1",
      title: "Draft the brief",
      projectId: "p1",
      projectName: "Brand Guidelines v3",
      clientId: "c1",
      clientName: "Harlow & Fitch",
      dueDate: DUE,
      priority: "HIGH",
    });
  });

  it("carries nulls for a personal In Progress task and still renders the title", async () => {
    const { db } = fakeDb({
      users: [userRow({ id: "u1" })],
      inProgress: [
        inProgressRow({
          userId: "u1",
          task: { id: "t2", title: "Renew passport", dueDate: null, priority: "LOW", project: null },
        }),
      ],
    });
    const cards = await listTeamCards(db);
    expect(cards[0].inProgress[0]).toEqual({
      id: "t2",
      title: "Renew passport",
      projectId: null,
      projectName: null,
      clientId: null,
      clientName: null,
      dueDate: null,
      priority: "LOW",
    });
  });

  it("orders each member's In Progress tasks by due date then priority", async () => {
    const a = inProgressRow({
      userId: "u1",
      task: { id: "a", title: "A", dueDate: null, priority: "LOW", project: null },
    });
    const b = inProgressRow({
      userId: "u1",
      task: { id: "b", title: "B", dueDate: new Date("2026-08-20T00:00:00.000Z"), priority: "MEDIUM", project: null },
    });
    const c = inProgressRow({
      userId: "u1",
      task: { id: "c", title: "C", dueDate: new Date("2026-08-10T00:00:00.000Z"), priority: "HIGH", project: null },
    });
    const d = inProgressRow({
      userId: "u1",
      task: { id: "d", title: "D", dueDate: null, priority: "URGENT", project: null },
    });
    const { db } = fakeDb({ users: [userRow({ id: "u1" })], inProgress: [a, b, c, d] });
    const cards = await listTeamCards(db);
    expect(cards[0].inProgress.map((t) => t.id)).toEqual(["c", "b", "d", "a"]);
  });

  it("reports a member with no tasks as zero open with an empty In Progress list", async () => {
    const { db } = fakeDb({ users: [userRow({ id: "u1" })] });
    const cards = await listTeamCards(db);
    expect(cards[0].openTaskCount).toBe(0);
    expect(cards[0].openTaskLabel).toBe("No open tasks");
    expect(cards[0].inProgress).toEqual([]);
  });

  it("carries the job title and initials for each member", async () => {
    const { db } = fakeDb({ users: [userRow({ id: "u1", name: "Dana Reeve", title: "Senior Designer" })] });
    const cards = await listTeamCards(db);
    expect(cards[0].name).toBe("Dana Reeve");
    expect(cards[0].title).toBe("Senior Designer");
    expect(cards[0].initials).toBe("DR");
  });

  it("never returns a card for a deactivated member even when they still hold open tasks", async () => {
    const { db } = fakeDb({
      users: [userRow({ id: "u1" })],
      groups: [groupRow({ userId: "ghost", _count: { _all: 5 } })],
      inProgress: [inProgressRow({ userId: "ghost" })],
    });
    const cards = await listTeamCards(db);
    expect(cards).toHaveLength(1);
    expect(cards.find((c) => c.id === "ghost")).toBeUndefined();
  });
});
