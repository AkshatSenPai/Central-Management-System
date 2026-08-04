import { describe, expect, it } from "vitest";
import {
  emptyMessage,
  filterOptions,
  labelForValue,
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
