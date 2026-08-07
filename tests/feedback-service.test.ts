import { describe, it, expect } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { addFeedback, setFeedbackStatus, removeFeedback } from "@/lib/feedback-service";

type FakeParts = { existing?: { authorId: string; kind: string } | null };

/** The canonical fake: one shared set of closures behind both the top-level
 * delegates and the transaction client, so a write is captured whether the
 * service used `db` or `tx`. */
function fakeDb(parts: FakeParts = {}) {
  const created: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  const deletes: unknown[] = [];
  const activity: Record<string, unknown>[] = [];

  const feedbackDelegate = {
    findUnique: async () => ("existing" in parts ? parts.existing : null),
    create: async (args: { data: Record<string, unknown> }) => {
      created.push(args.data);
      return { id: "f1", ...args.data };
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
    feedback: feedbackDelegate,
    activityLog: { create: logCreate },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ feedback: feedbackDelegate, activityLog: { create: logCreate } }),
  } as unknown as PrismaClient;

  return { db, created, updates, deletes, activity };
}

describe("addFeedback", () => {
  it("stores a valid submission against its author and returns the id", async () => {
    const { db, created } = fakeDb();
    const result = await addFeedback(db, {
      kind: "PROBLEM",
      body: "The board drags oddly.",
      actorId: "u1",
    });
    expect(result.ok).toBe(true);
    expect(created[0]).toMatchObject({
      authorId: "u1",
      kind: "PROBLEM",
      body: "The board drags oddly.",
    });
  });

  it("refuses an empty body and writes nothing", async () => {
    const { db, created, activity } = fakeDb();
    const result = await addFeedback(db, { kind: "SUGGESTION", body: "   ", actorId: "u1" });
    expect(result.ok).toBe(false);
    expect(created).toHaveLength(0);
    expect(activity).toHaveLength(0);
  });

  it("refuses a kind outside the enum, so an invalid value never reaches the column", async () => {
    const { db, created } = fakeDb();
    const result = await addFeedback(db, { kind: "RANT", body: "hi", actorId: "u1" });
    expect(result.ok).toBe(false);
    expect(created).toHaveLength(0);
  });

  it("records activity with no client scope", async () => {
    const { db, activity } = fakeDb();
    await addFeedback(db, { kind: "PRAISE", body: "nice", actorId: "u1" });
    expect(activity[0]).toMatchObject({
      actorId: "u1",
      entityType: "FEEDBACK",
      action: "feedback.submitted",
      clientId: null,
    });
  });

  // The body is deliberately absent from meta: the activity timeline has no
  // author-or-admin scoping, so quoting it there would publish to every reader
  // what the feedback list itself withholds.
  it("does not copy the body into the activity meta", async () => {
    const { db, activity } = fakeDb();
    await addFeedback(db, { kind: "PROBLEM", body: "a secret gripe", actorId: "u1" });
    expect(JSON.stringify(activity[0])).not.toContain("secret gripe");
  });
});

describe("setFeedbackStatus", () => {
  // Refused at the service, not merely hidden in the UI — the same rule the
  // password reset follows. A control that is only hidden is not a control.
  it("refuses a non-admin and writes nothing", async () => {
    const { db, updates, activity } = fakeDb();
    const result = await setFeedbackStatus(db, {
      feedbackId: "f1",
      status: "DONE",
      actorId: "u2",
      isAdmin: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Only an admin can triage feedback");
    expect(updates).toHaveLength(0);
    expect(activity).toHaveLength(0);
  });

  it("stamps who resolved it and when, when moving out of NEW", async () => {
    const { db, updates } = fakeDb();
    const result = await setFeedbackStatus(db, {
      feedbackId: "f1",
      status: "ACKNOWLEDGED",
      actorId: "admin1",
      isAdmin: true,
    });
    expect(result.ok).toBe(true);
    expect(updates[0]).toMatchObject({ status: "ACKNOWLEDGED", resolvedById: "admin1" });
    expect(updates[0].resolvedAt).toBeInstanceOf(Date);
  });

  // Without this branch, moving a row back to NEW leaves a name against
  // something nobody has looked at again, and the page's "Acknowledged by X"
  // line contradicts the status beside it.
  it("clears the resolver when moving back to NEW", async () => {
    const { db, updates } = fakeDb();
    await setFeedbackStatus(db, {
      feedbackId: "f1",
      status: "NEW",
      actorId: "admin1",
      isAdmin: true,
    });
    expect(updates[0]).toMatchObject({ status: "NEW", resolvedById: null, resolvedAt: null });
  });

  it("stamps the resolver for DECLINED too — declining is an answer", async () => {
    const { db, updates } = fakeDb();
    await setFeedbackStatus(db, {
      feedbackId: "f1",
      status: "DECLINED",
      actorId: "admin1",
      isAdmin: true,
    });
    expect(updates[0]).toMatchObject({ status: "DECLINED", resolvedById: "admin1" });
  });

  it("records the new status in activity", async () => {
    const { db, activity } = fakeDb();
    await setFeedbackStatus(db, {
      feedbackId: "f1",
      status: "PLANNED",
      actorId: "admin1",
      isAdmin: true,
    });
    expect(activity[0]).toMatchObject({
      entityType: "FEEDBACK",
      action: "feedback.triaged",
      clientId: null,
      meta: { status: "PLANNED" },
    });
  });
});

describe("removeFeedback", () => {
  it("lets an author delete their own", async () => {
    const { db, deletes } = fakeDb({ existing: { authorId: "u1", kind: "SUGGESTION" } });
    const result = await removeFeedback(db, { feedbackId: "f1", actorId: "u1", isAdmin: false });
    expect(result.ok).toBe(true);
    expect(deletes).toHaveLength(1);
  });

  it("lets an admin delete somebody else's", async () => {
    const { db, deletes } = fakeDb({ existing: { authorId: "u1", kind: "SUGGESTION" } });
    const result = await removeFeedback(db, { feedbackId: "f1", actorId: "admin1", isAdmin: true });
    expect(result.ok).toBe(true);
    expect(deletes).toHaveLength(1);
  });

  it("refuses a different member and deletes nothing", async () => {
    const { db, deletes } = fakeDb({ existing: { authorId: "u1", kind: "SUGGESTION" } });
    const result = await removeFeedback(db, { feedbackId: "f1", actorId: "u2", isAdmin: false });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("You can only delete your own feedback");
    expect(deletes).toHaveLength(0);
  });

  it("reports a missing row rather than throwing", async () => {
    const { db } = fakeDb({ existing: null });
    const result = await removeFeedback(db, { feedbackId: "gone", actorId: "u1", isAdmin: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Feedback not found");
  });
});
