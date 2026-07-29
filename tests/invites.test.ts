import { describe, it, expect } from "vitest";
import {
  generateInviteToken,
  inviteStatus,
  inviteExpiry,
  INVITE_TTL_DAYS,
} from "@/lib/invites";

describe("generateInviteToken", () => {
  it("is url-safe and long enough", () => {
    const token = generateInviteToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token.length).toBeGreaterThanOrEqual(43); // 32 bytes base64url
  });

  it("is unique across calls", () => {
    const tokens = new Set(Array.from({ length: 100 }, generateInviteToken));
    expect(tokens.size).toBe(100);
  });
});

describe("inviteStatus", () => {
  const future = new Date(Date.now() + 60_000);
  const past = new Date(Date.now() - 60_000);

  it("is valid when unexpired and unaccepted", () => {
    expect(inviteStatus({ expiresAt: future, acceptedAt: null })).toBe("valid");
  });

  it("is expired past expiresAt", () => {
    expect(inviteStatus({ expiresAt: past, acceptedAt: null })).toBe("expired");
  });

  it("is used once accepted — even if also expired", () => {
    expect(inviteStatus({ expiresAt: past, acceptedAt: past })).toBe("used");
  });
});

describe("inviteExpiry", () => {
  it(`is ${INVITE_TTL_DAYS} days out`, () => {
    const from = new Date("2026-07-29T00:00:00Z");
    expect(inviteExpiry(from).toISOString()).toBe("2026-08-05T00:00:00.000Z");
  });
});
