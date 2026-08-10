import { describe, it, expect } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { getMemberProfile, listTeamCards } from "@/lib/team-queries";

type OpenSessionRow = { startedAt: Date; resolution: string | null };
type UserRow = {
  id: string;
  name: string;
  title: string | null;
  /** At most one row — the partial unique index guarantees it. */
  attendance: OpenSessionRow[];
};
type GroupRow = { userId: string; _count: { _all: number } };
type OpenTaskRow = {
  userId: string;
  task: {
    id: string;
    title: string;
    status: string;
    dueDate: Date | null;
    priority: string;
    project: { id: string; name: string; client: { id: string; name: string } } | null;
  };
};

function fakeDb(parts: { users?: UserRow[]; groups?: GroupRow[]; openTasks?: OpenTaskRow[] }) {
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
        return parts.openTasks ?? [];
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
  return { id: "u1", name: "Dana Reeve", title: "Designer", attendance: [], ...overrides };
}

const NOW = new Date("2026-08-07T09:00:00.000Z");
/** Open, started earlier the same app day. */
const punchedInToday: OpenSessionRow = {
  startedAt: new Date("2026-08-07T04:00:00.000Z"),
  resolution: null,
};
/** Open, but from the previous app day — forgotten, not present. */
const forgottenYesterday: OpenSessionRow = {
  startedAt: new Date("2026-08-05T04:00:00.000Z"),
  resolution: null,
};

function groupRow(overrides: Partial<GroupRow> = {}): GroupRow {
  return { userId: "u1", _count: { _all: 3 }, ...overrides };
}

function openTaskRow(overrides: Partial<OpenTaskRow> = {}): OpenTaskRow {
  return {
    userId: "u1",
    task: {
      id: "t1",
      title: "Draft the brief",
      status: "IN_PROGRESS",
      dueDate: DUE,
      priority: "HIGH",
      project: { id: "p1", name: "Brand Guidelines v3", client: { id: "c1", name: "Harlow & Fitch" } },
    },
    ...overrides,
  };
}

/** A row in some status other than IN_PROGRESS — the case the card used to
 * render as though the member had nothing on. */
function todoRow(id: string, overrides: Partial<OpenTaskRow["task"]> = {}): OpenTaskRow {
  return openTaskRow({
    task: {
      id,
      title: id.toUpperCase(),
      status: "TO_DO",
      dueDate: null,
      priority: "MEDIUM",
      project: null,
      ...overrides,
    },
  });
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
      openTasks: [openTaskRow({ userId: "u1" })],
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

  // The whole where clause, not just its `task` fragment. Asserting the
  // fragment alone would still pass with `userId: { in: ids }` dropped, and
  // that omission has no visible symptom — the in-memory fold discards
  // unknown members anyway, so every card would still render correctly while
  // production hydrated every IN_PROGRESS assignment row in the database on
  // each /team render.
  it("asks only for open tasks belonging to the listed members in the third query", async () => {
    const { db, findManyArgs } = fakeDb({
      users: [userRow({ id: "u1" }), userRow({ id: "u2" })],
    });
    await listTeamCards(db);
    const where = (findManyArgs[0] as { where: unknown }).where;
    expect(where).toEqual({
      userId: { in: ["u1", "u2"] },
      task: { status: { not: "DONE" } },
    });
  });

  // The partition is "IN_PROGRESS versus everything else still open", NOT
  // "IN_PROGRESS versus TO_DO". Written this way so a status added later —
  // the ProjectStatus MAINTENANCE precedent — lands in otherOpen and stays
  // visible, rather than falling through both buckets and silently vanishing
  // from the card while still counting in the badge.
  it("files every non-IN_PROGRESS open status under otherOpen, including REVIEW", async () => {
    const { db } = fakeDb({
      users: [userRow({ id: "u1" })],
      openTasks: [
        openTaskRow({ task: { ...openTaskRow().task, id: "ip", status: "IN_PROGRESS" } }),
        todoRow("td"),
        todoRow("rv", { status: "REVIEW" }),
      ],
    });
    const cards = await listTeamCards(db);
    expect(cards[0].inProgress.map((t) => t.id)).toEqual(["ip"]);
    expect(cards[0].otherOpen.map((t) => t.id).sort()).toEqual(["rv", "td"]);
  });

  it("carries each open task's status so the card can label it", async () => {
    const { db } = fakeDb({
      users: [userRow({ id: "u1" })],
      openTasks: [todoRow("rv", { status: "REVIEW" })],
    });
    const cards = await listTeamCards(db);
    expect(cards[0].otherOpen[0].status).toBe("REVIEW");
  });

  it("orders otherOpen by due date then priority, exactly as inProgress is ordered", async () => {
    const { db } = fakeDb({
      users: [userRow({ id: "u1" })],
      openTasks: [
        todoRow("late", { dueDate: new Date("2026-08-20T00:00:00.000Z") }),
        todoRow("undated", { priority: "URGENT" }),
        todoRow("early", { dueDate: new Date("2026-08-10T00:00:00.000Z") }),
      ],
    });
    const cards = await listTeamCards(db);
    expect(cards[0].otherOpen.map((t) => t.id)).toEqual(["early", "late", "undated"]);
  });

  // The badge already reports the true total, so the list may cap — but it
  // must say so. Silently showing 3 of 9 would understate a member's load on
  // the one page whose entire job is showing load.
  it("caps otherOpen and reports the remainder rather than dropping it", async () => {
    const { db } = fakeDb({
      users: [userRow({ id: "u1" })],
      groups: [groupRow({ userId: "u1", _count: { _all: 5 } })],
      openTasks: [todoRow("a"), todoRow("b"), todoRow("c"), todoRow("d"), todoRow("e")],
    });
    const cards = await listTeamCards(db);
    expect(cards[0].otherOpen).toHaveLength(3);
    expect(cards[0].otherOpenExtra).toBe(2);
  });

  it("reports no remainder when otherOpen fits", async () => {
    const { db } = fakeDb({
      users: [userRow({ id: "u1" })],
      openTasks: [todoRow("a"), todoRow("b")],
    });
    const cards = await listTeamCards(db);
    expect(cards[0].otherOpen).toHaveLength(2);
    expect(cards[0].otherOpenExtra).toBe(0);
  });

  // The reported defect, at the query layer: five TO_DO tasks used to produce
  // an empty card body indistinguishable from a member with nothing assigned.
  it("gives a member whose work is all unstarted a non-empty card body", async () => {
    const { db } = fakeDb({
      users: [userRow({ id: "u1" })],
      groups: [groupRow({ userId: "u1", _count: { _all: 5 } })],
      openTasks: [todoRow("a"), todoRow("b"), todoRow("c"), todoRow("d"), todoRow("e")],
    });
    const cards = await listTeamCards(db);
    expect(cards[0].inProgress).toEqual([]);
    expect(cards[0].otherOpen.length).toBeGreaterThan(0);
    expect(cards[0].openTaskLabel).toBe("5 open tasks");
  });

  it("names the client and project on each In Progress task", async () => {
    const { db } = fakeDb({
      users: [userRow({ id: "u1" })],
      openTasks: [openTaskRow({ userId: "u1" })],
    });
    const cards = await listTeamCards(db);
    expect(cards[0].inProgress[0]).toEqual({
      id: "t1",
      title: "Draft the brief",
      status: "IN_PROGRESS",
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
      openTasks: [
        openTaskRow({
          userId: "u1",
          task: {
            id: "t2",
            title: "Renew passport",
            status: "IN_PROGRESS",
            dueDate: null,
            priority: "LOW",
            project: null,
          },
        }),
      ],
    });
    const cards = await listTeamCards(db);
    expect(cards[0].inProgress[0]).toEqual({
      id: "t2",
      title: "Renew passport",
      status: "IN_PROGRESS",
      projectId: null,
      projectName: null,
      clientId: null,
      clientName: null,
      dueDate: null,
      priority: "LOW",
    });
  });

  it("orders each member's In Progress tasks by due date then priority", async () => {
    const s = "IN_PROGRESS";
    const a = openTaskRow({
      userId: "u1",
      task: { id: "a", title: "A", status: s, dueDate: null, priority: "LOW", project: null },
    });
    const b = openTaskRow({
      userId: "u1",
      task: { id: "b", title: "B", status: s, dueDate: new Date("2026-08-20T00:00:00.000Z"), priority: "MEDIUM", project: null },
    });
    const c = openTaskRow({
      userId: "u1",
      task: { id: "c", title: "C", status: s, dueDate: new Date("2026-08-10T00:00:00.000Z"), priority: "HIGH", project: null },
    });
    const d = openTaskRow({
      userId: "u1",
      task: { id: "d", title: "D", status: s, dueDate: null, priority: "URGENT", project: null },
    });
    const { db } = fakeDb({ users: [userRow({ id: "u1" })], openTasks: [a, b, c, d] });
    const cards = await listTeamCards(db);
    expect(cards[0].inProgress.map((t) => t.id)).toEqual(["c", "b", "d", "a"]);
  });

  it("reports a member with no tasks as zero open with both lists empty", async () => {
    const { db } = fakeDb({ users: [userRow({ id: "u1" })] });
    const cards = await listTeamCards(db);
    expect(cards[0].openTaskCount).toBe(0);
    expect(cards[0].openTaskLabel).toBe("No open tasks");
    expect(cards[0].inProgress).toEqual([]);
    expect(cards[0].otherOpen).toEqual([]);
    expect(cards[0].otherOpenExtra).toBe(0);
  });

  // The presence dot rides along on the member query. These three assertions
  // are the N+1 guard: if presence ever becomes its own call, the delegate
  // counts asserted above change and this suite fails loudly.
  it("reports a member with an open session started today as Active", async () => {
    const { db } = fakeDb({ users: [userRow({ id: "u1", attendance: [punchedInToday] })] });
    const cards = await listTeamCards(db, NOW);
    expect(cards[0].presenceLabel).toBe("Active");
  });

  it("reports a member with no attendance rows as Offline, never undefined", async () => {
    const { db } = fakeDb({ users: [userRow({ id: "u1", attendance: [] })] });
    const cards = await listTeamCards(db, NOW);
    expect(cards[0].presenceLabel).toBe("Offline");
    expect(cards[0].presenceBadge).toBeTruthy();
  });

  // Someone who forgot to punch out on Wednesday is not at their desk on
  // Friday. The row stays open — it is never auto-closed — but it stops
  // claiming presence at the day roll.
  it("reports a session left open from an earlier day as Offline", async () => {
    const { db } = fakeDb({ users: [userRow({ id: "u1", attendance: [forgottenYesterday] })] });
    const cards = await listTeamCards(db, NOW);
    expect(cards[0].presenceLabel).toBe("Offline");
  });

  it("asks for at most one open session per member on the member query", async () => {
    const { db, userFindManyArgs } = fakeDb({ users: [userRow()] });
    await listTeamCards(db, NOW);
    const select = (userFindManyArgs[0] as { select: { attendance: unknown } }).select;
    // No `endedAt`: presence needs only whether the session is open and which
    // app day it began on. Selecting an end time would be the first step back
    // towards showing a duration.
    expect(select.attendance).toEqual({
      where: { resolution: null },
      select: { startedAt: true, resolution: true },
      take: 1,
    });
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
      openTasks: [openTaskRow({ userId: "ghost" })],
    });
    const cards = await listTeamCards(db);
    expect(cards).toHaveLength(1);
    expect(cards.find((c) => c.id === "ghost")).toBeUndefined();
  });
});

type ProfileParts = {
  member?: { id: string; name: string; title: string | null; active: boolean } | null;
  tasks?: unknown[];
  projectRows?: { project: { id: string; name: string; clientId: string; client: { name: string } } | null }[];
};

function fakeProfileDb(parts: ProfileParts) {
  const calls = { userFindUnique: 0, taskFindMany: 0 };
  const taskFindManyArgs: unknown[] = [];

  const db = {
    user: {
      findUnique: async () => {
        calls.userFindUnique++;
        return parts.member ?? null;
      },
    },
    task: {
      findMany: async (args: unknown) => {
        calls.taskFindMany++;
        taskFindManyArgs.push(args);
        // First call is listAssignedTasks; second is the project query.
        return calls.taskFindMany === 1 ? (parts.tasks ?? []) : (parts.projectRows ?? []);
      },
    },
  } as unknown as PrismaClient;

  return { db, calls: () => ({ ...calls }), taskFindManyArgs };
}

const MEMBER = { id: "u1", name: "Dana Reeve", title: "Designer", active: true };

const projectRow = (id: string, name: string) => ({
  project: { id, name, clientId: "c1", client: { name: "Harlow & Fitch" } },
});

describe("getMemberProfile", () => {
  it("returns null for an unknown member and issues no task query", async () => {
    const { db, calls } = fakeProfileDb({ member: null });
    expect(await getMemberProfile(db, "ghost")).toBeNull();
    expect(calls().taskFindMany).toBe(0);
  });

  it("issues exactly three queries whatever the row count", async () => {
    const { db, calls } = fakeProfileDb({
      member: MEMBER,
      projectRows: [projectRow("p1", "Brand Guidelines v3"), projectRow("p2", "Launch Toolkit")],
    });
    await getMemberProfile(db, "u1");
    expect(calls()).toEqual({ userFindUnique: 1, taskFindMany: 2 });
  });

  it("lists each project once however many tasks the member holds on it", async () => {
    const { db } = fakeProfileDb({
      member: MEMBER,
      projectRows: [projectRow("p1", "Brand Guidelines v3"), projectRow("p1", "Brand Guidelines v3")],
    });
    const profile = await getMemberProfile(db, "u1");
    expect(profile?.projects).toEqual([
      { id: "p1", name: "Brand Guidelines v3", clientId: "c1", clientName: "Harlow & Fitch" },
    ]);
  });

  // A personal task has no project to contribute. Prisma returns project:
  // null for it, and an unguarded fold would push undefined into the list.
  it("skips personal tasks when building the project list", async () => {
    const { db } = fakeProfileDb({
      member: MEMBER,
      projectRows: [{ project: null }, projectRow("p1", "Brand Guidelines v3")],
    });
    const profile = await getMemberProfile(db, "u1");
    expect(profile?.projects).toHaveLength(1);
    expect(profile?.projects[0].id).toBe("p1");
  });

  // The whole reason the project list has its own query. If it folded out of
  // the filtered task rows, filtering to Done would claim the member is
  // active on nothing.
  it("returns the same project list with a status filter as without one", async () => {
    const rows = [projectRow("p1", "Brand Guidelines v3")];
    const unfiltered = fakeProfileDb({ member: MEMBER, projectRows: rows });
    const filtered = fakeProfileDb({ member: MEMBER, projectRows: rows });

    const a = await getMemberProfile(unfiltered.db, "u1");
    const b = await getMemberProfile(filtered.db, "u1", { status: "DONE" });
    expect(b?.projects).toEqual(a?.projects);
  });

  it("excludes DONE tasks from the project query", async () => {
    const { db, taskFindManyArgs } = fakeProfileDb({ member: MEMBER });
    await getMemberProfile(db, "u1");
    expect(taskFindManyArgs[1]).toMatchObject({
      where: { assignees: { some: { userId: "u1" } }, status: { not: "DONE" } },
    });
  });

  // Nothing else in this suite notices if the filter is dropped on the way to
  // listAssignedTasks — every other assertion reads the project query or the
  // member, and both ignore it. The profile page's whole filter is this one
  // argument, so it gets its own test rather than riding on another's.
  it("forwards the status filter to the task query and asks for open work without one", async () => {
    const filtered = fakeProfileDb({ member: MEMBER });
    await getMemberProfile(filtered.db, "u1", { status: "DONE" });
    expect(filtered.taskFindManyArgs[0]).toMatchObject({
      where: { assignees: { some: { userId: "u1" } }, status: "DONE" },
    });

    const unfiltered = fakeProfileDb({ member: MEMBER });
    await getMemberProfile(unfiltered.db, "u1");
    expect(unfiltered.taskFindManyArgs[0]).toMatchObject({
      where: { assignees: { some: { userId: "u1" } }, status: { not: "DONE" } },
    });
  });

  // Both task queries come off the same delegate and return different shapes.
  // Reading them the wrong way round would put project rows on `tasks` and
  // still satisfy every assertion above.
  it("returns the assigned task rows rather than the project query's rows", async () => {
    const { db } = fakeProfileDb({
      member: MEMBER,
      tasks: [
        {
          id: "t1",
          title: "Draft the brief",
          status: "IN_PROGRESS",
          priority: "HIGH",
          dueDate: DUE,
          projectId: "p1",
          project: { name: "Brand Guidelines v3", clientId: "c1", client: { name: "Harlow & Fitch" } },
          assignees: [{ user: { id: "u1", name: "Dana Reeve" } }],
          blockedBy: [],
        },
      ],
      projectRows: [projectRow("p1", "Brand Guidelines v3")],
    });
    const profile = await getMemberProfile(db, "u1");
    expect(profile?.tasks.map((t) => t.id)).toEqual(["t1"]);
    expect(profile?.tasks[0]).toMatchObject({
      title: "Draft the brief",
      projectName: "Brand Guidelines v3",
      clientName: "Harlow & Fitch",
    });
  });

  it("carries the member's own fields and derived initials", async () => {
    const { db } = fakeProfileDb({ member: { ...MEMBER, active: false } });
    const profile = await getMemberProfile(db, "u1");
    expect(profile).toMatchObject({
      id: "u1",
      name: "Dana Reeve",
      initials: "DR",
      title: "Designer",
      active: false,
    });
  });
});
