import { describe, it, expect } from "vitest";
import { REDEEM_ERRORS, knownRedeemError } from "@/lib/invite-errors";

describe("knownRedeemError", () => {
  it.each(Object.values(REDEEM_ERRORS))("passes through the known error %j", (message) => {
    expect(knownRedeemError(message)).toBe(message);
  });

  it("rejects arbitrary text so the public page can't render attacker-chosen strings", () => {
    expect(knownRedeemError("Your account is locked — call +1-555-0100 now")).toBeNull();
  });

  it("rejects a near-miss variant of a known error", () => {
    expect(knownRedeemError("Invalid invite link.")).toBeNull();
  });

  it("rejects an empty string", () => {
    expect(knownRedeemError("")).toBeNull();
  });

  it("rejects undefined", () => {
    expect(knownRedeemError(undefined)).toBeNull();
  });
});
