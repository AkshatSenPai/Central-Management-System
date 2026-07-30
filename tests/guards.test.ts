import { describe, it, expect } from "vitest";
import { AuthError, assertUser, assertAdmin } from "@/lib/auth-guards";

describe("assertUser", () => {
  it("throws when there is no session", () => {
    expect(() => assertUser(null)).toThrow(AuthError);
    expect(() => assertUser(undefined)).toThrow(AuthError);
  });

  it("throws when the session has no user id", () => {
    expect(() => assertUser({ user: { role: "MEMBER" } })).toThrow(AuthError);
  });

  it("returns the user when signed in", () => {
    const session = { user: { id: "u1", role: "MEMBER" as const } };
    expect(assertUser(session)).toEqual(session.user);
  });
});

describe("assertAdmin", () => {
  it("throws when there is no session", () => {
    expect(() => assertAdmin(null)).toThrow(AuthError);
  });

  it("throws 'Admin access required' when a MEMBER hits it", () => {
    const session = { user: { id: "u1", role: "MEMBER" as const } };
    expect(() => assertAdmin(session)).toThrow("Admin access required");
  });

  it("passes for an ADMIN", () => {
    const session = { user: { id: "a1", role: "ADMIN" as const } };
    expect(assertAdmin(session)).toEqual(session.user);
  });
});
