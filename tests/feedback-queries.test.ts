import { describe, it, expect } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { listFeedback, countOpenFeedback } from "@/lib/feedback-queries";

type Row = {
  id: string;
  kind: string;
  body: string;
  status: string;
  authorId: string;
  author: { name: string };
  resolvedBy: { name: string } | null;
  resolvedAt: Date | null;
  createdAt: Date;
};

function fakeDb(rows: Row[] = []) {
  const findManyArgs: unknown[] = [];
  const db = {
    feedback: {
      findMany: async (args: unknown) => {
        findManyArgs.push(args);
        return rows;
      },
    },
  } as unknown as PrismaClient;
  return { db, findManyArgs };
}

function row(overrides: Partial<Row> = {}): Row {
  return {
    id: "f1",
    kind: "SUGGESTION",
    body: "Quick Add could remember the last project.",
    status: "NEW",
    authorId: "u1",
    author: { name: "Dana Reeve" },
    resolvedBy: null,
    resolvedAt: null,
    createdAt: new Date("2026-08-06T00:00:00.000Z"),
    ...overrides,
  };
}

describe("listFeedback", () => {
  // The whole security property of this feature. Asserted on the entire where
  // clause rather than just the authorId fragment: checking the fragment alone
  // would still pass if a later edit widened the query, because the fake
  // returns whatever it is given regardless.
  it("scopes a member to their own submissions", async () => {
    const { db, findManyArgs } = fakeDb([row()]);
    await listFeedback(db, { viewerId: "u1", isAdmin: false });
    expect((findManyArgs[0] as { where: unknown }).where).toEqual({ authorId: "u1" });
  });

  it("gives an admin an unscoped query", async () => {
    const { db, findManyArgs } = fakeDb([row()]);
    await listFeedback(db, { viewerId: "admin1", isAdmin: true });
    expect((findManyArgs[0] as { where: unknown }).where).toEqual({});
  });

  // A member filtering by status must stay scoped: dropping authorId while
  // adding status would silently turn their view into the whole studio's.
  it("keeps the author scope when a member also filters by status", async () => {
    const { db, findManyArgs } = fakeDb([row()]);
    await listFeedback(db, { viewerId: "u1", isAdmin: false, status: "DONE" });
    expect((findManyArgs[0] as { where: unknown }).where).toEqual({
      authorId: "u1",
      status: "DONE",
    });
  });

  it("treats ALL and no filter alike, adding no status constraint", async () => {
    const all = fakeDb([row()]);
    await listFeedback(all.db, { viewerId: "a", isAdmin: true, status: "ALL" });
    expect((all.findManyArgs[0] as { where: Record<string, unknown> }).where).not.toHaveProperty(
      "status"
    );

    const none = fakeDb([row()]);
    await listFeedback(none.db, { viewerId: "a", isAdmin: true, status: null });
    expect((none.findManyArgs[0] as { where: Record<string, unknown> }).where).not.toHaveProperty(
      "status"
    );
  });

  it("maps the author's name and initials onto each row", async () => {
    const { db } = fakeDb([row()]);
    const rows = await listFeedback(db, { viewerId: "u1", isAdmin: false });
    expect(rows[0]).toMatchObject({
      id: "f1",
      authorName: "Dana Reeve",
      authorInitials: "DR",
      resolvedByName: null,
    });
  });

  it("carries the resolver's name when one is set", async () => {
    const resolvedAt = new Date("2026-08-07T00:00:00.000Z");
    const { db } = fakeDb([
      row({ status: "DONE", resolvedBy: { name: "Omar Silva" }, resolvedAt }),
    ]);
    const rows = await listFeedback(db, { viewerId: "a", isAdmin: true });
    expect(rows[0].resolvedByName).toBe("Omar Silva");
    expect(rows[0].resolvedAt).toEqual(resolvedAt);
  });

  it("returns untriaged rows first, whatever order the database gave them", async () => {
    const { db } = fakeDb([
      row({ id: "done", status: "DONE", createdAt: new Date("2026-08-07T00:00:00.000Z") }),
      row({ id: "new", status: "NEW", createdAt: new Date("2026-01-01T00:00:00.000Z") }),
    ]);
    const rows = await listFeedback(db, { viewerId: "a", isAdmin: true });
    expect(rows.map((r) => r.id)).toEqual(["new", "done"]);
  });

  it("issues exactly one db call", async () => {
    const { db, findManyArgs } = fakeDb([row(), row({ id: "f2" })]);
    await listFeedback(db, { viewerId: "a", isAdmin: true });
    expect(findManyArgs).toHaveLength(1);
  });
});

describe("countOpenFeedback", () => {
  it("counts NEW, ACKNOWLEDGED and PLANNED but not DONE or DECLINED", () => {
    expect(
      countOpenFeedback([
        { status: "NEW" },
        { status: "ACKNOWLEDGED" },
        { status: "PLANNED" },
        { status: "DONE" },
        { status: "DECLINED" },
      ])
    ).toBe(3);
  });

  it("is zero for an empty list", () => {
    expect(countOpenFeedback([])).toBe(0);
  });
});
