import { describe, it, expect } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { googleSignInAllowed } from "@/lib/google-gate";

function fakeDb(user: unknown): { db: PrismaClient; lookedUp: string[] } {
  const lookedUp: string[] = [];
  const db = {
    user: {
      findUnique: async (args: { where: { email: string } }) => {
        lookedUp.push(args.where.email);
        return user;
      },
    },
  } as unknown as PrismaClient;
  return { db, lookedUp };
}

describe("googleSignInAllowed", () => {
  it("allows an invited, active user", async () => {
    const { db } = fakeDb({ id: "u1", email: "jo@example.com", active: true });
    expect(await googleSignInAllowed(db, "jo@example.com")).toBe(true);
  });

  it("rejects an invited but inactive user", async () => {
    const { db } = fakeDb({ id: "u1", email: "jo@example.com", active: false });
    expect(await googleSignInAllowed(db, "jo@example.com")).toBe(false);
  });

  it("rejects an uninvited email", async () => {
    const { db } = fakeDb(null);
    expect(await googleSignInAllowed(db, "ghost@example.com")).toBe(false);
  });

  it("normalizes a mixed-case/whitespace email variant of an invited user", async () => {
    const { db, lookedUp } = fakeDb({ id: "u1", email: "jo@example.com", active: true });
    expect(await googleSignInAllowed(db, "  Jo@Example.COM ")).toBe(true);
    expect(lookedUp).toEqual(["jo@example.com"]);
  });

  it("rejects a null email", async () => {
    const { db } = fakeDb({ id: "u1", email: "jo@example.com", active: true });
    expect(await googleSignInAllowed(db, null)).toBe(false);
  });

  it("rejects an undefined email", async () => {
    const { db } = fakeDb({ id: "u1", email: "jo@example.com", active: true });
    expect(await googleSignInAllowed(db, undefined)).toBe(false);
  });
});
