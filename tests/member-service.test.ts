import { describe, it, expect } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { setMemberActive, setMemberRole } from "@/lib/member-service";

type FakeParts = {
  target?: unknown;
  activeAdminCount?: number;
};

function fakeDb(parts: FakeParts) {
  const updates: Record<string, unknown>[] = [];
  const db = {
    user: {
      findUnique: async () => parts.target ?? null,
      count: async () => parts.activeAdminCount ?? 1,
      update: async (args: { data: Record<string, unknown> }) => {
        updates.push(args.data);
        return args.data;
      },
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
});
