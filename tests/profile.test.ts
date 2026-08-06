import { describe, it, expect } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { changeOwnPassword, profileSchema } from "@/lib/profile";
import { hashPassword, verifyPassword } from "@/lib/password";

describe("profileSchema", () => {
  it("accepts a full valid profile", () => {
    const result = profileSchema.safeParse({
      name: "  Jo Smith ",
      title: "Designer",
      phone: "+91 98765 43210",
      avatarUrl: "https://example.com/a.png",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.name).toBe("Jo Smith");
  });

  it("accepts empty optional fields", () => {
    const result = profileSchema.safeParse({
      name: "Jo",
      title: "",
      phone: "",
      avatarUrl: "",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a blank name", () => {
    expect(profileSchema.safeParse({ name: "   " }).success).toBe(false);
  });

  it("rejects a non-URL avatar", () => {
    expect(
      profileSchema.safeParse({ name: "Jo", avatarUrl: "not-a-url" }).success
    ).toBe(false);
  });

  it("rejects a javascript: URL avatar", () => {
    expect(
      profileSchema.safeParse({ name: "Jo", avatarUrl: "javascript:alert(1)" })
        .success
    ).toBe(false);
  });

  it("accepts an https avatar URL", () => {
    expect(
      profileSchema.safeParse({
        name: "Jo",
        avatarUrl: "https://example.com/a.png",
      }).success
    ).toBe(true);
  });
});

type FakeParts = { user?: { id: string; passwordHash: string | null } | null };

function fakeDb(parts: FakeParts) {
  const updates: { where: unknown; data: Record<string, unknown> }[] = [];
  const db = {
    user: {
      findUnique: async () => parts.user ?? null,
      update: async (args: { where: unknown; data: Record<string, unknown> }) => {
        updates.push(args);
        return args.data;
      },
    },
  } as unknown as PrismaClient;
  return { db, updates };
}

describe("changeOwnPassword", () => {
  const OLD = "oldpassword";
  const NEW = "newpassword";

  it("changes the password when the current one is correct", async () => {
    const { db, updates } = fakeDb({ user: { id: "u1", passwordHash: await hashPassword(OLD) } });
    const result = await changeOwnPassword(db, { userId: "u1", current: OLD, next: NEW, confirm: NEW });
    expect(result).toEqual({ ok: true, data: undefined });
    expect(updates).toHaveLength(1);
  });

  // The property that matters. A correctly-shaped row whose hash does not
  // verify is the failure this whole feature exists to prevent, and it is
  // invisible until someone tries to sign in.
  it("stores a hash the login path accepts, and only for the new password", async () => {
    const { db, updates } = fakeDb({ user: { id: "u1", passwordHash: await hashPassword(OLD) } });
    await changeOwnPassword(db, { userId: "u1", current: OLD, next: NEW, confirm: NEW });
    const stored = updates[0].data.passwordHash as string;
    expect(await verifyPassword(stored, NEW)).toBe(true);
    expect(await verifyPassword(stored, OLD)).toBe(false);
  });

  // The authorisation model in one assertion: the row written is the one the
  // session named, and the input carries no other id to substitute.
  it("updates only the caller's own row", async () => {
    const { db, updates } = fakeDb({ user: { id: "u1", passwordHash: await hashPassword(OLD) } });
    await changeOwnPassword(db, { userId: "u1", current: OLD, next: NEW, confirm: NEW });
    expect(updates[0].where).toEqual({ id: "u1" });
  });

  it("rejects a wrong current password and writes nothing", async () => {
    const { db, updates } = fakeDb({ user: { id: "u1", passwordHash: await hashPassword(OLD) } });
    const result = await changeOwnPassword(db, {
      userId: "u1",
      current: "wrongpassword",
      next: NEW,
      confirm: NEW,
    });
    expect(result.ok).toBe(false);
    expect(updates).toHaveLength(0);
  });

  it("applies the shared validation before touching the database", async () => {
    const { db, updates } = fakeDb({ user: { id: "u1", passwordHash: await hashPassword(OLD) } });
    const result = await changeOwnPassword(db, {
      userId: "u1",
      current: OLD,
      next: "short",
      confirm: "short",
    });
    expect(result.ok).toBe(false);
    expect(updates).toHaveLength(0);
  });

  it("rejects a new password identical to the current one", async () => {
    const { db, updates } = fakeDb({ user: { id: "u1", passwordHash: await hashPassword(OLD) } });
    const result = await changeOwnPassword(db, { userId: "u1", current: OLD, next: OLD, confirm: OLD });
    expect(result.ok).toBe(false);
    expect(updates).toHaveLength(0);
  });

  // A Google-only account has no passwordHash. It must not be possible to
  // set one by guessing, so this returns the same message a wrong password
  // does rather than revealing that no password exists.
  it("errors when the user has no password set", async () => {
    const { db, updates } = fakeDb({ user: { id: "u1", passwordHash: null } });
    const result = await changeOwnPassword(db, { userId: "u1", current: OLD, next: NEW, confirm: NEW });
    expect(result.ok).toBe(false);
    expect(updates).toHaveLength(0);
  });

  it("errors when the user does not exist", async () => {
    const { db, updates } = fakeDb({ user: null });
    const result = await changeOwnPassword(db, { userId: "ghost", current: OLD, next: NEW, confirm: NEW });
    expect(result.ok).toBe(false);
    expect(updates).toHaveLength(0);
  });
});
