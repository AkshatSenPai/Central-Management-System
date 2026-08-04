/** The pure half of the combobox primitive. Everything here is testable;
 * everything in combobox.tsx is not, because vitest runs in the node
 * environment with no jsdom (vitest.config.ts). That split is the reason this
 * file exists at all rather than the logic living inline in the component. */

export type ComboboxOption = {
  /** The id that reaches the Server Action. "" is a legitimate value and not
   * an absence: the project picker uses it for "No project (personal task)",
   * and quick-add.tsx:83-93 records why an empty string beats an omitted
   * field — formData.get() returns null for a field the form never rendered,
   * and the whole zod parse then fails. */
  value: string;
  /** Displayed, typed against, and matched on. Deliberately no separate
   * search key: a second field would let a picker match on text the user
   * cannot see, which reads as a bug rather than a feature. Labels are NOT
   * assumed unique — rows are keyed by value, never by label or index. */
  label: string;
};

/** Case-insensitive substring match on the trimmed query, in the order given.
 * Nothing is ranked. rankHits and matchRank (src/lib/search.ts:35-58) are
 * deliberately not reused: they order a results page, where reordering is the
 * value. In a picker, reordering means the project that was third is now
 * first while you are reaching for it. */
export function filterOptions(options: ComboboxOption[], query: string): ComboboxOption[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return options;
  return options.filter((option) => option.label.toLowerCase().includes(needle));
}

/** The label to display for a committed id, or "" when the id matches nothing.
 * Blank-but-preserved is D6: the <select> this replaces fails the other way,
 * silently reassigning to the first option and making the next save quietly
 * wrong (tasks/[taskId]/page.tsx:38-42). */
export function labelForValue(options: ComboboxOption[], value: string): string {
  return options.find((option) => option.value === value)?.label ?? "";
}

/** Which of the two empty states the popover shows. `hasOptions` describes the
 * UNFILTERED list, so "no options at all" and "nothing matched what you typed"
 * stay distinguishable — a fresh install has zero clients, and
 * project-form.tsx:144 renders the picker whether or not the array is empty.
 *
 * The quotes are the typographic pair, character for character with
 * searchSummary (src/lib/search.ts:75), so the app says this the same way
 * twice rather than in two nearly-identical ways. */
export function emptyMessage(query: string, hasOptions: boolean): string {
  if (!hasOptions) return "No options";
  return `Nothing matches \u201c${query.trim()}\u201d`;
}
