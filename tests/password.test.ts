import { describe, it, expect } from "vitest";
import {
  MIN_PASSWORD_LENGTH,
  generateTemporaryPassword,
  hashPassword,
  validatePasswordChange,
  verifyPassword,
} from "@/lib/password";

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

describe("validatePasswordChange", () => {
  it("accepts a valid change", () => {
    expect(
      validatePasswordChange({ next: "newpassword", confirm: "newpassword", current: "oldpassword" })
    ).toBeNull();
  });

  it("rejects a new password shorter than the minimum", () => {
    const error = validatePasswordChange({ next: "short", confirm: "short" });
    expect(error).not.toBeNull();
    expect(error).toContain(String(MIN_PASSWORD_LENGTH));
  });

  // The boundary, asserted from the constant so a future edit to
  // MIN_PASSWORD_LENGTH fails loudly rather than silently widening the rule.
  it("accepts exactly the minimum length", () => {
    const atLimit = "a".repeat(MIN_PASSWORD_LENGTH);
    expect(validatePasswordChange({ next: atLimit, confirm: atLimit })).toBeNull();
  });

  // `redeemInvite` (invite-service.ts) enforces 8 when an account is created.
  // A password this validator accepts but signup would have rejected is a
  // rule disagreeing with itself, so the number is pinned here.
  it("matches redeemInvite's rule", () => {
    expect(MIN_PASSWORD_LENGTH).toBe(8);
  });

  it("rejects a mismatched confirmation", () => {
    const error = validatePasswordChange({ next: "newpassword", confirm: "newpassxxxx" });
    expect(error).not.toBeNull();
    expect(error).toMatch(/match/i);
  });

  // A "change" that changes nothing is a user error worth naming, not a
  // silent success that leaves them believing the password moved.
  it("rejects a new password identical to the current one", () => {
    const error = validatePasswordChange({
      next: "samepassword",
      confirm: "samepassword",
      current: "samepassword",
    });
    expect(error).not.toBeNull();
    expect(error).toMatch(/different/i);
  });

  // `current` is optional because the admin-reset path has no current
  // password to compare against — it is minting one for somebody else.
  it("skips the sameness check when no current password is supplied", () => {
    expect(validatePasswordChange({ next: "anypassword", confirm: "anypassword" })).toBeNull();
  });

  it("checks length before mismatch, so the more useful message wins", () => {
    const error = validatePasswordChange({ next: "abc", confirm: "xyz" });
    expect(error).toContain(String(MIN_PASSWORD_LENGTH));
  });
});

describe("generateTemporaryPassword", () => {
  it("is long enough to pass its own validator", () => {
    const password = generateTemporaryPassword();
    expect(validatePasswordChange({ next: password, confirm: password })).toBeNull();
  });

  // Read aloud on a call, or typed on a phone. 0/O and 1/l/I are the
  // characters that turn a working password into a support conversation.
  it("draws only from an unambiguous alphabet", () => {
    for (let i = 0; i < 50; i++) {
      expect(generateTemporaryPassword()).toMatch(
        /^[abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789]+$/
      );
    }
  });

  it("does not repeat across calls", () => {
    const seen = new Set(Array.from({ length: 50 }, () => generateTemporaryPassword()));
    expect(seen.size).toBe(50);
  });

  // The round trip that matters: a generated password must survive hashing
  // and verify at login. A hash in the wrong format looks completely fine in
  // the database and fails only at the login screen — which is exactly how
  // this feature's own incident started.
  it("survives the hash/verify round trip", async () => {
    const password = generateTemporaryPassword();
    const hash = await hashPassword(password);
    expect(await verifyPassword(hash, password)).toBe(true);
    expect(await verifyPassword(hash, password + "x")).toBe(false);
  });
});
