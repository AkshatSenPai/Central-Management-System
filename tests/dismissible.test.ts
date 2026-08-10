import { describe, it, expect } from "vitest";
import { shouldShowRelease } from "@/lib/dismissible";

describe("shouldShowRelease", () => {
  // A first-ever sign-in is NOT shown a changelog for an app they have never
  // used. The caller stores the id silently instead.
  it("is false when nothing has been stored yet", () => {
    expect(shouldShowRelease(null, "2026-08-10")).toBe(false);
  });

  it("is false when the newest release is already seen", () => {
    expect(shouldShowRelease("2026-08-10", "2026-08-10")).toBe(false);
  });

  it("is true when a newer release has arrived", () => {
    expect(shouldShowRelease("2026-08-01", "2026-08-10")).toBe(true);
  });

  // Compared, never ordered: ids are opaque strings a human writes. Somebody
  // correcting a typo in an id should re-show, not silently stay hidden.
  it("is true whenever the stored id simply differs", () => {
    expect(shouldShowRelease("2026-08-99", "2026-08-10")).toBe(true);
  });

  // An empty string is a stored value, not an absence — a browser that has
  // been through a botched write should not be treated as brand new.
  it("treats an empty stored string as seen-something, not as absent", () => {
    expect(shouldShowRelease("", "2026-08-10")).toBe(true);
  });
});
