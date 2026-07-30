import { describe, it, expect } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createInviteRecord } from "@/lib/invite-service";

type FakeParts = {
  existingUser?: unknown;
  pendingInvite?: unknown;
};

function fakeDb(parts: FakeParts) {
  const created: unknown[] = [];
  const db = {
    user: { findUnique: async () => parts.existingUser ?? null },
    invite: {
      findFirst: async () => parts.pendingInvite ?? null,
      create: async (args: { data: Record<string, unknown> }) => {
        created.push(args.data);
        return args.data;
      },
    },
  } as unknown as PrismaClient;
  return { db, created };
}

describe("createInviteRecord", () => {
  const input = { email: "New@Example.com ", role: "MEMBER" as const, createdById: "admin1" };

  it("rejects when a member with that email already exists", async () => {
    const { db } = fakeDb({ existingUser: { id: "u1" } });
    const result = await createInviteRecord(db, input);
    expect(result).toEqual({ ok: false, error: "A member with this email already exists" });
  });

  it("rejects when a pending invite already exists", async () => {
    const { db } = fakeDb({ pendingInvite: { id: "i1" } });
    const result = await createInviteRecord(db, input);
    expect(result).toEqual({ ok: false, error: "A pending invite for this email already exists" });
  });

  it("creates an invite with normalized email and returns the token", async () => {
    const { db, created } = fakeDb({});
    const result = await createInviteRecord(db, input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.token).toMatch(/^[A-Za-z0-9_-]{43,}$/);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      email: "new@example.com",
      role: "MEMBER",
      createdById: "admin1",
      token: result.data.token,
    });
  });
});
