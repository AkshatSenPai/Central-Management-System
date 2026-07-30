import { describe, it, expect } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { redeemInvite } from "@/lib/invite-service";

type FakeParts = {
  invite?: unknown;
  existingUser?: unknown;
  transactionError?: unknown;
};

function fakeDb(parts: FakeParts) {
  const userCreates: Record<string, unknown>[] = [];
  const inviteUpdates: Record<string, unknown>[] = [];
  const db = {
    invite: {
      findUnique: async () => parts.invite ?? null,
      update: async (args: { data: Record<string, unknown> }) => {
        inviteUpdates.push(args.data);
        return args.data;
      },
    },
    user: {
      findUnique: async () => parts.existingUser ?? null,
      create: async (args: { data: Record<string, unknown> }) => {
        userCreates.push(args.data);
        return args.data;
      },
    },
    $transaction: async (ops: unknown[]) => {
      if (parts.transactionError) throw parts.transactionError;
      return Promise.all(ops as Promise<unknown>[]);
    },
  } as unknown as PrismaClient;
  return { db, userCreates, inviteUpdates };
}

const validInvite = {
  id: "i1",
  email: "new@example.com",
  role: "MEMBER",
  expiresAt: new Date(Date.now() + 60_000),
  acceptedAt: null,
};

const goodInput = { token: "tok", name: "  New Person ", password: "longenough" };

describe("redeemInvite", () => {
  it("rejects an unknown token", async () => {
    const { db } = fakeDb({});
    expect(await redeemInvite(db, goodInput)).toEqual({ ok: false, error: "Invalid invite link" });
  });

  it("rejects a used invite", async () => {
    const { db } = fakeDb({ invite: { ...validInvite, acceptedAt: new Date() } });
    expect(await redeemInvite(db, goodInput)).toEqual({
      ok: false,
      error: "This invite has already been used",
    });
  });

  it("rejects an expired invite", async () => {
    const { db } = fakeDb({
      invite: { ...validInvite, expiresAt: new Date(Date.now() - 60_000) },
    });
    expect(await redeemInvite(db, goodInput)).toEqual({
      ok: false,
      error: "This invite has expired",
    });
  });

  it("rejects a short password", async () => {
    const { db } = fakeDb({ invite: validInvite });
    expect(await redeemInvite(db, { ...goodInput, password: "short" })).toEqual({
      ok: false,
      error: "Password must be at least 8 characters",
    });
  });

  it("rejects a blank name", async () => {
    const { db } = fakeDb({ invite: validInvite });
    expect(await redeemInvite(db, { ...goodInput, name: "   " })).toEqual({
      ok: false,
      error: "Name is required",
    });
  });

  it("rejects when the email already became a user", async () => {
    const { db } = fakeDb({ invite: validInvite, existingUser: { id: "u9" } });
    expect(await redeemInvite(db, goodInput)).toEqual({
      ok: false,
      error: "A member with this email already exists",
    });
  });

  it("creates the user with the invite's role and marks the invite used", async () => {
    const { db, userCreates, inviteUpdates } = fakeDb({ invite: validInvite });
    const result = await redeemInvite(db, goodInput);
    expect(result).toEqual({ ok: true, data: undefined });
    expect(userCreates).toHaveLength(1);
    expect(userCreates[0]).toMatchObject({
      email: "new@example.com",
      name: "New Person",
      role: "MEMBER",
    });
    expect(String(userCreates[0].passwordHash)).toMatch(/^\$argon2/);
    expect(inviteUpdates[0]).toHaveProperty("acceptedAt");
  });

  it("maps a concurrent-redemption unique-constraint race to a friendly error", async () => {
    const raceError = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "test",
    });
    const { db } = fakeDb({ invite: validInvite, transactionError: raceError });
    expect(await redeemInvite(db, goodInput)).toEqual({
      ok: false,
      error: "A member with this email already exists",
    });
  });

  it("rethrows a non-unique-constraint transaction failure", async () => {
    const otherError = new Prisma.PrismaClientKnownRequestError("Some other DB error", {
      code: "P2025",
      clientVersion: "test",
    });
    const { db } = fakeDb({ invite: validInvite, transactionError: otherError });
    await expect(redeemInvite(db, goodInput)).rejects.toBe(otherError);
  });
});
