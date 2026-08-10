/** The rules behind the two `localStorage`-backed dismissibles.
 *
 * Pure and separate from the hook that stores the value, because vitest runs in
 * the node environment with no jsdom (`vitest.config.ts`) — the same split
 * `combobox.ts` made from `combobox.tsx`. The rule is testable; the storage
 * wrapper is not, so the rule is where the thinking lives. */

/** Whether the what's-new modal should appear.
 *
 * `null` means this browser has never stored anything — a first-ever sign-in —
 * and gets NOTHING. Greeting somebody with a changelog for an app they have
 * never used is noise, and every item in it would describe something that was
 * always there for them. The caller stores the current id silently instead.
 *
 * Ids are compared, never ordered. They are opaque strings a human writes, so
 * "different" is the only relation that can be trusted — no date parsing, no
 * assumption that a newer id sorts later. It also means a corrected typo
 * re-shows rather than staying silently hidden.
 *
 * An empty string is deliberately NOT an absence: a browser that has been
 * through a botched write has stored something, and treating it as brand new
 * would suppress the next release for that person. */
export function shouldShowRelease(stored: string | null, newestId: string): boolean {
  if (stored === null) return false;
  return stored !== newestId;
}
