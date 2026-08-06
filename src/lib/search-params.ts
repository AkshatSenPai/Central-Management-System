/** Resolving a query parameter that a form can legitimately send twice.
 *
 * Next hands a page `searchParams` where every value is `string | string[] |
 * undefined` — an array exactly when the parameter appeared more than once.
 * Most of this app's filter parsers take `[0]` and are right to: their forms
 * have one control per parameter, so a repeat can only come from a
 * hand-crafted URL and either end is as good an answer as the other.
 *
 * `CalendarFilters` is the exception, and it is not an accident of that
 * component so much as a consequence of what a single GET form has to do.
 * A GET submit replaces the entire query string, so any parameter that is not
 * a control inside the submitting form is dropped — which is why the current
 * view and the current anchor date are carried in hidden inputs at the top of
 * that form. But the same form also has to *change* those values: three
 * submit buttons named `view`, and prev/next/today buttons named `date`. So
 * both parameters are carried once and overridden once, and the browser sends
 * both.
 *
 * The order is not luck. The HTML standard builds the form data set in tree
 * order and inserts the submitter's own name/value pair at the point the
 * submitter is reached, so a hidden input written above the buttons is always
 * serialised before them. **The last value is the override; the first is the
 * default that was being carried.** Reading `[0]` therefore reads the thing
 * the user did not click.
 *
 * That is not hypothetical — it is the bug this function was written for. The
 * calendar's Month/Week/Day switcher did nothing at all, on every click, for
 * as long as it shipped: clicking "Week" from a month view produced
 * `?view=month&view=week`, `parseCalendarView` took `"month"`, and the page
 * re-rendered exactly as it was. A passing test asserted the `[0]` behaviour
 * was correct, so nothing flagged it.
 *
 * Deliberately not applied to `project.ts`, `search.ts` or `task.ts`'s own
 * parsers. Their forms carry no hidden input that a submit button overrides,
 * so those parameters cannot arrive twice from this app, and changing them
 * would be churn dressed as consistency. If one of those forms ever grows a
 * hidden-plus-submitter pair, it wants this function — and this paragraph is
 * how it gets found.
 */
export function lastParam(raw: string | string[] | undefined): string {
  if (Array.isArray(raw)) return raw[raw.length - 1] ?? "";
  return raw ?? "";
}
