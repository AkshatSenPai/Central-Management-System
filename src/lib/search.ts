import { z } from "zod";

/** Pure search helpers. The query itself lives in search-queries.ts; this file
 * is the parsing and shaping, so it unit-tests without a database. */

export const searchSchema = z.object({
  q: z.string().trim().min(2, "Type at least two characters").max(100),
});

/** Null means "no usable query" — the page renders its prompt rather than an
 * empty result set, because "no results for `a`" reads as a failure when it is
 * really a refusal.
 *
 * Two characters is the floor: one character matches most of the database and
 * would make the page a slow way to list everything. */
export function parseSearchQuery(raw: string | string[] | undefined): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const parsed = searchSchema.safeParse({ q: value ?? "" });
  return parsed.success ? parsed.data.q : null;
}

export type SearchKind = "task" | "client" | "project";

export type SearchHit = {
  kind: SearchKind;
  id: string;
  title: string;
  subtitle: string;
  href: string;
};

/** Where a match sits in the term. A name that *starts* with what you typed is
 * almost always what you meant — typing "har" for "Harlow & Fitch" should not
 * rank below something that merely contains "har" in the middle. */
function matchRank(title: string, term: string): number {
  const t = title.toLowerCase();
  const q = term.toLowerCase();
  if (t === q) return 0;
  if (t.startsWith(q)) return 1;
  const wordStart = t.split(/\s+/).some((w) => w.startsWith(q));
  return wordStart ? 2 : 3;
}

/** Clients, then projects, then tasks. Deliberate: the broader the thing, the
 * higher it sits, because someone searching "harlow" almost always wants the
 * client page rather than the thirty tasks underneath it. */
const KIND_ORDER: Record<SearchKind, number> = { client: 0, project: 1, task: 2 };

/** Orders hits for display. Stable within a rank — the queries already sort by
 * name, so equal-ranked results stay alphabetical rather than shuffling
 * between page loads. */
export function rankHits(hits: SearchHit[], term: string): SearchHit[] {
  return [...hits].sort((a, b) => {
    const byMatch = matchRank(a.title, term) - matchRank(b.title, term);
    if (byMatch !== 0) return byMatch;
    return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
  });
}

export function groupHits(hits: SearchHit[]): Record<SearchKind, SearchHit[]> {
  return {
    client: hits.filter((h) => h.kind === "client"),
    project: hits.filter((h) => h.kind === "project"),
    task: hits.filter((h) => h.kind === "task"),
  };
}

export const KIND_LABEL: Record<SearchKind, string> = {
  client: "Clients",
  project: "Projects",
  task: "Tasks",
};

export function searchSummary(count: number, term: string): string {
  if (count === 0) return `Nothing matches “${term}”`;
  return count === 1 ? `1 result for “${term}”` : `${count} results for “${term}”`;
}
