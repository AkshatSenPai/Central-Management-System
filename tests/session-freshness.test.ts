import { describe, it, expect } from "vitest";
import type { PrismaClient } from "@prisma/client";
import type { JWT } from "next-auth/jwt";
import { refreshTokenFromDb } from "@/lib/session-freshness";

function fakeDb(user: unknown): PrismaClient {
  return {
    user: { findUnique: async () => user },
  } as unknown as PrismaClient;
}

describe("refreshTokenFromDb", () => {
  it("refreshes the role for an active user", async () => {
    const db = fakeDb({ role: "MEMBER", active: true });
    const token = { id: "u1", role: "MEMBER" } as JWT;
    const result = await refreshTokenFromDb(db, token);
    expect(result).toEqual({ id: "u1", role: "MEMBER" });
  });

  it("picks up a role change from the DB", async () => {
    const db = fakeDb({ role: "ADMIN", active: true });
    const token = { id: "u1", role: "MEMBER" } as JWT;
    const result = await refreshTokenFromDb(db, token);
    expect(result).toEqual({ id: "u1", role: "ADMIN" });
  });

  it("returns null for a deactivated user", async () => {
    const db = fakeDb({ role: "MEMBER", active: false });
    const token = { id: "u1", role: "MEMBER" } as JWT;
    expect(await refreshTokenFromDb(db, token)).toBeNull();
  });

  it("returns null when the user no longer exists", async () => {
    const db = fakeDb(null);
    const token = { id: "ghost", role: "MEMBER" } as JWT;
    expect(await refreshTokenFromDb(db, token)).toBeNull();
  });

  it("passes a token without an id through unchanged", async () => {
    const db = fakeDb({ role: "MEMBER", active: true });
    const token = { role: "MEMBER" } as JWT;
    const result = await refreshTokenFromDb(db, token);
    expect(result).toBe(token);
  });
});
