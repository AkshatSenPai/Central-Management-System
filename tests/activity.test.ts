import { describe, it, expect } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  recordActivity,
  fieldDiff,
  describeActivity,
  formatNameList,
  listClientActivity,
  listActivityForExport,
  type ActivityDb,
} from "@/lib/activity";

function fakeActivityDb() {
  const created: Record<string, unknown>[] = [];
  const db = {
    activityLog: {
      create: async (args: { data: Record<string, unknown> }) => {
        created.push(args.data);
        return args.data;
      },
    },
  } as unknown as ActivityDb;
  return { db, created };
}

describe("recordActivity", () => {
  it("writes a row with the given actor, entity, action and client scope", async () => {
    const { db, created } = fakeActivityDb();
    await recordActivity(db, {
      actorId: "u1",
      entityType: "PROJECT",
      entityId: "p1",
      action: "project.created",
      clientId: "c1",
      meta: { name: "Autumn Campaign" },
    });
    expect(created[0]).toMatchObject({
      actorId: "u1",
      entityType: "PROJECT",
      entityId: "p1",
      action: "project.created",
      clientId: "c1",
      meta: { name: "Autumn Campaign" },
    });
  });

  it("writes meta as Prisma.DbNull when none is given", async () => {
    const { db, created } = fakeActivityDb();
    await recordActivity(db, {
      actorId: "u1",
      entityType: "CLIENT",
      entityId: "c1",
      action: "client.created",
      clientId: "c1",
    });
    expect(created[0].meta).not.toBeUndefined();
    expect(created[0].meta).toBe(Prisma.DbNull);
  });

  it("writes the row with a null client scope", async () => {
    const { db, created } = fakeActivityDb();
    await recordActivity(db, {
      actorId: "u1",
      entityType: "CLIENT",
      entityId: "c1",
      action: "client.deleted",
      clientId: null,
      meta: { name: "Harlow & Fitch" },
    });
    expect(created[0].clientId).toBeNull();
  });

  it("does not set at — the column default owns the timestamp", async () => {
    const { db, created } = fakeActivityDb();
    await recordActivity(db, {
      actorId: "u1",
      entityType: "CLIENT",
      entityId: "c1",
      action: "client.created",
      clientId: "c1",
    });
    expect(Object.keys(created[0])).not.toContain("at");
  });

  it("writes through a transaction client shaped as Pick<PrismaClient, 'activityLog'>", async () => {
    const captured: Record<string, unknown>[] = [];
    // A bare object with nothing but the activityLog delegate — the narrow
    // ActivityDb type is what lets a $transaction `tx` be passed straight in.
    const tx = {
      activityLog: {
        create: async (args: { data: Record<string, unknown> }) => {
          captured.push(args.data);
          return args.data;
        },
      },
    } as unknown as ActivityDb;
    await recordActivity(tx, {
      actorId: "u1",
      entityType: "MILESTONE",
      entityId: "m1",
      action: "milestone.completed",
      clientId: "c1",
    });
    expect(captured).toHaveLength(1);
    expect(captured[0].action).toBe("milestone.completed");
  });
});

describe("fieldDiff", () => {
  it("returns null when nothing changed", () => {
    const before = { name: "Harlow", sector: "Retail" };
    expect(fieldDiff(before, { name: "Harlow", sector: "Retail" }, ["name", "sector"])).toBeNull();
  });

  it("returns only the changed keys as from/to pairs", () => {
    const before = { name: "Harlow", sector: "Retail" };
    expect(fieldDiff(before, { name: "Harlow & Fitch", sector: "Retail" }, ["name", "sector"])).toEqual({
      name: { from: "Harlow", to: "Harlow & Fitch" },
    });
  });

  it("ignores keys not listed in fields", () => {
    const before = { name: "Harlow", sector: "Retail" };
    expect(fieldDiff(before, { name: "Harlow", sector: "Healthcare" }, ["name"])).toBeNull();
  });

  it("treats an empty string and null as equal", () => {
    const before = { sector: null as string | null };
    expect(fieldDiff(before, { sector: "" }, ["sector"])).toBeNull();
  });
});

describe("formatNameList", () => {
  it("returns an empty string for nobody", () => {
    expect(formatNameList([])).toBe("");
  });

  it("returns the single name for one", () => {
    expect(formatNameList(["Tom Iversen"])).toBe("Tom Iversen");
  });

  it('joins two with " and "', () => {
    expect(formatNameList(["Tom Iversen", "Dana Reeve"])).toBe("Tom Iversen and Dana Reeve");
  });

  it('joins three as "A, B and C"', () => {
    expect(formatNameList(["Tom Iversen", "Dana Reeve", "Priya Malhotra"])).toBe(
      "Tom Iversen, Dana Reeve and Priya Malhotra"
    );
  });
});

describe("describeActivity", () => {
  it("describes a created client", () => {
    expect(
      describeActivity({
        actorName: "Sarah Whitfield",
        action: "client.created",
        meta: { name: "Harlow & Fitch" },
      })
    ).toBe("Sarah Whitfield created client Harlow & Fitch");
  });

  it("describes a project health change", () => {
    expect(
      describeActivity({
        actorName: "Sarah Whitfield",
        action: "project.health_changed",
        meta: { name: "Autumn Campaign", from: "ON_TRACK", to: "AT_RISK" },
      })
    ).toBe("Sarah Whitfield flagged Autumn Campaign as At Risk");
  });

  it("describes a completed milestone", () => {
    expect(
      describeActivity({
        actorName: "Sarah Whitfield",
        action: "milestone.completed",
        meta: { name: "Design system freeze" },
      })
    ).toBe("Sarah Whitfield completed milestone Design system freeze");
  });

  it("describes a created task", () => {
    expect(
      describeActivity({
        actorName: "Sarah Whitfield",
        action: "task.created",
        meta: { name: "Ship the deck" },
      })
    ).toBe("Sarah Whitfield created task Ship the deck");
  });

  it("describes an updated task", () => {
    expect(
      describeActivity({
        actorName: "Sarah Whitfield",
        action: "task.updated",
        meta: { name: "Ship the deck" },
      })
    ).toBe("Sarah Whitfield updated task Ship the deck");
  });

  it("describes a task status change using the locked labels", () => {
    expect(
      describeActivity({
        actorName: "Sarah Whitfield",
        action: "task.status_changed",
        meta: { name: "Ship the deck", from: "TO_DO", to: "IN_PROGRESS" },
      })
    ).toBe("Sarah Whitfield moved Ship the deck to In Progress");
  });

  it("describes an assignment naming everyone affected", () => {
    expect(
      describeActivity({
        actorName: "Sarah Whitfield",
        action: "task.assigned",
        meta: { name: "Ship the deck", people: ["Tom Iversen", "Dana Reeve"] },
      })
    ).toBe("Sarah Whitfield assigned Ship the deck to Tom Iversen and Dana Reeve");
  });

  it("describes an unassignment", () => {
    expect(
      describeActivity({
        actorName: "Sarah Whitfield",
        action: "task.unassigned",
        meta: { name: "Ship the deck", people: ["Tom Iversen"] },
      })
    ).toBe("Sarah Whitfield unassigned Tom Iversen from Ship the deck");
  });

  it("falls back to a generic task sentence when the people list is missing or is not an array of strings", () => {
    expect(() =>
      describeActivity({
        actorName: "Sarah Whitfield",
        action: "task.assigned",
        meta: { name: "Ship the deck" },
      })
    ).not.toThrow();
    expect(
      describeActivity({
        actorName: "Sarah Whitfield",
        action: "task.assigned",
        meta: { name: "Ship the deck" },
      })
    ).toBe("Sarah Whitfield updated task Ship the deck");
    expect(
      describeActivity({
        actorName: "Sarah Whitfield",
        action: "task.unassigned",
        meta: { name: "Ship the deck", people: "Tom Iversen" },
      })
    ).toBe("Sarah Whitfield updated task Ship the deck");
    expect(
      describeActivity({
        actorName: "Sarah Whitfield",
        action: "task.unassigned",
        meta: { name: "Ship the deck", people: [1, 2] },
      })
    ).toBe("Sarah Whitfield updated task Ship the deck");
  });

  it("describes a removed task", () => {
    expect(
      describeActivity({
        actorName: "Sarah Whitfield",
        action: "task.removed",
        meta: { name: "Ship the deck" },
      })
    ).toBe("Sarah Whitfield removed task Ship the deck");
  });

  it("describes an added, completed, reopened and removed checklist item", () => {
    expect(
      describeActivity({
        actorName: "Sarah Whitfield",
        action: "checklist.added",
        meta: { name: "Send invoice" },
      })
    ).toBe("Sarah Whitfield added checklist item Send invoice");
    expect(
      describeActivity({
        actorName: "Sarah Whitfield",
        action: "checklist.completed",
        meta: { name: "Send invoice" },
      })
    ).toBe("Sarah Whitfield completed checklist item Send invoice");
    expect(
      describeActivity({
        actorName: "Sarah Whitfield",
        action: "checklist.reopened",
        meta: { name: "Send invoice" },
      })
    ).toBe("Sarah Whitfield reopened checklist item Send invoice");
    expect(
      describeActivity({
        actorName: "Sarah Whitfield",
        action: "checklist.removed",
        meta: { name: "Send invoice" },
      })
    ).toBe("Sarah Whitfield removed checklist item Send invoice");
  });

  it("falls back to a generic phrase for an unrecognised action", () => {
    // Phase 3 adds verbs without a migration; an old renderer must not throw
    // on a new action string. Do not delete this case.
    expect(() =>
      describeActivity({ actorName: "Sarah Whitfield", action: "task.archived", meta: { name: "Ship it" } })
    ).not.toThrow();
    expect(
      describeActivity({ actorName: "Sarah Whitfield", action: "task.archived", meta: { name: "Ship it" } })
    ).toBe("Sarah Whitfield updated this record");
  });
});

function fakeReadDb(rows: unknown[]) {
  const calls: unknown[] = [];
  const db = {
    activityLog: {
      findMany: async (args: unknown) => {
        calls.push(args);
        return rows;
      },
    },
  } as unknown as PrismaClient;
  return { db, calls };
}

const row = {
  id: "a1",
  action: "client.created",
  meta: { name: "Harlow & Fitch" },
  at: new Date("2026-07-30T12:00:00.000Z"),
  actor: { name: "Sarah Whitfield" },
};

describe("listClientActivity", () => {
  it("queries by client scope, newest first, capped at 30", async () => {
    const { db, calls } = fakeReadDb([row]);
    const entries = await listClientActivity(db, { clientId: "c1" });
    expect(calls[0]).toEqual({
      where: { clientId: "c1" },
      orderBy: { at: "desc" },
      take: 30,
      include: { actor: { select: { name: true } } },
    });
    expect(entries).toEqual([
      {
        id: "a1",
        actorName: "Sarah Whitfield",
        action: "client.created",
        meta: { name: "Harlow & Fitch" },
        at: new Date("2026-07-30T12:00:00.000Z"),
      },
    ]);
  });

  it("honours an explicit limit", async () => {
    const { db, calls } = fakeReadDb([]);
    await listClientActivity(db, { clientId: "c1", limit: 5 });
    expect((calls[0] as { take: number }).take).toBe(5);
  });
});

function fakeExportDb(rows: unknown[], clients: Array<{ id: string; name: string }> = []) {
  const logCalls: unknown[] = [];
  const clientCalls: unknown[] = [];
  const db = {
    activityLog: {
      findMany: async (args: unknown) => {
        logCalls.push(args);
        return rows;
      },
    },
    client: {
      findMany: async (args: unknown) => {
        clientCalls.push(args);
        return clients;
      },
    },
  } as unknown as PrismaClient;
  return { db, logCalls, clientCalls };
}

const exportRow = {
  id: "a1",
  action: "client.created",
  entityType: "CLIENT",
  entityId: "c1",
  clientId: "c1",
  meta: { name: "Harlow & Fitch" },
  at: new Date("2026-08-03T12:00:00.000Z"),
  actor: { id: "u1", name: "Sarah Whitfield" },
};

const FROM = new Date("2026-08-01T00:00:00.000Z");
const TO = new Date("2026-08-08T00:00:00.000Z");

describe("listActivityForExport", () => {
  // Every other reader here caps its rows because it renders a panel. This
  // one is an audit trail, and a silently truncated audit trail is worse than
  // none — the date range is the only bound.
  it("applies no row limit", async () => {
    const { db, logCalls } = fakeExportDb([exportRow], [{ id: "c1", name: "Harlow & Fitch" }]);
    await listActivityForExport(db, { from: FROM, to: TO });
    expect(logCalls[0]).not.toHaveProperty("take");
  });

  it("queries a half-open window, ascending", async () => {
    const { db, logCalls } = fakeExportDb([]);
    await listActivityForExport(db, { from: FROM, to: TO });
    expect(logCalls[0]).toMatchObject({
      where: { at: { gte: FROM, lt: TO } },
      orderBy: { at: "asc" },
    });
  });

  it("adds a client or actor filter only when given one", async () => {
    const none = fakeExportDb([]);
    await listActivityForExport(none.db, { from: FROM, to: TO });
    expect((none.logCalls[0] as { where: Record<string, unknown> }).where).toEqual({
      at: { gte: FROM, lt: TO },
    });

    const scoped = fakeExportDb([]);
    await listActivityForExport(scoped.db, { from: FROM, to: TO, clientId: "c1", actorId: "u1" });
    expect((scoped.logCalls[0] as { where: Record<string, unknown> }).where).toEqual({
      at: { gte: FROM, lt: TO },
      clientId: "c1",
      actorId: "u1",
    });
  });

  it("resolves the client name for a scoped row", async () => {
    const { db } = fakeExportDb([exportRow], [{ id: "c1", name: "Harlow & Fitch" }]);
    const rows = await listActivityForExport(db, { from: FROM, to: TO });
    expect(rows[0]).toMatchObject({
      actorId: "u1",
      actorName: "Sarah Whitfield",
      entityType: "CLIENT",
      entityId: "c1",
      clientId: "c1",
      clientName: "Harlow & Fitch",
    });
  });

  // ActivityLog.clientId carries no foreign key, so a row can outlive its
  // client — client.deleted is exactly such a row, and it is one of the most
  // worth exporting. It must keep its id and simply have no name.
  it("keeps a row whose client no longer exists, with a null name", async () => {
    const { db } = fakeExportDb([{ ...exportRow, clientId: "gone" }], []);
    const rows = await listActivityForExport(db, { from: FROM, to: TO });
    expect(rows[0].clientId).toBe("gone");
    expect(rows[0].clientName).toBeNull();
  });

  it("carries a null client scope through untouched", async () => {
    const { db, clientCalls } = fakeExportDb([{ ...exportRow, clientId: null }]);
    const rows = await listActivityForExport(db, { from: FROM, to: TO });
    expect(rows[0].clientId).toBeNull();
    expect(rows[0].clientName).toBeNull();
    // No ids to resolve, so the second query is skipped entirely.
    expect(clientCalls).toHaveLength(0);
  });

  it("resolves client names in one query however many rows share them", async () => {
    const { db, clientCalls } = fakeExportDb(
      [exportRow, { ...exportRow, id: "a2" }, { ...exportRow, id: "a3" }],
      [{ id: "c1", name: "Harlow & Fitch" }]
    );
    await listActivityForExport(db, { from: FROM, to: TO });
    expect(clientCalls).toHaveLength(1);
    expect((clientCalls[0] as { where: { id: { in: string[] } } }).where.id.in).toEqual(["c1"]);
  });
});
