import { describe, it, expect } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { resetMemberPassword, setMemberActive, setMemberRole } from "@/lib/member-service";
import { verifyPassword } from "@/lib/password";

type FakeParts = {
  target?: unknown;
  activeAdminCount?: number;
  /** Count returned by tx.user.count() inside $transaction — lets a test
   * simulate a concurrent request that already changed the active-admin
   * count between the pre-check and the transactional write. Defaults to
   * activeAdminCount when unset. */
  postUpdateActiveAdminCount?: number;
  /** Error thrown by $transaction — lets a test simulate a serialization
   * conflict (P2034) or other transaction failure. */
  transactionError?: unknown;
};

function fakeDb(parts: FakeParts) {
  const updates: Record<string, unknown>[] = [];
  const transactionOptions: unknown[] = [];
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
    $transaction: async (fn: (tx: unknown) => Promise<void>, options?: unknown) => {
      transactionOptions.push(options);
      if (parts.transactionError) throw parts.transactionError;
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
  return { db, updates, transactionOptions };
}

const serializationConflict = () =>
  new Prisma.PrismaClientKnownRequestError("Write conflict or deadlock", {
    code: "P2034",
    clientVersion: "test",
  });

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

  it("runs the backstop transaction at Serializable isolation", async () => {
    const { db, transactionOptions } = fakeDb({ target: admin, activeAdminCount: 2 });
    await setMemberActive(db, { targetId: "a1", active: false, actorId: "x" });
    expect(transactionOptions).toEqual([{ isolationLevel: "Serializable" }]);
  });

  it("maps a serialization conflict to a friendly retry error", async () => {
    const { db } = fakeDb({
      target: admin,
      activeAdminCount: 2,
      transactionError: serializationConflict(),
    });
    const result = await setMemberActive(db, { targetId: "a1", active: false, actorId: "x" });
    expect(result).toEqual({
      ok: false,
      error: "Another member change happened at the same time. Try again.",
    });
  });

  it("rethrows a non-serialization transaction failure", async () => {
    const otherError = new Error("connection lost");
    const { db } = fakeDb({ target: admin, activeAdminCount: 2, transactionError: otherError });
    await expect(
      setMemberActive(db, { targetId: "a1", active: false, actorId: "x" })
    ).rejects.toBe(otherError);
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

  it("runs the backstop transaction at Serializable isolation", async () => {
    const { db, transactionOptions } = fakeDb({ target: admin, activeAdminCount: 2 });
    await setMemberRole(db, { targetId: "a1", role: "MEMBER" });
    expect(transactionOptions).toEqual([{ isolationLevel: "Serializable" }]);
  });

  it("maps a serialization conflict to a friendly retry error", async () => {
    const { db } = fakeDb({
      target: admin,
      activeAdminCount: 2,
      transactionError: serializationConflict(),
    });
    const result = await setMemberRole(db, { targetId: "a1", role: "MEMBER" });
    expect(result).toEqual({
      ok: false,
      error: "Another member change happened at the same time. Try again.",
    });
  });
});

describe("resetMemberPassword", () => {
  it("sets a temporary password and returns it once", async () => {
    const { db, updates } = fakeDb({ target: member });
    const result = await resetMemberPassword(db, { targetId: "m1", actorId: "a1" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.temporaryPassword.length).toBeGreaterThanOrEqual(8);
    expect(updates).toHaveLength(1);
  });

  // The round trip. A stored hash that does not verify against the password
  // just handed to the admin is the exact failure this feature exists to
  // prevent, and it is invisible in the database — it surfaces only when the
  // locked-out member tries the password and it does not work.
  it("stores a hash that verifies against the returned password", async () => {
    const { db, updates } = fakeDb({ target: member });
    const result = await resetMemberPassword(db, { targetId: "m1", actorId: "a1" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const stored = updates[0].passwordHash as string;
    expect(await verifyPassword(stored, result.data.temporaryPassword)).toBe(true);
  });

  // Same guard shape as setMemberActive's self-deactivation check. Without
  // it, "reset my own password" is a documented way around the
  // current-password check changeOwnPassword exists to enforce — an unlocked
  // admin laptop would be a two-click account takeover.
  it("refuses to reset your own password, and writes nothing", async () => {
    const { db, updates } = fakeDb({ target: admin });
    const result = await resetMemberPassword(db, { targetId: "a1", actorId: "a1" });
    expect(result.ok).toBe(false);
    expect(updates).toHaveLength(0);
  });

  it("errors on an unknown member and writes nothing", async () => {
    const { db, updates } = fakeDb({ target: null });
    const result = await resetMemberPassword(db, { targetId: "ghost", actorId: "a1" });
    expect(result).toEqual({ ok: false, error: "Member not found" });
    expect(updates).toHaveLength(0);
  });

  it("gives a different password each time", async () => {
    const a = await resetMemberPassword(fakeDb({ target: member }).db, { targetId: "m1", actorId: "a1" });
    const b = await resetMemberPassword(fakeDb({ target: member }).db, { targetId: "m1", actorId: "a1" });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.data.temporaryPassword).not.toBe(b.data.temporaryPassword);
  });

  // Deliberately allowed. An admin reactivating someone will often reset
  // them in the same sitting, and refusing would force an order for no
  // reason. `authenticate` still rejects an inactive user before it checks
  // any password, so a reset alone never grants access.
  it("allows resetting an inactive member", async () => {
    const { db, updates } = fakeDb({ target: { id: "m1", role: "MEMBER", active: false } });
    const result = await resetMemberPassword(db, { targetId: "m1", actorId: "a1" });
    expect(result.ok).toBe(true);
    expect(updates).toHaveLength(1);
  });
});
