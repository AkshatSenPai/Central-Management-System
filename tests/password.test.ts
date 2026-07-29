import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/password";

describe("password hashing", () => {
  it("verifies a correct password against its hash", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword(hash, "correct horse battery staple")).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword(hash, "wrong password")).toBe(false);
  });

  it("produces argon2 hashes, never plaintext", async () => {
    const hash = await hashPassword("secret123");
    expect(hash).toMatch(/^\$argon2/);
    expect(hash).not.toContain("secret123");
  });

  it("returns false (not throws) for a malformed hash", async () => {
    expect(await verifyPassword("not-a-real-hash", "anything")).toBe(false);
  });
});
