import { describe, it, expect } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { createCalendarEvent, updateCalendarEvent, removeCalendarEvent } from "@/lib/calendar-event-service";
import { eventTimeLabel } from "@/lib/calendar-event";
import { toDateInputValue } from "@/lib/dates";

type FakeParts = {
  /** Row returned by project.findUnique — the parent lookup that pins clientId. */
  project?: unknown;
  /** Rows returned by user.findMany — resolveAttendees. */
  activeUsers?: { id: string; name: string }[];
  /** Recipients notify() should treat as deactivated and skip. */
  deactivated?: string[];
  /** Row returned by calendarEvent.findUnique — the load in update/remove. */
  event?: unknown;
  /** Rows returned by calendarEventAttendee.findMany — the attendee diff's
   * "current" snapshot, carrying names so the remove side never needs an
   * active-user lookup (the attemptTaskAssigneeDiff shape). */
  currentAttendees?: { userId: string; user: { name: string } }[];
  /** Thrown by calendarEvent.update when set — simulates a concurrent P2025
   * raised when the row was gone by the time the transaction ran. */
  eventUpdateError?: unknown;
  /** Thrown by calendarEvent.delete for the same race. */
  eventDeleteError?: unknown;
};

type Sink = {
  created: Record<string, unknown>[];
  updated: Record<string, unknown>[];
  deleted: unknown[];
  attendeesCreated: Record<string, unknown>[];
  attendeesDeleted: Record<string, unknown>[];
  activity: Record<string, unknown>[];
  /** Rows handed to notification.createMany, flattened. A notification must
   * be written in the SAME transaction as the create that caused it, so this
   * sink proves which client it was called on. */
  notifications: Record<string, unknown>[];
  notificationsCleared: Record<string, unknown>[];
};

function emptySink(): Sink {
  return {
    created: [],
    updated: [],
    deleted: [],
    attendeesCreated: [],
    attendeesDeleted: [],
    activity: [],
    notifications: [],
    notificationsCleared: [],
  };
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
  const args: { userFindManyWhere?: unknown; attendeeFindManyWhere?: unknown } = {};

  const reads = {
    project: {
      findUnique: async () => {
        calls.projectFindUnique++;
        return parts.project ?? null;
      },
    },
    user: {
      // Two callers now, told apart by their `select` — see the same note in
      // tests/task-service.test.ts. `notify` reads ids only, to drop
      // deactivated recipients, and must not be handed `activeUsers` or every
      // notification assertion in this file would mute itself.
      findMany: async (a: { where: { id: { in: string[] } }; select?: Record<string, unknown> }) => {
        if (!a.select?.name) {
          const gone = parts.deactivated ?? [];
          return a.where.id.in.filter((id) => !gone.includes(id)).map((id) => ({ id }));
        }
        calls.userFindMany++;
        args.userFindManyWhere = a.where;
        return parts.activeUsers ?? [];
      },
    },
    calendarEvent: {
      findUnique: async () => parts.event ?? null,
    },
    calendarEventAttendee: {
      findMany: async (a: { where: unknown }) => {
        args.attendeeFindManyWhere = a.where;
        return parts.currentAttendees ?? [];
      },
    },
  };

  const writers = (sink: Sink) => ({
    calendarEvent: {
      create: async (a: { data: Record<string, unknown> }) => {
        sink.created.push(a.data);
        return { id: "event1", ...a.data };
      },
      update: async (a: { data: Record<string, unknown> }) => {
        if (parts.eventUpdateError) throw parts.eventUpdateError;
        sink.updated.push(a.data);
        return a.data;
      },
      delete: async (a: unknown) => {
        if (parts.eventDeleteError) throw parts.eventDeleteError;
        sink.deleted.push(a);
        return {};
      },
    },
    calendarEventAttendee: {
      createMany: async (a: Record<string, unknown>) => {
        sink.attendeesCreated.push(a);
        // What real Postgres returns when ON CONFLICT DO NOTHING absorbs
        // every row: a success carrying a zero count, never a throw.
        return { count: 0 };
      },
      deleteMany: async (a: Record<string, unknown>) => {
        sink.attendeesDeleted.push(a);
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
      // createManyAndReturn, not createMany: notify() hands the new ids back
      // so the push fan-out can re-read the exact rows the bell will render.
      createManyAndReturn: async (a: { data: Record<string, unknown>[] }) => {
        sink.notifications.push(...a.data);
        return a.data.map((_, i) => ({ id: `notif${i + 1}` }));
      },
      deleteMany: async (a: Record<string, unknown>) => {
        sink.notificationsCleared.push(a);
        return { count: 0 };
      },
    },
  });

  const db = {
    project: reads.project,
    user: reads.user,
    calendarEvent: { ...reads.calendarEvent, ...writers(dbW).calendarEvent },
    calendarEventAttendee: { ...reads.calendarEventAttendee, ...writers(dbW).calendarEventAttendee },
    activityLog: writers(dbW).activityLog,
    notification: writers(dbW).notification,
    // Mirrors real transactional rollback: a thrown error undoes everything
    // this specific call pushed into txW before the error propagates, the
    // same behaviour tests/task-service.test.ts's fake provides.
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const before = {
        created: txW.created.length,
        updated: txW.updated.length,
        deleted: txW.deleted.length,
        attendeesCreated: txW.attendeesCreated.length,
        attendeesDeleted: txW.attendeesDeleted.length,
        activity: txW.activity.length,
        notifications: txW.notifications.length,
        notificationsCleared: txW.notificationsCleared.length,
      };
      try {
        return await fn({
          project: reads.project,
          user: reads.user,
          calendarEvent: { ...reads.calendarEvent, ...writers(txW).calendarEvent },
          calendarEventAttendee: { ...reads.calendarEventAttendee, ...writers(txW).calendarEventAttendee },
          activityLog: writers(txW).activityLog,
          notification: writers(txW).notification,
        });
      } catch (e) {
        txW.created.length = before.created;
        txW.updated.length = before.updated;
        txW.deleted.length = before.deleted;
        txW.attendeesCreated.length = before.attendeesCreated;
        txW.attendeesDeleted.length = before.attendeesDeleted;
        txW.activity.length = before.activity;
        txW.notifications.length = before.notifications;
        txW.notificationsCleared.length = before.notificationsCleared;
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

const movedStartsAt = new Date("2026-08-10T11:00:00.000Z"); // 16:30 IST
const movedEndsAt = new Date("2026-08-10T12:00:00.000Z"); // 17:30 IST

// A move that crosses an app-day boundary — existingEvent.startsAt (below)
// is 2026-08-10T09:00:00Z, 14:30 IST, app-day 2026-08-10; this pair is
// 2026-08-11, a full app-day later. movedStartsAt above does NOT exercise
// this: 09:00Z and 11:00Z on the 10th both fall on the same IST day, so a
// test built only from that pair cannot tell toDateInputValue(candidate.
// startsAt) apart from toDateInputValue(existing.startsAt) — a mutant
// swapping one for the other would still pass. This pair can.
const crossDayMovedStartsAt = new Date("2026-08-11T09:00:00.000Z"); // 14:30 IST, Aug 11
const crossDayMovedEndsAt = new Date("2026-08-11T10:00:00.000Z"); // 15:30 IST, Aug 11

const existingEvent = {
  id: "event1",
  title: "Verity kickoff call",
  description: "Notes" as string | null,
  startsAt,
  endsAt,
  allDay: false,
  projectId: null as string | null,
  clientId: null as string | null,
  creatorId: "creator1",
};

const baseUpdateInput = {
  eventId: "event1",
  title: "Verity kickoff call",
  description: "Notes" as string | null,
  startsAt,
  endsAt,
  allDay: false,
  projectId: null as string | null,
  clientId: null as string | null,
  attendeeIds: [] as string[],
  actorId: "creator1",
  isAdmin: false,
};

describe("updateCalendarEvent", () => {
  it("errors on an unknown event", async () => {
    const { db } = fakeDb({});
    expect(await updateCalendarEvent(db, { ...baseUpdateInput })).toEqual({
      ok: false,
      error: "Event not found",
    });
  });

  it("rejects a blank title", async () => {
    const { db } = fakeDb({ event: existingEvent });
    expect(await updateCalendarEvent(db, { ...baseUpdateInput, title: "   " })).toEqual({
      ok: false,
      error: "Give the event a title",
    });
  });

  // D10: creator or admin, the announcement-service.ts:82 check, applied to
  // the other studio-wide writable object — a member editing someone else's
  // event must be told plainly, with nothing written under them.
  it("a non-creator non-admin update is refused, with nothing written", async () => {
    const { db, dbW, txW } = fakeDb({ event: existingEvent });
    const result = await updateCalendarEvent(db, {
      ...baseUpdateInput,
      actorId: "someone-else",
      isAdmin: false,
      title: "Renamed",
    });
    expect(result).toEqual({ ok: false, error: "You can only edit events you created" });
    expect(txW.updated).toHaveLength(0);
    expect(txW.activity).toHaveLength(0);
    expect(dbW.updated).toHaveLength(0);
  });

  it("an admin who is not the creator may still update", async () => {
    const { db, txW } = fakeDb({ event: existingEvent });
    const result = await updateCalendarEvent(db, {
      ...baseUpdateInput,
      actorId: "someone-else",
      isAdmin: true,
      title: "Renamed",
    });
    expect(result.ok).toBe(true);
    expect(txW.updated[0]).toMatchObject({ title: "Renamed" });
  });

  // fieldDiff's normalize compares dates BY VALUE (activity.ts:97), so
  // re-submitting the identical instants and the identical attendee set logs
  // nothing and rings nothing — this is the case a naive "always write" or an
  // object-identity comparison would get wrong. startsAt/endsAt are rebuilt
  // as NEW Date objects with the same getTime() here rather than reusing the
  // shared `startsAt`/`endsAt` consts (which baseUpdateInput and
  // existingEvent both already point at, the same reference either way) —
  // otherwise this test would pass under a normalize that compared by
  // reference too, and prove nothing about value comparison at all.
  it("writes nothing at all when nothing changed, including an unchanged attendee set", async () => {
    const { db, dbW, txW } = fakeDb({
      event: existingEvent,
      currentAttendees: [{ userId: "u2", user: { name: "Riley" } }],
    });
    const result = await updateCalendarEvent(db, {
      ...baseUpdateInput,
      startsAt: new Date(startsAt.getTime()),
      endsAt: new Date(endsAt.getTime()),
      attendeeIds: ["u2"],
    });
    expect(result).toEqual({ ok: true, data: undefined });
    expect(txW.updated).toHaveLength(0);
    expect(txW.attendeesCreated).toHaveLength(0);
    expect(txW.attendeesDeleted).toHaveLength(0);
    expect(txW.activity).toHaveLength(0);
    expect(txW.notifications).toHaveLength(0);
    expect(dbW.updated).toHaveLength(0);
  });

  it("writes only the changed fields, and logs event.updated with meta: { name: title }", async () => {
    const { db, txW } = fakeDb({ event: existingEvent });
    await updateCalendarEvent(db, { ...baseUpdateInput, title: "Verity kickoff — rescheduled" });
    expect(txW.updated[0]).toEqual({ title: "Verity kickoff — rescheduled" });
    expect(txW.activity).toHaveLength(1);
    expect(txW.activity[0]).toMatchObject({ action: "event.updated", entityType: "CALENDAR_EVENT" });
    expect(txW.activity[0].meta).toEqual({ name: "Verity kickoff — rescheduled" });
  });

  it("a title-only edit writes no notification", async () => {
    const { db, txW } = fakeDb({
      event: existingEvent,
      currentAttendees: [{ userId: "u2", user: { name: "Riley" } }],
    });
    await updateCalendarEvent(db, {
      ...baseUpdateInput,
      title: "Renamed",
      attendeeIds: ["u2"],
    });
    expect(txW.notifications).toEqual([]);
  });

  it("a description-only edit writes no notification", async () => {
    const { db, txW } = fakeDb({ event: existingEvent });
    await updateCalendarEvent(db, { ...baseUpdateInput, description: "New notes" });
    expect(txW.notifications).toEqual([]);
  });

  it("an attendee-only change writes no notification", async () => {
    const { db, txW } = fakeDb({
      event: existingEvent,
      currentAttendees: [],
      activeUsers: [{ id: "u2", name: "Riley" }],
    });
    await updateCalendarEvent(db, { ...baseUpdateInput, attendeeIds: ["u2"] });
    expect(txW.notifications).toEqual([]);
  });

  // "Exactly one activity row per call" (spec §8:368) is read here as an
  // unconditional property of the function, not one scoped to field changes
  // only: this model has no task.assigned/unassigned twin (unlike Task), so
  // an attendee-only save still needs exactly one row to fold into, or the
  // change would be invisible to the feed entirely.
  it("an attendee-only change still logs exactly one event.updated row", async () => {
    const { db, txW } = fakeDb({
      event: existingEvent,
      currentAttendees: [],
      activeUsers: [{ id: "u2", name: "Riley" }],
    });
    await updateCalendarEvent(db, { ...baseUpdateInput, attendeeIds: ["u2"] });
    expect(txW.activity).toHaveLength(1);
    expect(txW.activity[0]).toMatchObject({ action: "event.updated" });
  });

  it("moving startsAt notifies every current attendee, carrying movedFrom and the new day", async () => {
    const { db, dbW, txW } = fakeDb({
      event: existingEvent,
      currentAttendees: [
        { userId: "u2", user: { name: "Riley" } },
        { userId: "u3", user: { name: "Sam" } },
      ],
    });
    const result = await updateCalendarEvent(db, {
      ...baseUpdateInput,
      startsAt: movedStartsAt,
      endsAt: movedEndsAt,
      attendeeIds: ["u2", "u3"],
    });
    expect(result).toEqual({ ok: true, data: undefined });
    expect(txW.notifications.map((n) => n.recipientId)).toEqual(["u2", "u3"]);
    for (const n of txW.notifications) {
      expect(n).toMatchObject({ type: "EVENT_SCHEDULED", entityId: "event1" });
      expect(n.meta).toEqual({
        name: "Verity kickoff call",
        when: eventTimeLabel({ startsAt: movedStartsAt, endsAt: movedEndsAt, allDay: false }),
        movedFrom: eventTimeLabel({ startsAt, endsAt, allDay: false }),
        date: toDateInputValue(movedStartsAt),
      });
    }
    expect(dbW.notifications).toEqual([]);
  });

  // Discriminates candidate.startsAt from existing.startsAt at the call site:
  // startsAt and movedStartsAt above share an app-day, so meta.date would
  // read correctly even if the wrong instant were formatted. This pair does
  // not share one, so the assertion can only pass against the NEW day.
  it("meta.date is the NEW day when the move crosses an app-day boundary, not the old one", async () => {
    const { db, txW } = fakeDb({
      event: existingEvent,
      currentAttendees: [{ userId: "u2", user: { name: "Riley" } }],
    });
    const oldDay = toDateInputValue(existingEvent.startsAt);
    const newDay = toDateInputValue(crossDayMovedStartsAt);
    expect(newDay).not.toBe(oldDay);

    await updateCalendarEvent(db, {
      ...baseUpdateInput,
      startsAt: crossDayMovedStartsAt,
      endsAt: crossDayMovedEndsAt,
      attendeeIds: ["u2"],
    });
    expect(txW.notifications[0].meta).toMatchObject({ date: newDay });
  });

  it("moving endsAt alone (start unchanged) still fires the notification", async () => {
    const { db, txW } = fakeDb({
      event: existingEvent,
      currentAttendees: [{ userId: "u2", user: { name: "Riley" } }],
    });
    await updateCalendarEvent(db, { ...baseUpdateInput, endsAt: movedEndsAt, attendeeIds: ["u2"] });
    expect(txW.notifications).toHaveLength(1);
  });

  it("toggling allDay alone still fires the notification", async () => {
    const { db, txW } = fakeDb({
      event: existingEvent,
      currentAttendees: [{ userId: "u2", user: { name: "Riley" } }],
    });
    await updateCalendarEvent(db, { ...baseUpdateInput, allDay: true, attendeeIds: ["u2"] });
    expect(txW.notifications).toHaveLength(1);
    expect(txW.notifications[0].meta).toMatchObject({ when: "All day" });
  });

  // Recipients are the attendees AFTER the diff: u1 is dropped from this
  // update and must not be told the meeting moved out from under it, while
  // u3, newly added in the same call, is told.
  it("notifies the attendees after the diff, not the ones before it", async () => {
    const { db, txW } = fakeDb({
      event: existingEvent,
      currentAttendees: [
        { userId: "u1", user: { name: "Alex" } },
        { userId: "u2", user: { name: "Riley" } },
      ],
      activeUsers: [{ id: "u3", name: "Sam" }],
    });
    await updateCalendarEvent(db, {
      ...baseUpdateInput,
      startsAt: movedStartsAt,
      endsAt: movedEndsAt,
      attendeeIds: ["u2", "u3"],
    });
    expect(txW.notifications.map((n) => n.recipientId).sort()).toEqual(["u2", "u3"]);
  });

  it("resolves and stores the project's clientId when moving into a project", async () => {
    const { db, txW } = fakeDb({ event: existingEvent, project: project1 });
    const result = await updateCalendarEvent(db, { ...baseUpdateInput, projectId: "p1" });
    expect(result.ok).toBe(true);
    expect(txW.updated[0]).toMatchObject({ projectId: "p1", clientId: "c1" });
  });

  it("errors on an unknown project, with nothing written", async () => {
    const { db, dbW, txW } = fakeDb({ event: existingEvent });
    const result = await updateCalendarEvent(db, { ...baseUpdateInput, projectId: "ghost" });
    expect(result).toEqual({ ok: false, error: "Project not found" });
    expect(txW.updated).toHaveLength(0);
    expect(dbW.updated).toHaveLength(0);
  });

  it("issues no project lookup when the project is unchanged", async () => {
    const { db, calls, txW } = fakeDb({
      event: { ...existingEvent, projectId: "p1", clientId: "c1" },
    });
    await updateCalendarEvent(db, { ...baseUpdateInput, projectId: "p1", title: "Renamed" });
    expect(calls.projectFindUnique).toBe(0);
    // clientId never moved, so it must not appear in the write at all.
    expect(txW.updated[0]).toEqual({ title: "Renamed" });
  });

  it("only the newly added attendee id is validated; an unknown or deactivated new id is rejected with nothing written", async () => {
    const { db, dbW, txW } = fakeDb({
      event: existingEvent,
      currentAttendees: [{ userId: "u2", user: { name: "Riley" } }],
      activeUsers: [],
    });
    const result = await updateCalendarEvent(db, { ...baseUpdateInput, attendeeIds: ["u2", "ghost"] });
    expect(result).toEqual({ ok: false, error: "Invalid input" });
    expect(txW.updated).toHaveLength(0);
    expect(txW.attendeesCreated).toHaveLength(0);
    expect(txW.attendeesDeleted).toHaveLength(0);
    expect(dbW.updated).toHaveLength(0);
  });

  // Not "reads the removed attendee's name off rows already loaded" — this
  // model logs no people list for a removal at all (see the comment above
  // `current` in calendar-event-service.ts), so there is no name to read.
  // What's actually true, and what this pins: a removal needs no
  // re-validation and triggers no active-user lookup, full stop.
  it("removing an attendee needs no re-validation and issues no active-user lookup", async () => {
    const { db, calls, txW } = fakeDb({
      event: existingEvent,
      currentAttendees: [{ userId: "u2", user: { name: "Riley" } }],
    });
    await updateCalendarEvent(db, { ...baseUpdateInput, attendeeIds: [] });
    expect(txW.attendeesDeleted[0].where).toEqual({ eventId: "event1", userId: { in: ["u2"] } });
    // No addedIds at all, so resolveAttendees (and its user.findMany) never runs.
    expect(calls.userFindMany).toBe(0);
  });

  it("creates and deletes only the delta, never a blanket rewrite of the attendee set", async () => {
    const { db, txW } = fakeDb({
      event: existingEvent,
      currentAttendees: [
        { userId: "u1", user: { name: "Alex" } },
        { userId: "u2", user: { name: "Riley" } },
      ],
      activeUsers: [{ id: "u3", name: "Sam" }],
    });
    await updateCalendarEvent(db, { ...baseUpdateInput, attendeeIds: ["u2", "u3"] });
    expect(txW.attendeesDeleted[0].where).toEqual({ eventId: "event1", userId: { in: ["u1"] } });
    expect(txW.attendeesCreated[0].data).toEqual([{ eventId: "event1", userId: "u3" }]);
  });

  it("maps a concurrently-deleted row to the not-found error rather than throwing", async () => {
    const race = new Prisma.PrismaClientKnownRequestError("Record to update does not exist.", {
      code: "P2025",
      clientVersion: "test",
    });
    const { db } = fakeDb({ event: existingEvent, eventUpdateError: race });
    const result = await updateCalendarEvent(db, { ...baseUpdateInput, title: "Renamed" });
    expect(result).toEqual({ ok: false, error: "Event not found" });
  });

  it("the row, the attendee rows, the activity row and the notification rows all land on tx and never on the outer db", async () => {
    const { db, dbW, txW } = fakeDb({
      event: existingEvent,
      currentAttendees: [],
      activeUsers: [{ id: "u2", name: "Riley" }],
    });
    await updateCalendarEvent(db, {
      ...baseUpdateInput,
      startsAt: movedStartsAt,
      endsAt: movedEndsAt,
      attendeeIds: ["u2"],
    });
    expect(dbW.updated).toHaveLength(0);
    expect(dbW.attendeesCreated).toHaveLength(0);
    expect(dbW.activity).toHaveLength(0);
    expect(dbW.notifications).toHaveLength(0);
    expect(txW.updated.length + txW.attendeesCreated.length + txW.activity.length + txW.notifications.length).toBeGreaterThan(0);
  });
});

const baseRemoveInput = { eventId: "event1", actorId: "creator1", isAdmin: false };

describe("removeCalendarEvent", () => {
  it("errors on an unknown event", async () => {
    const { db } = fakeDb({});
    expect(await removeCalendarEvent(db, { ...baseRemoveInput })).toEqual({
      ok: false,
      error: "Event not found",
    });
  });

  it("a non-creator non-admin remove is refused, with nothing written", async () => {
    const { db, dbW, txW } = fakeDb({ event: existingEvent });
    const result = await removeCalendarEvent(db, { ...baseRemoveInput, actorId: "someone-else" });
    expect(result).toEqual({ ok: false, error: "You can only edit events you created" });
    expect(txW.deleted).toHaveLength(0);
    expect(txW.notificationsCleared).toHaveLength(0);
    expect(txW.activity).toHaveLength(0);
    expect(dbW.deleted).toHaveLength(0);
  });

  it("an admin who is not the creator may still remove", async () => {
    const { db, txW } = fakeDb({ event: existingEvent });
    const result = await removeCalendarEvent(db, {
      ...baseRemoveInput,
      actorId: "someone-else",
      isAdmin: true,
    });
    expect(result).toEqual({ ok: true, data: undefined });
    expect(txW.deleted).toHaveLength(1);
  });

  // entityId carries no foreign key, so nothing cascades to it (the same
  // reason removeTask clears its own, task-service.ts:330) — and unlike
  // notifications, the activity log is never cleared; this row is a NEW one,
  // added rather than any prior row being deleted.
  it("deletes the event, clears its notifications and logs event.removed with the title captured before deletion — all inside tx, none on db", async () => {
    const { db, dbW, txW } = fakeDb({ event: existingEvent });
    const result = await removeCalendarEvent(db, { ...baseRemoveInput });
    expect(result).toEqual({ ok: true, data: undefined });
    expect(txW.deleted).toHaveLength(1);
    expect(txW.notificationsCleared).toEqual([{ where: { entityType: "CALENDAR_EVENT", entityId: "event1" } }]);
    expect(txW.activity).toHaveLength(1);
    expect(txW.activity[0]).toMatchObject({ action: "event.removed", entityType: "CALENDAR_EVENT" });
    expect(txW.activity[0].meta).toEqual({ name: "Verity kickoff call" });
    expect(dbW.deleted).toHaveLength(0);
    expect(dbW.notificationsCleared).toHaveLength(0);
    expect(dbW.activity).toHaveLength(0);
  });

  it("maps a concurrently-deleted row to the not-found error rather than throwing, rolling back the rest", async () => {
    const race = new Prisma.PrismaClientKnownRequestError("Record to delete does not exist.", {
      code: "P2025",
      clientVersion: "test",
    });
    const { db, txW } = fakeDb({ event: existingEvent, eventDeleteError: race });
    const result = await removeCalendarEvent(db, { ...baseRemoveInput });
    expect(result).toEqual({ ok: false, error: "Event not found" });
    expect(txW.notificationsCleared).toEqual([]);
    expect(txW.activity).toEqual([]);
  });
});
