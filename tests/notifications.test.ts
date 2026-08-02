import { describe, it, expect } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { notify, clearNotificationsFor } from "@/lib/notification-service";
import {
  describeNotification,
  notificationHref,
  notificationIcon,
  unreadBadge,
} from "@/lib/notifications";

/** Captures what notify() hands to createMany, in the shape Prisma would get. */
function fakeDb() {
  const created: Record<string, unknown>[] = [];
  const deleted: unknown[] = [];
  const db = {
    notification: {
      createMany: async (a: { data: Record<string, unknown>[] }) => {
        created.push(...a.data);
        return { count: a.data.length };
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
});

describe("notificationHref", () => {
  it("points a task notification at the task", () => {
    expect(notificationHref({ entityType: "TASK", entityId: "t1" })).toBe("/tasks/t1");
  });

  it("falls back rather than building a broken URL", () => {
    expect(notificationHref({ entityType: "MYSTERY", entityId: "x" })).toBe("/dashboard");
  });
});

describe("notificationIcon", () => {
  it("gives each type its own glyph", () => {
    expect(notificationIcon("COMMENT_MENTION")).toBe("alternate_email");
    expect(notificationIcon("TASK_DUE_SOON")).toBe("event");
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
