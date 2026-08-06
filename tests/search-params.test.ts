import { describe, it, expect } from "vitest";
import { lastParam } from "@/lib/search-params";

describe("lastParam", () => {
  it("returns a lone string unchanged", () => {
    expect(lastParam("week")).toBe("week");
  });

  it("returns an empty string for a missing param, so callers can use || and ??", () => {
    expect(lastParam(undefined)).toBe("");
    expect(lastParam("")).toBe("");
  });

  // The whole reason this function exists. A GET form that carries a value in
  // a hidden input AND lets a submit button override it produces the parameter
  // twice, and the browser serialises them in tree order: the hidden input
  // near the top of the form first, the submitter's own value after it. The
  // later value is the one the user just chose.
  it("takes the LAST of a repeated param — the override, not the carried default", () => {
    expect(lastParam(["month", "week"])).toBe("week");
    expect(lastParam(["2026-08-06", "2026-07-27"])).toBe("2026-07-27");
  });

  it("handles a single-element array", () => {
    expect(lastParam(["day"])).toBe("day");
  });

  it("returns an empty string for an empty array rather than undefined", () => {
    expect(lastParam([])).toBe("");
  });

  // A repeated param whose last value is empty means the override was blank —
  // that is still the answer, and the caller's own `|| null` turns it into
  // "no filter". Silently falling back to an earlier non-empty value would
  // make a cleared filter impossible to express.
  it("does not skip past an empty last value to find a non-empty earlier one", () => {
    expect(lastParam(["week", ""])).toBe("");
  });
});
