import { describe, it, expect } from "vitest";
import {
  groupHits,
  parseSearchQuery,
  rankHits,
  searchSummary,
  type SearchHit,
} from "@/lib/search";

const hit = (kind: SearchHit["kind"], title: string): SearchHit => ({
  kind,
  id: title,
  title,
  subtitle: "",
  href: "#",
});

describe("parseSearchQuery", () => {
  it("accepts a usable term", () => {
    expect(parseSearchQuery("harlow")).toBe("harlow");
  });

  it("trims", () => {
    expect(parseSearchQuery("  harlow  ")).toBe("harlow");
  });

  // One character matches most of the database, which makes the page a slow
  // way to list everything rather than a search.
  it("refuses fewer than two characters", () => {
    expect(parseSearchQuery("a")).toBeNull();
    expect(parseSearchQuery("")).toBeNull();
    expect(parseSearchQuery("   ")).toBeNull();
    expect(parseSearchQuery(undefined)).toBeNull();
  });

  it("refuses an absurdly long term rather than querying on it", () => {
    expect(parseSearchQuery("x".repeat(101))).toBeNull();
  });

  it("takes the first of a repeated param", () => {
    expect(parseSearchQuery(["harlow", "verity"])).toBe("harlow");
  });

  // Prisma parameterises the term, so these are matched literally. The parser
  // must not strip them — searching for a literal % should be possible.
  it("passes SQL wildcards through untouched", () => {
    expect(parseSearchQuery("100%")).toBe("100%");
    expect(parseSearchQuery("a_b")).toBe("a_b");
  });
});

describe("rankHits", () => {
  // Typing "har" for "Harlow & Fitch" must not rank below something that
  // merely contains "har" in the middle of a word.
  it("puts a prefix match above a mid-word match", () => {
    const ranked = rankHits([hit("task", "Rechargeable"), hit("task", "Harlow brief")], "har");
    expect(ranked.map((h) => h.title)).toEqual(["Harlow brief", "Rechargeable"]);
  });

  it("puts an exact match first", () => {
    const ranked = rankHits([hit("task", "Harlow brief"), hit("task", "Harlow")], "harlow");
    expect(ranked[0].title).toBe("Harlow");
  });

  it("ranks a match at a later word start above a mid-word match", () => {
    const ranked = rankHits([hit("task", "Unharmed"), hit("task", "The harbour")], "har");
    expect(ranked.map((h) => h.title)).toEqual(["The harbour", "Unharmed"]);
  });

  // Someone searching "harlow" almost always wants the client page, not the
  // thirty tasks underneath it.
  it("breaks ties by breadth: clients, then projects, then tasks", () => {
    const ranked = rankHits(
      [hit("task", "Harlow"), hit("project", "Harlow"), hit("client", "Harlow")],
      "harlow"
    );
    expect(ranked.map((h) => h.kind)).toEqual(["client", "project", "task"]);
  });

  it("is case-insensitive", () => {
    const ranked = rankHits([hit("task", "zzz"), hit("task", "HARLOW brief")], "harlow");
    expect(ranked[0].title).toBe("HARLOW brief");
  });

  it("does not mutate its input", () => {
    const input = [hit("task", "b"), hit("client", "a")];
    const copy = [...input];
    rankHits(input, "a");
    expect(input).toEqual(copy);
  });

  it("handles an empty list", () => {
    expect(rankHits([], "x")).toEqual([]);
  });
});

describe("groupHits", () => {
  it("splits by kind and keeps order within each", () => {
    const grouped = groupHits([
      hit("task", "t1"),
      hit("client", "c1"),
      hit("task", "t2"),
      hit("project", "p1"),
    ]);
    expect(grouped.client.map((h) => h.title)).toEqual(["c1"]);
    expect(grouped.project.map((h) => h.title)).toEqual(["p1"]);
    expect(grouped.task.map((h) => h.title)).toEqual(["t1", "t2"]);
  });

  it("returns empty arrays rather than missing keys", () => {
    expect(groupHits([])).toEqual({ client: [], project: [], task: [] });
  });
});

describe("searchSummary", () => {
  it("counts, and says the term back", () => {
    expect(searchSummary(0, "harlow")).toBe("Nothing matches “harlow”");
    expect(searchSummary(1, "harlow")).toBe("1 result for “harlow”");
    expect(searchSummary(4, "harlow")).toBe("4 results for “harlow”");
  });
});
