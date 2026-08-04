import { describe, expect, it } from "vitest";
import {
  emptyMessage,
  filterOptions,
  initialActiveIndex,
  labelForValue,
  nextActiveIndex,
  type ComboboxOption,
} from "@/lib/combobox";

const PROJECTS: ComboboxOption[] = [
  { value: "", label: "No project (personal task)" },
  { value: "p1", label: "Harlow & Fitch" },
  { value: "p2", label: "Launch Toolkit" },
  { value: "p3", label: "Patient Portal UX" },
];

describe("filterOptions", () => {
  it("returns every option in order for an empty query", () => {
    expect(filterOptions(PROJECTS, "")).toEqual(PROJECTS);
  });

  it("returns every option in order for a whitespace-only query", () => {
    expect(filterOptions(PROJECTS, "   ")).toEqual(PROJECTS);
  });

  it("matches case-insensitively", () => {
    expect(filterOptions(PROJECTS, "har").map((o) => o.value)).toEqual(["p1"]);
    expect(filterOptions(PROJECTS, "HAR").map((o) => o.value)).toEqual(["p1"]);
  });

  it("matches on substring, not only on prefix", () => {
    expect(filterOptions(PROJECTS, "fitch").map((o) => o.value)).toEqual(["p1"]);
  });

  it("filters the empty-string sentinel like any other option", () => {
    expect(filterOptions(PROJECTS, "personal").map((o) => o.label)).toEqual([
      "No project (personal task)",
    ]);
  });

  it("preserves the given order and never re-ranks", () => {
    // Guards against someone reaching for rankHits from src/lib/search.ts.
    // "a" hits all four; the result must be the input order, not a score order.
    expect(filterOptions(PROJECTS, "a").map((o) => o.value)).toEqual(["", "p1", "p2", "p3"]);
  });

  it("returns an empty array when nothing matches", () => {
    expect(filterOptions(PROJECTS, "zzz")).toEqual([]);
  });
});

describe("labelForValue", () => {
  it("returns the label of the matching option", () => {
    expect(labelForValue(PROJECTS, "p2")).toBe("Launch Toolkit");
  });

  it("returns the sentinel label for the empty-string value", () => {
    expect(labelForValue(PROJECTS, "")).toBe("No project (personal task)");
  });

  it("returns an empty string for an id absent from the options", () => {
    // D6: a selected id with no matching option renders blank and is still submitted.
    expect(labelForValue(PROJECTS, "deleted-id")).toBe("");
  });
});

describe("emptyMessage", () => {
  it("says No options when there are no options at all", () => {
    expect(emptyMessage("", false)).toBe("No options");
    expect(emptyMessage("anything", false)).toBe("No options");
  });

  it("quotes the query with the same curly quotes as searchSummary", () => {
    expect(emptyMessage("xyz", true)).toBe(`Nothing matches \u201cxyz\u201d`);
  });

  it("trims the query it echoes", () => {
    expect(emptyMessage("  xyz  ", true)).toBe(`Nothing matches \u201cxyz\u201d`);
  });
});

describe("initialActiveIndex", () => {
  it("returns the index of the selected value", () => {
    expect(initialActiveIndex(PROJECTS, "p2")).toBe(2);
  });

  it("returns 0 when the empty-string sentinel is itself an option", () => {
    // The Project and Milestone pickers, where "" means "No project".
    expect(initialActiveIndex(PROJECTS, "")).toBe(0);
  });

  it("returns -1 when the value matches no option", () => {
    // Two cases at once: D6's absent id, and the Client picker's unselected
    // "" — where "" is the placeholder and NOT an option. This is what stops
    // a bare open-then-Tab writing the alphabetically-first client over
    // whatever was there, with no keystroke that expressed intent.
    expect(initialActiveIndex(PROJECTS, "deleted-id")).toBe(-1);
    expect(initialActiveIndex([{ value: "c1", label: "Acme" }], "")).toBe(-1);
  });

  it("returns -1 for an empty option list", () => {
    expect(initialActiveIndex([], "")).toBe(-1);
  });
});

describe("nextActiveIndex", () => {
  it("moves down and up by one", () => {
    expect(nextActiveIndex(1, 1, 4)).toBe(2);
    expect(nextActiveIndex(2, -1, 4)).toBe(1);
  });

  it("moves from nothing-active to the first option on ArrowDown", () => {
    expect(nextActiveIndex(-1, 1, 4)).toBe(0);
  });

  it("clamps at the last option without wrapping", () => {
    expect(nextActiveIndex(3, 1, 4)).toBe(3);
  });

  it("clamps at the first option without wrapping", () => {
    expect(nextActiveIndex(0, -1, 4)).toBe(0);
    expect(nextActiveIndex(-1, -1, 4)).toBe(0);
  });

  it("returns -1 for an empty list so Enter has nothing to commit", () => {
    expect(nextActiveIndex(0, 1, 0)).toBe(-1);
    expect(nextActiveIndex(-1, 1, 0)).toBe(-1);
  });
});

describe("typing resets the active index", () => {
  it("resets to 0 when the filter has hits and -1 when it does not", () => {
    // Asserted as one test on purpose: these are the two halves of a single
    // rule in spec section 5, and splitting them is how they drift apart.
    expect(nextActiveIndex(-1, 1, filterOptions(PROJECTS, "har").length)).toBe(0);
    expect(nextActiveIndex(-1, 1, filterOptions(PROJECTS, "zzz").length)).toBe(-1);
  });
});
