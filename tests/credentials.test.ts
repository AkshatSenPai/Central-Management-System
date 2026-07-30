import { describe, it, expect } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { authorizeUser } from "@/lib/credentials";
import { hashPassword } from "@/lib/password";

function fakeDb(user: unknown): PrismaClient {
  return {
    user: { findUnique: async () => user },
  } as unknown as PrismaClient;
}

const baseUser = async () => ({
  id: "u1",
  email: "jo@example.com",
  name: "Jo",
  role: "MEMBER" as const,
  active: true,
  passwordHash: await hashPassword("right-password"),
});

describe("authorizeUser", () => {
  it("returns the safe user shape on correct credentials", async () => {
    const db = fakeDb(await baseUser());
    const result = await authorizeUser(db, "jo@example.com", "right-password");
    expect(result).toEqual({ id: "u1", email: "jo@example.com", name: "Jo", role: "MEMBER" });
  });

  it("normalizes email case/whitespace before lookup", async () => {
    let lookedUp = "";
    const user = await baseUser();
    const db = {
      user: {
        findUnique: async (args: { where: { email: string } }) => {
          lookedUp = args.where.email;
          return user;
        },
      },
    } as unknown as PrismaClient;
    await authorizeUser(db, "  Jo@Example.COM ", "right-password");
    expect(lookedUp).toBe("jo@example.com");
  });

  it("rejects a wrong password", async () => {
    const db = fakeDb(await baseUser());
    expect(await authorizeUser(db, "jo@example.com", "wrong")).toBeNull();
  });

  it("rejects an unknown email", async () => {
    const db = fakeDb(null);
    expect(await authorizeUser(db, "ghost@example.com", "whatever")).toBeNull();
  });

  it("rejects a deactivated user even with the right password", async () => {
    const db = fakeDb({ ...(await baseUser()), active: false });
    expect(await authorizeUser(db, "jo@example.com", "right-password")).toBeNull();
  });

  it("rejects a Google-only user (no passwordHash)", async () => {
    const db = fakeDb({ ...(await baseUser()), passwordHash: null });
    expect(await authorizeUser(db, "jo@example.com", "anything")).toBeNull();
  });
});
