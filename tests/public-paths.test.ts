import { describe, it, expect } from "vitest";
import { isPublicPath } from "@/lib/public-paths";

describe("isPublicPath", () => {
  it("treats /login as public", () => {
    expect(isPublicPath("/login")).toBe(true);
  });

  it("treats /login-help as protected (not a prefix match)", () => {
    expect(isPublicPath("/login-help")).toBe(false);
  });

  it("treats /invite/abc123 as public", () => {
    expect(isPublicPath("/invite/abc123")).toBe(true);
  });

  it("treats /invite (no token segment) as protected", () => {
    expect(isPublicPath("/invite")).toBe(false);
  });

  it("treats /invite/a/b (extra segment) as protected", () => {
    expect(isPublicPath("/invite/a/b")).toBe(false);
  });

  it("treats /invited-users as protected (not a prefix match)", () => {
    expect(isPublicPath("/invited-users")).toBe(false);
  });

  it("treats / as protected", () => {
    expect(isPublicPath("/")).toBe(false);
  });

  it("treats /dashboard as protected", () => {
    expect(isPublicPath("/dashboard")).toBe(false);
  });

  it("treats /settings/members as protected", () => {
    expect(isPublicPath("/settings/members")).toBe(false);
  });
});
