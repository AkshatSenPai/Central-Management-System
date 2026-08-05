import { describe, it, expect } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createCalendarEvent } from "@/lib/calendar-event-service";
import { eventTimeLabel } from "@/lib/calendar-event";
import { toDateInputValue } from "@/lib/dates";

type FakeParts = {
  /** Row returned by project.findUnique — the parent lookup that pins clientId. */
  project?: unknown;
  /** Rows returned by user.findMany — resolveAttendees. */
  activeUsers?: { id: string; name: string }[];
};

type Sink = {
  created: Record<string, unknown>[];
  attendeesCreated: Record<string, unknown>[];
  activity: Record<string, unknown>[];
  /** Rows handed to notification.createMany, flattened. A notification must
   * be written in the SAME transaction as the create that caused it, so this
   * sink proves which client it was called on. */
  notifications: Record<string, unknown>[];
};

function emptySink(): Sink {
  return { created: [], attendeesCreated: [], activity: [], notifications: [] };
}

/** The task-service fake shape (tests/task-service.test.ts:52-57), copied
 * exactly: reads are shared between `db` and `tx`, but writes go to the sink
 * they were called on — so a write issued on the outer `db` (a
 * non-transactional slip, including `recordActivity(db, …)` instead of
 * `recordActivity(tx, …)`) lands in `dbW` and fails any test asserting it
 * empty, instead of silently passing. */
function fakeDb(parts: FakeParts) {
  const dbW = emptySink();
  const txW = emptySink();
  const calls = { projectFindUnique: 0, userFindMany: 0 };
  const args: { userFindManyWhere?: unknown } = {};

  const reads = {
    project: {
      findUnique: async () => {
        calls.projectFindUnique++;
        return parts.project ?? null;
      },
    },
    user: {
      findMany: async (a: { where: unknown }) => {
        calls.userFindMany++;
        args.userFindManyWhere = a.where;
        return parts.activeUsers ?? [];
      },
    },
  };

  const writers = (sink: Sink) => ({
    calendarEvent: {
      create: async (a: { data: Record<string, unknown> }) => {
        sink.created.push(a.data);
        return { id: "event1", ...a.data };
      },
    },
    calendarEventAttendee: {
      createMany: async (a: Record<string, unknown>) => {
        sink.attendeesCreated.push(a);
        // What real Postgres returns when ON CONFLICT DO NOTHING absorbs
        // every row: a success carrying a zero count, never a throw.
        return { count: 0 };
      },
    },
    activityLog: {
      create: async (a: { data: Record<string, unknown> }) => {
        sink.activity.push(a.data);
        return a.data;
      },
    },
    notification: {
      createMany: async (a: { data: Record<string, unknown>[] }) => {
        sink.notifications.push(...a.data);
        return { count: a.data.length };
      },
    },
  });

  const db = {
    project: reads.project,
    user: reads.user,
    calendarEvent: writers(dbW).calendarEvent,
    calendarEventAttendee: writers(dbW).calendarEventAttendee,
    activityLog: writers(dbW).activityLog,
    notification: writers(dbW).notification,
    // Mirrors real transactional rollback: a thrown error undoes everything
    // this specific call pushed into txW before the error propagates, the
    // same behaviour tests/task-service.test.ts's fake provides.
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const before = {
        created: txW.created.length,
        attendeesCreated: txW.attendeesCreated.length,
        activity: txW.activity.length,
        notifications: txW.notifications.length,
      };
      try {
        return await fn({
          project: reads.project,
          user: reads.user,
          calendarEvent: writers(txW).calendarEvent,
          calendarEventAttendee: writers(txW).calendarEventAttendee,
          activityLog: writers(txW).activityLog,
          notification: writers(txW).notification,
        });
      } catch (e) {
        txW.created.length = before.created;
        txW.attendeesCreated.length = before.attendeesCreated;
        txW.activity.length = before.activity;
        txW.notifications.length = before.notifications;
        throw e;
      }
    },
  } as unknown as PrismaClient;

  return { db, dbW, txW, calls, args };
}

const project1 = { id: "p1", clientId: "c1" };

const startsAt = new Date("2026-08-10T09:00:00.000Z"); // 14:30 IST
const endsAt = new Date("2026-08-10T10:00:00.000Z"); // 15:30 IST

const baseInput = {
  title: "Verity kickoff call",
  description: null as string | null,
  startsAt,
  endsAt,
  allDay: false,
  projectId: null as string | null,
  clientId: null as string | null,
  attendeeIds: [] as string[],
  actorId: "u1",
};

describe("createCalendarEvent", () => {
  it("rejects a blank title", async () => {
    const { db } = fakeDb({});
    expect(await createCalendarEvent(db, { ...baseInput, title: "   " })).toEqual({
      ok: false,
      error: "Give the event a title",
    });
  });

  it("errors on an unknown project, with nothing written", async () => {
    const { db, dbW, txW } = fakeDb({});
    const result = await createCalendarEvent(db, { ...baseInput, projectId: "ghost" });
    expect(result).toEqual({ ok: false, error: "Project not found" });
    expect(txW.created).toHaveLength(0);
    expect(dbW.created).toHaveLength(0);
  });

  it("resolves and stores the project's clientId", async () => {
    const { db, txW } = fakeDb({ project: project1 });
    const result = await createCalendarEvent(db, { ...baseInput, projectId: "p1" });
    expect(result.ok).toBe(true);
    expect(txW.created[0].clientId).toBe("c1");
    expect(txW.created[0].projectId).toBe("p1");
  });

  it("issues no project lookup for an event with no project", async () => {
    const { db, calls, txW } = fakeDb({});
    await createCalendarEvent(db, { ...baseInput, projectId: null, clientId: "c9" });
    expect(calls.projectFindUnique).toBe(0);
    // The direct client picker's value, live only when no project is chosen
    // (spec §8 item 6) — the prospect-with-no-project case.
    expect(txW.created[0].clientId).toBe("c9");
  });

  it("stores the creator as the actor", async () => {
    const { db, txW } = fakeDb({});
    await createCalendarEvent(db, { ...baseInput, actorId: "u7" });
    expect(txW.created[0].creatorId).toBe("u7");
  });

  it("stores the start, end and allDay fields as given", async () => {
    const { db, txW } = fakeDb({});
    await createCalendarEvent(db, { ...baseInput, allDay: true });
    expect(txW.created[0].startsAt).toBe(startsAt);
    expect(txW.created[0].endsAt).toBe(endsAt);
    expect(txW.created[0].allDay).toBe(true);
  });

  it("logs exactly one activity row", async () => {
    const { db, txW } = fakeDb({});
    await createCalendarEvent(db, { ...baseInput });
    expect(txW.activity).toHaveLength(1);
    expect(txW.activity[0]).toMatchObject({ action: "event.created", entityType: "CALENDAR_EVENT" });
  });

  it("logs exactly one activity row even when created with attendees", async () => {
    const { db, txW } = fakeDb({ activeUsers: [{ id: "u2", name: "Riley" }] });
    await createCalendarEvent(db, { ...baseInput, attendeeIds: ["u2"] });
    expect(txW.activity).toHaveLength(1);
    expect(txW.activity[0].action).toBe("event.created");
  });

  it("logs the grandparent clientId and the title in meta", async () => {
    const { db, txW } = fakeDb({ project: project1 });
    await createCalendarEvent(db, { ...baseInput, projectId: "p1" });
    expect(txW.activity[0]).toMatchObject({ clientId: "c1" });
    expect(txW.activity[0].meta).toEqual({ name: "Verity kickoff call" });
  });

  it("creates one CalendarEventAttendee row per attendee, and the row, the attendee rows, the activity row and the notification rows all land on tx and never on the outer db", async () => {
    const { db, dbW, txW } = fakeDb({
      activeUsers: [
        { id: "u2", name: "Riley" },
        { id: "u3", name: "Sam" },
      ],
    });
    await createCalendarEvent(db, { ...baseInput, actorId: "actor1", attendeeIds: ["u2", "u3"] });
    expect(txW.created).toHaveLength(1);
    expect(txW.attendeesCreated).toHaveLength(1);
    expect(txW.attendeesCreated[0].data).toHaveLength(2);
    expect(txW.activity).toHaveLength(1);
    expect(txW.notifications).toHaveLength(2);
    expect(dbW.created).toHaveLength(0);
    expect(dbW.attendeesCreated).toHaveLength(0);
    expect(dbW.activity).toHaveLength(0);
    expect(dbW.notifications).toHaveLength(0);
  });

  it("passes skipDuplicates on the attendee insert", async () => {
    const { db, txW } = fakeDb({ activeUsers: [{ id: "u2", name: "Riley" }] });
    await createCalendarEvent(db, { ...baseInput, attendeeIds: ["u2"] });
    expect(txW.attendeesCreated[0].skipDuplicates).toBe(true);
  });

  it("de-duplicates repeated attendee ids", async () => {
    const { db, txW } = fakeDb({ activeUsers: [{ id: "u2", name: "Riley" }] });
    await createCalendarEvent(db, { ...baseInput, attendeeIds: ["u2", "u2", "u2"] });
    expect(txW.attendeesCreated[0].data).toEqual([{ eventId: "event1", userId: "u2" }]);
  });

  it("rejects an unknown or deactivated attendee id, with nothing written", async () => {
    const { db, dbW, txW } = fakeDb({ activeUsers: [] });
    const result = await createCalendarEvent(db, { ...baseInput, attendeeIds: ["ghost"] });
    expect(result).toEqual({ ok: false, error: "Invalid input" });
    expect(txW.created).toHaveLength(0);
    expect(txW.attendeesCreated).toHaveLength(0);
    expect(dbW.created).toHaveLength(0);
  });

  it("asks only for active users when resolving attendees", async () => {
    const { db, args } = fakeDb({ activeUsers: [{ id: "u2", name: "Riley" }] });
    await createCalendarEvent(db, { ...baseInput, attendeeIds: ["u2"] });
    expect(args.userFindManyWhere).toEqual({ id: { in: ["u2"] }, active: true });
  });
});

describe("createCalendarEvent notifications", () => {
  it("notifies the resolved attendees, inside the transaction", async () => {
    const { db, dbW, txW } = fakeDb({
      activeUsers: [
        { id: "u1", name: "Dana Reeve" },
        { id: "u2", name: "Tom Iversen" },
      ],
    });
    // A distinct actor: baseInput.actorId is "u1", who is also being invited
    // here, and notify() would correctly filter them out — same guard the
    // task-creation test uses for the same reason.
    await createCalendarEvent(db, { ...baseInput, actorId: "actor1", attendeeIds: ["u1", "u2"] });

    expect(txW.notifications.map((n) => n.recipientId)).toEqual(["u1", "u2"]);
    expect(txW.notifications[0]).toMatchObject({ type: "EVENT_SCHEDULED", entityId: "event1" });
    expect(dbW.notifications).toEqual([]);
  });

  it("writes no notification when created with nobody attending", async () => {
    const { db, txW } = fakeDb({});
    await createCalendarEvent(db, { ...baseInput, attendeeIds: [] });
    expect(txW.notifications).toEqual([]);
  });

  // The central filter (notification-service.ts:45) does the work, not a
  // local check here — proven by leaving no call-site filter to fall back on.
  it("writes zero notifications when the only attendee is the actor", async () => {
    const { db, txW } = fakeDb({ activeUsers: [{ id: "actor1", name: "Akshat Singh" }] });
    await createCalendarEvent(db, { ...baseInput, actorId: "actor1", attendeeIds: ["actor1"] });
    expect(txW.notifications).toEqual([]);
  });

  it("carries name, a formatted app-time when, and the app-zone date in meta", async () => {
    const { db, txW } = fakeDb({ activeUsers: [{ id: "u2", name: "Riley" }] });
    await createCalendarEvent(db, { ...baseInput, actorId: "actor1", attendeeIds: ["u2"] });
    expect(txW.notifications[0].meta).toEqual({
      name: "Verity kickoff call",
      when: eventTimeLabel({ startsAt, endsAt, allDay: false }),
      date: toDateInputValue(startsAt),
    });
  });

  it("carries 'All day' as when for an all-day event", async () => {
    const { db, txW } = fakeDb({ activeUsers: [{ id: "u2", name: "Riley" }] });
    await createCalendarEvent(db, {
      ...baseInput,
      actorId: "actor1",
      allDay: true,
      attendeeIds: ["u2"],
    });
    expect(txW.notifications[0].meta).toMatchObject({ when: "All day" });
  });
});
