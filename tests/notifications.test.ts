import { describe, it, expect } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { notify, clearNotificationsFor } from "@/lib/notification-service";
import {
  describeNotification,
  notificationHref,
  notificationIcon,
  unreadBadge,
} from "@/lib/notifications";

/** Captures what notify() hands to createManyAndReturn, in the shape Prisma
 * would get, and hands back ids the way the real client does — push depends on
 * those ids, so a fake that returned nothing would hide a broken fan-out. */
function fakeDb(parts: { deactivated?: string[] } = {}) {
  const created: Record<string, unknown>[] = [];
  const deleted: unknown[] = [];
  const gone = new Set(parts.deactivated ?? []);
  const db = {
    // notify() drops deactivated recipients, so it reads the user table. The
    // fake honours `active: true` rather than returning everything, because a
    // fake that ignored the filter would pass whether or not the filter was
    // there — which is the whole thing under test.
    user: {
      findMany: async (a: { where: { id: { in: string[] } } }) =>
        a.where.id.in.filter((id) => !gone.has(id)).map((id) => ({ id })),
    },
    notification: {
      createManyAndReturn: async (a: { data: Record<string, unknown>[] }) => {
        created.push(...a.data);
        return a.data.map((_, i) => ({ id: `n${created.length - a.data.length + i + 1}` }));
      },
      deleteMany: async (a: unknown) => {
        deleted.push(a);
        return { count: 0 };
      },
    },
  } as unknown as PrismaClient;
  return { db, created, deleted };
}

const base = {
  actorId: "actor",
  type: "TASK_ASSIGNED" as const,
  entityType: "TASK" as const,
  entityId: "t1",
};

describe("notify", () => {
  it("writes one row per recipient", async () => {
    const { db, created } = fakeDb();
    await notify(db, { ...base, recipientIds: ["a", "b"] });
    expect(created.map((r) => r.recipientId)).toEqual(["a", "b"]);
  });

  /** Someone who has left keeps the notifications they already had — the bell
   * is their history — but stops collecting new ones. Push subscriptions are
   * already deleted on deactivation, so the bell was the last channel still
   * reaching a deactivated account, quietly accumulating rows nobody would
   * ever open. */
  it("does not notify a deactivated member", async () => {
    const { db, created } = fakeDb({ deactivated: ["gone"] });
    await notify(db, { ...base, recipientIds: ["a", "gone", "b"] });
    expect(created.map((r) => r.recipientId)).toEqual(["a", "b"]);
  });

  it("writes nothing at all when every recipient has been deactivated", async () => {
    const { db, created } = fakeDb({ deactivated: ["a", "b"] });
    expect(await notify(db, { ...base, recipientIds: ["a", "b"] })).toEqual([]);
    expect(created).toHaveLength(0);
  });

  /** The rows must come back in the order the caller supplied, not the order
   * the user lookup happened to return them in. */
  it("keeps the caller's recipient order", async () => {
    const { db, created } = fakeDb({ deactivated: ["x"] });
    await notify(db, { ...base, recipientIds: ["c", "x", "a", "b"] });
    expect(created.map((r) => r.recipientId)).toEqual(["c", "a", "b"]);
  });

  // Assigning yourself a task must not light up your own bell. Enforced here
  // rather than at each call site, because the call site that forgot would be
  // the one nobody noticed.
  it("never notifies the actor", async () => {
    const { db, created } = fakeDb();
    await notify(db, { ...base, recipientIds: ["actor", "b"] });
    expect(created.map((r) => r.recipientId)).toEqual(["b"]);
  });

  it("deduplicates recipients", async () => {
    const { db, created } = fakeDb();
    await notify(db, { ...base, recipientIds: ["a", "a", "b", "a"] });
    expect(created.map((r) => r.recipientId)).toEqual(["a", "b"]);
  });

  // An empty createMany inside someone else's transaction is a pointless
  // round trip; assigning only yourself must issue no write at all.
  it("writes nothing when only the actor is left", async () => {
    const { db, created } = fakeDb();
    await notify(db, { ...base, recipientIds: ["actor"] });
    expect(created).toEqual([]);
  });

  it("writes nothing for an empty recipient list", async () => {
    const { db, created } = fakeDb();
    await notify(db, { ...base, recipientIds: [] });
    expect(created).toEqual([]);
  });

  // A system notification (TASK_DUE_SOON) has no actor, so nothing is
  // filtered out and the column is written null.
  it("keeps every recipient when there is no actor", async () => {
    const { db, created } = fakeDb();
    await notify(db, { ...base, actorId: null, type: "TASK_DUE_SOON", recipientIds: ["a", "b"] });
    expect(created).toHaveLength(2);
    expect(created[0].actorId).toBeNull();
  });

  it("carries the entity and meta through", async () => {
    const { db, created } = fakeDb();
    await notify(db, { ...base, recipientIds: ["a"], meta: { name: "Build the landing section" } });
    expect(created[0]).toMatchObject({
      entityType: "TASK",
      entityId: "t1",
      meta: { name: "Build the landing section" },
    });
  });
});

describe("clearNotificationsFor", () => {
  it("scopes the delete to the entity", async () => {
    const { db, deleted } = fakeDb();
    await clearNotificationsFor(db, { entityType: "TASK", entityId: "t9" });
    expect(deleted).toEqual([{ where: { entityType: "TASK", entityId: "t9" } }]);
  });
});

describe("describeNotification", () => {
  const meta = { name: "Build the landing section" };

  it("names the actor and the task for an assignment", () => {
    expect(describeNotification({ type: "TASK_ASSIGNED", actorName: "Dana", meta })).toBe(
      "Dana assigned you Build the landing section"
    );
  });

  it("reads as a mention", () => {
    expect(describeNotification({ type: "COMMENT_MENTION", actorName: "Dana", meta })).toBe(
      "Dana mentioned you on Build the landing section"
    );
  });

  it("humanises the status", () => {
    expect(
      describeNotification({
        type: "TASK_STATUS_CHANGED",
        actorName: "Dana",
        meta: { ...meta, to: "IN_PROGRESS" },
      })
    ).toBe("Dana moved Build the landing section to In Progress");
  });

  // No actor, and the sentence must not read "Someone" — a deadline arriving
  // is not something anybody did.
  it("omits an actor for a due-soon reminder", () => {
    expect(describeNotification({ type: "TASK_DUE_SOON", actorName: null, meta })).toBe(
      "Build the landing section is due soon"
    );
  });

  // Totality: a notification that throws takes the whole panel with it.
  it("renders rather than throwing on an unknown type", () => {
    expect(
      describeNotification({
        type: "SOMETHING_NEW" as never,
        actorName: "Dana",
        meta,
      })
    ).toBe("Dana updated Build the landing section");
  });

  it("survives absent meta and an absent actor", () => {
    expect(describeNotification({ type: "TASK_ASSIGNED", actorName: null, meta: null })).toBe(
      "Someone assigned you a task"
    );
  });

  it("ignores a non-string name rather than rendering an object", () => {
    expect(
      describeNotification({ type: "TASK_ASSIGNED", actorName: "Dana", meta: { name: { x: 1 } } })
    ).toBe("Dana assigned you a task");
  });

  it("describes a newly scheduled event", () => {
    expect(
      describeNotification({
        type: "EVENT_SCHEDULED",
        actorName: "Priya",
        meta: { name: "Team sync", when: "15:00 – 16:00" },
      })
    ).toBe("Priya scheduled Team sync — 15:00 – 16:00");
  });

  it("describes a moved event", () => {
    expect(
      describeNotification({
        type: "EVENT_SCHEDULED",
        actorName: "Priya",
        meta: { name: "Team sync", when: "15:00 – 16:00", movedFrom: "10:00 – 11:00" },
      })
    ).toBe("Priya moved Team sync to 15:00 – 16:00");
  });

  // The shared `what` binding a few lines up falls back to "a task" — a lie
  // for an event. This is the trap case: it must read "an event" and must
  // never leak "a task" into the vocabulary-locked surface (§13).
  it("falls back to \"an event\", never the shared \"a task\", when meta.name is missing", () => {
    const result = describeNotification({
      type: "EVENT_SCHEDULED",
      actorName: "Priya",
      meta: { when: "15:00 – 16:00" },
    });
    expect(result).toBe("Priya scheduled an event — 15:00 – 16:00");
    expect(result).not.toContain("a task");
  });
});

describe("notificationHref", () => {
  it("points a task notification at the task", () => {
    expect(notificationHref({ entityType: "TASK", entityId: "t1" })).toBe("/tasks/t1");
  });

  it("falls back rather than building a broken URL", () => {
    expect(notificationHref({ entityType: "MYSTERY", entityId: "x" })).toBe("/dashboard");
  });

  it("points a calendar event notification at its day", () => {
    expect(
      notificationHref({ entityType: "CALENDAR_EVENT", entityId: "e1", meta: { date: "2026-08-05" } })
    ).toBe("/calendar?view=day&date=2026-08-05");
  });

  it("falls back to /calendar when meta.date is missing", () => {
    expect(notificationHref({ entityType: "CALENDAR_EVENT", entityId: "e1", meta: null })).toBe(
      "/calendar"
    );
  });

  it("falls back to /calendar when meta.date is malformed", () => {
    expect(
      notificationHref({ entityType: "CALENDAR_EVENT", entityId: "e1", meta: { date: "not-a-date" } })
    ).toBe("/calendar");
  });
});

describe("notificationIcon", () => {
  it("gives each type its own glyph", () => {
    expect(notificationIcon("COMMENT_MENTION")).toBe("alternate_email");
    expect(notificationIcon("TASK_DUE_SOON")).toBe("event");
    expect(notificationIcon("EVENT_SCHEDULED")).toBe("event");
  });

  it("is total", () => {
    expect(notificationIcon("SOMETHING_NEW" as never)).toBe("check_circle");
  });
});

describe("unreadBadge", () => {
  it("hides at zero — an empty badge is worse than none", () => {
    expect(unreadBadge(0)).toBeNull();
    expect(unreadBadge(-1)).toBeNull();
  });

  it("shows the count", () => {
    expect(unreadBadge(7)).toBe("7");
    expect(unreadBadge(99)).toBe("99");
  });

  // Three digits do not fit a 16px circle, and "too many to count" is the
  // only information a larger number carries anyway.
  it("caps at 99+", () => {
    expect(unreadBadge(100)).toBe("99+");
    expect(unreadBadge(4210)).toBe("99+");
  });
});
