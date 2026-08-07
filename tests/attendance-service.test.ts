import { describe, it, expect } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  punchIn,
  punchOut,
  correctSession,
  discardSession,
} from "@/lib/attendance-service";

type OpenRow = { id: string; startedAt: Date } | null;

/** The canonical fake: one shared set of closures behind both the top-level
 * delegates and the transaction client, so a write is captured whether the
 * service used `db` or `tx`. */
function fakeDb(
  parts: {
    open?: OpenRow;
    others?: { startedAt: Date; endedAt: Date | null; resolution: string | null }[];
    createThrows?: unknown;
    updateManyCount?: number;
  } = {}
) {
  const created: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  const updateManyArgs: { where: Record<string, unknown>; data: Record<string, unknown> }[] = [];
  const activity: Record<string, unknown>[] = [];

  const delegate = {
    findFirst: async () => parts.open ?? null,
    findMany: async () => parts.others ?? [],
    create: async (args: { data: Record<string, unknown> }) => {
      if (parts.createThrows) throw parts.createThrows;
      created.push(args.data);
      return { id: "new1", ...args.data };
    },
    update: async (args: { data: Record<string, unknown> }) => {
      updates.push(args.data);
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

  // A session left open from an earlier day blocks today's punch-in, because
  // the index is scoped to the member alone. That must be a prompt, not a
  // dead end.
  it("returns the stale session for resolution instead of erroring", async () => {
    const { db, created } = fakeDb({ open: { id: "stale", startedAt: TUE_09 } });
    const result = await punchIn(db, { actorId: "u1", now: WED_10 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({ needsResolution: { id: "stale", startedAt: TUE_09 } });
    }
    expect(created).toHaveLength(0);
  });

  it("writes no ActivityLog row — routine punches would flood the feed", async () => {
    const { db, activity } = fakeDb({ open: null });
    await punchIn(db, { actorId: "u1", now: TUE_09 });
    expect(activity).toHaveLength(0);
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

describe("correctSession", () => {
  it("stores a valid end time and marks it CORRECTED", async () => {
    const { db, updates } = fakeDb({ open: { id: "s1", startedAt: TUE_09 }, others: [] });
    // `now` is the next morning: this is a *retroactive* close, so the end
    // being in the past relative to now is the whole point.
    const result = await correctSession(db, {
      sessionId: "s1",
      date: "2026-08-04",
      time: "17:00",
      actorId: "u1",
      now: WED_10,
    });
    expect(result.ok).toBe(true);
    expect(updates[0]).toMatchObject({ resolution: "CORRECTED", resolvedById: "u1" });
  });

  // "A hidden control is not a control" — the refusal lives in the query
  // scope, not in whether the UI rendered a button.
  it("scopes the lookup to the actor, so another member's session is not found", async () => {
    const { db, updates } = fakeDb({ open: null });
    const result = await correctSession(db, {
      sessionId: "someone-elses",
      date: "2026-08-04",
      time: "17:00",
      actorId: "u1",
      now: TUE_15,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("That session is not open, or is not yours.");
    expect(updates).toHaveLength(0);
  });

  it("refuses an end before the start, with the specific message and no write", async () => {
    const { db, updates } = fakeDb({ open: { id: "s1", startedAt: TUE_15 }, others: [] });
    const result = await correctSession(db, {
      sessionId: "s1",
      date: "2026-08-04",
      time: "06:00",
      actorId: "u1",
      now: WED_10,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("The end time must be after the start.");
    expect(updates).toHaveLength(0);
  });

  it("refuses an unparseable time rather than clamping it", async () => {
    const { db, updates } = fakeDb({ open: { id: "s1", startedAt: TUE_09 }, others: [] });
    const result = await correctSession(db, {
      sessionId: "s1",
      date: "2026-08-04",
      time: "25:99",
      actorId: "u1",
      now: TUE_15,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Enter a valid date and time.");
    expect(updates).toHaveLength(0);
  });

  // The one double-count this feature could produce: two closed sessions
  // claiming the same hour. The unique index cannot see it, because both rows
  // are closed.
  it("refuses an end that overlaps another recorded session", async () => {
    const { db, updates } = fakeDb({
      open: { id: "s1", startedAt: TUE_09 },
      others: [
        {
          startedAt: new Date("2026-08-04T06:00:00.000Z"),
          endedAt: new Date("2026-08-04T09:00:00.000Z"),
          resolution: "PUNCH_OUT",
        },
      ],
    });
    const result = await correctSession(db, {
      sessionId: "s1",
      date: "2026-08-04",
      time: "17:00",
      actorId: "u1",
      now: WED_10,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("That overlaps another session you already recorded.");
    expect(updates).toHaveLength(0);
  });

  it("records an attendance.corrected activity row with no client scope", async () => {
    const { db, activity } = fakeDb({ open: { id: "s1", startedAt: TUE_09 }, others: [] });
    await correctSession(db, {
      sessionId: "s1",
      date: "2026-08-04",
      time: "17:00",
      actorId: "u1",
      now: WED_10,
    });
    expect(activity[0]).toMatchObject({
      entityType: "ATTENDANCE",
      action: "attendance.corrected",
      clientId: null,
    });
  });
});

describe("discardSession", () => {
  it("resolves the session without ever giving it an end time", async () => {
    const { db, updateManyArgs } = fakeDb();
    const result = await discardSession(db, { sessionId: "s1", actorId: "u1", now: TUE_15 });
    expect(result.ok).toBe(true);
    expect(updateManyArgs[0].where).toEqual({ id: "s1", memberId: "u1", resolution: null });
    expect(updateManyArgs[0].data).toMatchObject({ resolution: "DISCARDED", resolvedById: "u1" });
    expect(updateManyArgs[0].data).not.toHaveProperty("endedAt");
  });

  it("refuses somebody else's session", async () => {
    const { db } = fakeDb({ updateManyCount: 0 });
    const result = await discardSession(db, { sessionId: "s1", actorId: "u2", now: TUE_15 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("That session is not open, or is not yours.");
  });

  it("records an attendance.discarded activity row", async () => {
    const { db, activity } = fakeDb();
    await discardSession(db, { sessionId: "s1", actorId: "u1", now: TUE_15 });
    expect(activity[0]).toMatchObject({
      entityType: "ATTENDANCE",
      action: "attendance.discarded",
      clientId: null,
    });
  });
});
