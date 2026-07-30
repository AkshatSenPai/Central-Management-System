import { describe, it, expect } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { setMemberActive, setMemberRole } from "@/lib/member-service";

type FakeParts = {
  target?: unknown;
  activeAdminCount?: number;
  /** Count returned by tx.user.count() inside $transaction — lets a test
   * simulate a concurrent request that already changed the active-admin
   * count between the pre-check and the transactional write. Defaults to
   * activeAdminCount when unset. */
  postUpdateActiveAdminCount?: number;
};

function fakeDb(parts: FakeParts) {
  const updates: Record<string, unknown>[] = [];
  const findUnique = async () => parts.target ?? null;
  const update = async (args: { data: Record<string, unknown> }) => {
    updates.push(args.data);
    return args.data;
  };
  const db = {
    user: {
      findUnique,
      update,
      count: async () => parts.activeAdminCount ?? 1,
    },
    $transaction: async (fn: (tx: unknown) => Promise<void>) => {
      const tx = {
        user: {
          findUnique,
          update,
          count: async () => parts.postUpdateActiveAdminCount ?? parts.activeAdminCount ?? 1,
        },
      };
      return fn(tx);
    },
  } as unknown as PrismaClient;
  return { db, updates };
}

const member = { id: "m1", role: "MEMBER", active: true };
const admin = { id: "a1", role: "ADMIN", active: true };

describe("setMemberActive", () => {
  it("blocks deactivating yourself", async () => {
    const { db } = fakeDb({ target: admin });
    const result = await setMemberActive(db, { targetId: "a1", active: false, actorId: "a1" });
    expect(result).toEqual({ ok: false, error: "You cannot deactivate your own account" });
  });

  it("blocks deactivating the last active admin", async () => {
    const { db } = fakeDb({ target: admin, activeAdminCount: 1 });
    const result = await setMemberActive(db, { targetId: "a1", active: false, actorId: "x" });
    expect(result).toEqual({ ok: false, error: "Cannot deactivate the last active admin" });
  });

  it("deactivates a regular member", async () => {
    const { db, updates } = fakeDb({ target: member });
    const result = await setMemberActive(db, { targetId: "m1", active: false, actorId: "a1" });
    expect(result.ok).toBe(true);
    expect(updates[0]).toEqual({ active: false });
  });

  it("reactivates a deactivated member", async () => {
    const { db, updates } = fakeDb({ target: { ...member, active: false } });
    const result = await setMemberActive(db, { targetId: "m1", active: true, actorId: "a1" });
    expect(result.ok).toBe(true);
    expect(updates[0]).toEqual({ active: true });
  });

  it("errors on unknown member", async () => {
    const { db } = fakeDb({});
    const result = await setMemberActive(db, { targetId: "ghost", active: false, actorId: "a1" });
    expect(result).toEqual({ ok: false, error: "Member not found" });
  });

  it("returns a friendly error when a concurrent deactivation already zeroed active admins", async () => {
    const { db } = fakeDb({ target: admin, activeAdminCount: 2, postUpdateActiveAdminCount: 0 });
    const result = await setMemberActive(db, { targetId: "a1", active: false, actorId: "x" });
    expect(result).toEqual({ ok: false, error: "Cannot deactivate the last active admin" });
  });

  it("deactivates an admin when the post-update recount still shows an active admin", async () => {
    const { db, updates } = fakeDb({ target: admin, activeAdminCount: 2, postUpdateActiveAdminCount: 1 });
    const result = await setMemberActive(db, { targetId: "a1", active: false, actorId: "x" });
    expect(result.ok).toBe(true);
    expect(updates[0]).toEqual({ active: false });
  });
});

describe("setMemberRole", () => {
  it("blocks demoting the last active admin", async () => {
    const { db } = fakeDb({ target: admin, activeAdminCount: 1 });
    const result = await setMemberRole(db, { targetId: "a1", role: "MEMBER" });
    expect(result).toEqual({ ok: false, error: "Cannot demote the last active admin" });
  });

  it("promotes a member to admin", async () => {
    const { db, updates } = fakeDb({ target: member });
    const result = await setMemberRole(db, { targetId: "m1", role: "ADMIN" });
    expect(result.ok).toBe(true);
    expect(updates[0]).toEqual({ role: "ADMIN" });
  });

  it("demotes an admin when another active admin exists", async () => {
    const { db, updates } = fakeDb({ target: admin, activeAdminCount: 2 });
    const result = await setMemberRole(db, { targetId: "a1", role: "MEMBER" });
    expect(result.ok).toBe(true);
    expect(updates[0]).toEqual({ role: "MEMBER" });
  });

  it("returns a friendly error when a concurrent demotion already zeroed active admins", async () => {
    const { db } = fakeDb({ target: admin, activeAdminCount: 2, postUpdateActiveAdminCount: 0 });
    const result = await setMemberRole(db, { targetId: "a1", role: "MEMBER" });
    expect(result).toEqual({ ok: false, error: "Cannot demote the last active admin" });
  });

  it("demotes successfully when the post-update recount still shows an active admin", async () => {
    const { db, updates } = fakeDb({ target: admin, activeAdminCount: 2, postUpdateActiveAdminCount: 1 });
    const result = await setMemberRole(db, { targetId: "a1", role: "MEMBER" });
    expect(result.ok).toBe(true);
    expect(updates[0]).toEqual({ role: "MEMBER" });
  });
});
