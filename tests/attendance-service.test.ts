import { describe, it, expect } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { punchIn, punchOut } from "@/lib/attendance-service";

type OpenRow = { id: string; startedAt: Date } | null;

/** The canonical fake: one shared set of closures behind both the top-level
 * delegates and the transaction client, so a write is captured whether the
 * service used `db` or `tx`. */
function fakeDb(
  parts: { open?: OpenRow; createThrows?: unknown; updateManyCount?: number } = {}
) {
  const created: Record<string, unknown>[] = [];
  const updates: { where: Record<string, unknown>; data: Record<string, unknown> }[] = [];
  const updateManyArgs: { where: Record<string, unknown>; data: Record<string, unknown> }[] = [];
  const activity: Record<string, unknown>[] = [];

  const delegate = {
    findFirst: async () => parts.open ?? null,
    create: async (args: { data: Record<string, unknown> }) => {
      if (parts.createThrows) throw parts.createThrows;
      created.push(args.data);
      return { id: "new1", ...args.data };
    },
    update: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      updates.push(args);
      return args.data;
    },
    updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      updateManyArgs.push(args);
      return { count: parts.updateManyCount ?? 1 };
    },
  };
  const logCreate = async (args: { data: Record<string, unknown> }) => {
    activity.push(args.data);
    return args.data;
  };

  const db = {
    attendanceSession: delegate,
    activityLog: { create: logCreate },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ attendanceSession: delegate, activityLog: { create: logCreate } }),
  } as unknown as PrismaClient;

  return { db, created, updates, updateManyArgs, activity };
}

const duplicateKey = new Prisma.PrismaClientKnownRequestError("dupe", {
  code: "P2002",
  clientVersion: "test",
});

const TUE_09 = new Date("2026-08-04T03:30:00.000Z");
const TUE_15 = new Date("2026-08-04T09:30:00.000Z");
const WED_10 = new Date("2026-08-05T04:30:00.000Z");

describe("punchIn", () => {
  it("opens a session for the actor at the server's clock", async () => {
    const { db, created } = fakeDb({ open: null });
    const result = await punchIn(db, { actorId: "u1", now: TUE_09 });
    expect(result.ok).toBe(true);
    expect(created[0]).toMatchObject({ memberId: "u1", startedAt: TUE_09 });
  });

  it("refuses a second punch-in on the same day", async () => {
    const { db, created } = fakeDb({ open: { id: "s1", startedAt: TUE_09 } });
    const result = await punchIn(db, { actorId: "u1", now: TUE_15 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("You are already punched in");
    expect(created).toHaveLength(0);
  });

  // The pre-check is only the friendly path. Two taps on a slow connection
  // both pass it, and the partial unique index is what actually stops the
  // second — so a P2002 must come back as a sentence, not an unhandled throw.
  it("translates the index's duplicate-key error rather than throwing", async () => {
    const { db } = fakeDb({ open: null, createThrows: duplicateKey });
    const result = await punchIn(db, { actorId: "u1", now: TUE_09 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("You are already punched in");
  });

  // Nobody is asked when they left, because nothing counts hours. The stale
  // session is closed with no end time and a fresh one opens — one tap.
  it("absorbs a session left open on an earlier day and opens a new one", async () => {
    const { db, created, updates } = fakeDb({ open: { id: "stale", startedAt: TUE_09 } });
    const result = await punchIn(db, { actorId: "u1", now: WED_10 });

    expect(result.ok).toBe(true);
    expect(updates[0].where).toEqual({ id: "stale" });
    expect(updates[0].data).toMatchObject({ resolution: "DISCARDED", resolvedById: "u1" });
    // The whole point of the ruling: no end time is ever invented.
    expect(updates[0].data).not.toHaveProperty("endedAt");
    expect(created[0]).toMatchObject({ memberId: "u1", startedAt: WED_10 });
  });

  it("writes no ActivityLog row, for the punch or for the tidy-up", async () => {
    const fresh = fakeDb({ open: null });
    await punchIn(fresh.db, { actorId: "u1", now: TUE_09 });
    expect(fresh.activity).toHaveLength(0);

    const stale = fakeDb({ open: { id: "stale", startedAt: TUE_09 } });
    await punchIn(stale.db, { actorId: "u1", now: WED_10 });
    expect(stale.activity).toHaveLength(0);
  });
});

describe("punchOut", () => {
  // The IDOR test. No session id is accepted from the caller at all, and the
  // where clause is scoped to the actor, so there is no way to close somebody
  // else's session.
  it("closes only the actor's own open session", async () => {
    const { db, updateManyArgs } = fakeDb();
    await punchOut(db, { actorId: "u1", now: TUE_15 });
    expect(updateManyArgs[0].where).toEqual({ memberId: "u1", resolution: null });
    expect(updateManyArgs[0].data).toMatchObject({
      endedAt: TUE_15,
      resolution: "PUNCH_OUT",
      resolvedById: "u1",
    });
  });

  // Owner ruling: a stale tab whose owner already punched out on their phone
  // gets no error. They wanted to be punched out and they are.
  it("succeeds quietly when there was nothing open", async () => {
    const { db } = fakeDb({ updateManyCount: 0 });
    const result = await punchOut(db, { actorId: "u1", now: TUE_15 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.wasAlreadyClosed).toBe(true);
  });

  it("writes no ActivityLog row", async () => {
    const { db, activity } = fakeDb();
    await punchOut(db, { actorId: "u1", now: TUE_15 });
    expect(activity).toHaveLength(0);
  });
});
