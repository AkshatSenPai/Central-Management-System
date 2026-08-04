# Searchable combobox for entity pickers

**Runs after:** nothing. It depends on no unbuilt work and blocks none — it is the "Searchable project picker" entry in `TODO.md` (line 61), an owner request dated 2026-08-03.
**Delivers:** one primitive, `src/components/ui/combobox.tsx`, its pure half in `src/lib/combobox.ts`, and adoption at the three pickers whose option lists have no ceiling — Project and Milestone in the task form, Client in the project form.

## 1. Why now

`TODO.md:61` states the complaint exactly: the Project dropdown in the New/Edit task modal is a native `<select>`, "Fine at four projects, unusable at fifty — you cannot type to filter, only scroll."

The count is the argument. Of 20 `SelectField` call sites, fourteen pick from a fixed enum whose length is statically knowable and never exceeds six — `TASK_STATUSES` is 4 (`src/lib/task.ts:5`), `PROJECT_HEALTHS` is 3 (`src/lib/project.ts:15`), the longest is the six-item filter at `src/components/projects/project-filters.tsx:31`. **Six pick an entity from a list the database sizes**, and not one carries a `take`: `src/app/(app)/my-tasks/page.tsx:24-28` loads every non-DONE project, `src/app/(app)/projects/page.tsx:26` loads every client with no `where` clause at all.

The app has no machinery for this. `src/components/ui/` holds fourteen files and not one popover, dropdown or listbox primitive; there is no `src/hooks/`. Repo-wide there is **no `onKeyDown` in any component**, no `aria-activedescendant`, no `role="combobox"`. The three popovers that exist — `src/components/tasks/quick-add.tsx:40-54`, `src/components/shell/account-menu.tsx:84-98`, `src/components/shell/notification-bell.tsx:43-57` — are byte-identical Escape-and-outside-click effects with no arrow keys between them.

One standing decision reads against this and should be met rather than stepped around. `src/components/shell/search-box.tsx:13-16` says the global search box is "A plain GET form, not a live-suggest dropdown: it works without JavaScript, the result is a linkable URL, and it matches the filter convention used everywhere else in the app rather than inventing a keyboard model of its own." That holds and is not disturbed: it protects two properties a picker does not have. A picker lives inside `<TaskForm>`, which is `"use client"` (`src/components/tasks/task-form.tsx:1`) and controlled on purpose (`:90-93`), so it already fails without JavaScript, and its result is a form value rather than a URL. The keyboard model is invented here because no native control both filters and submits an id. Search-box needed neither and correctly declined.

## 2. Scope

**In:**

- `src/components/ui/combobox.tsx` — beside `field.tsx`, reusing that file's `fieldClass()` and its label/error `Wrap` so it inherits the design tokens rather than restating them.
- `src/lib/combobox.ts` — the filtering and active-index arithmetic, pure, so it is testable at all (§8).
- `src/components/ui/field.tsx` — **one line: `function Wrap(` at `:45` becomes `export function Wrap(`.** `fieldClass` (`:33`) and `FieldSize` (`:8`) are already exported; `Wrap` is not, and is referenced today only inside its own file (`:81`, `:100`, `:125`). Without this the bullet above cannot be implemented as written, and the alternative — a second label/error layout in `combobox.tsx` — is the thing §4 rejects. It widens `field.tsx`'s public surface by exactly one component and changes nothing about `Wrap` itself: same props, same `<label>`, and the same fragment fallback at `:54` (`if (!label && !error) return <>{children}</>`), inherited unchanged so a combobox with neither label nor error renders bare, exactly as `Field` does.
- Three adoptions: Project (`task-form.tsx:224`), Milestone (`:247`), Client (`src/components/projects/project-form.tsx:145`).

**Out:**

- **Status, priority and health.** They stay `SelectField` — ruled below (D1).
- **The other three entity pickers** — account lead (`src/components/clients/client-form.tsx:188`) and the calendar's person and project filters (`src/components/calendar/calendar-filters.tsx:106`, `:121`). The calendar pair are auto-submit selects, `defaultValue` plus `onChange={(e) => e.currentTarget.form?.requestSubmit()}` (`:110-111`, `:125-126`) — a different contract from a controlled modal field, and converting them raises a second question about whether a filter fires on highlight or on commit. Revisit once the three above have been used for a week.
- **The Assignees checkbox list** (`task-form.tsx:312-319`, `src/components/tasks/assignee-picker.tsx`). Explicitly deferred; no design offered here. It is multi-select with its own uncontrolled-checkbox contract, read back off the form by `handleFormChange` (`task-form.tsx:140-146`). A single-value combobox is not the shape of that problem.
- **A text search box on the `/projects` list page.** Explicitly deferred; no design offered here. That is filtering a rendered list, not choosing a form value, and it belongs with the URL-driven filter convention in `project-filters.tsx`.
- Multi-select, free-text entry, async option loading, virtualisation. This repo does no client-side data fetching — the reason is written out at `task-form.tsx:240-245` — and every option list is materialised server-side before the form renders. Fifteen people will not need windowing.

## 3. Owner rulings

| # | Decision |
|---|---|
| **D1** | **`SelectField` stays for the fourteen fixed-enum sites.** `TODO.md:63` prices the reason: "the browser gives keyboard support, mobile behaviour and accessibility for nothing. A combobox has to re-implement all three." The longest of those lists is six items and reads in one glance. Universal replacement was considered and rejected: it trades three free browser guarantees for a hand-written keyboard model on lists nobody has needed to filter, and puts a text input where a phone currently gets a native wheel. |
| **D2** | **`onChange` receives the id string, not a change event.** A deliberate divergence from `SelectField`, taken so the swap stays mechanical: all three call sites already unwrap `e.target.value` immediately (`task-form.tsx:229`, `:252`, `project-form.tsx:151`), so the event is a wrapper each discards on the next character. Mirroring the native signature was considered and rejected — there is no `HTMLSelectElement` behind this control, so a synthesised event would be a lie whose `target` pointed at a text input holding a *label*, not the value being reported. |
| **D3** | **A hidden `<input>` carries the id; the visible input has no `name` at all.** The typed text and the committed value are different strings and only one is the form's answer. Naming the visible input was considered and rejected: it would submit whatever half-word was in the box, and `taskSchema` (`src/lib/task.ts:65-72`) would accept "Harlo" as a `projectId` without complaint, because it validates shape and not existence. |
| **D4** | **The visible text is derived from `value`, not edited in place.** Whenever the user is not actively typing, the box reads `labelForValue(options, value)` — so the snap back to the selected label is a property of *not typing*, not of the blur event, and it therefore happens on every route out of a typed state: blur, Escape, click-to-close, commit, and an externally reset `value`. Half-typed text left on screen looks like a selection and is not one — the box would read "Harlo" while the form submitted the previous client. The derived rule also makes the visible input empty exactly when nothing is selected, which is what makes `required` honest (§4). Two alternatives were rejected: leaving the text alone (the likeliest way for someone to save the wrong client and never know), and hanging the restore off a blur handler alone, which misses the three closing paths that fire no blur and reads a `value` prop the commit has not updated yet (§5, "Typed text versus committed value"). |
| **D5** | **The list is not portalled.** It is `absolute`, inside a `relative` wrapper, inside the modal's scrolling body (`src/components/ui/modal.tsx:110`), which clips it at that body's bottom edge. Accepted, on two properties that are part of the ruling rather than assumed of it: the popover carries **`max-h-64 overflow-y-auto`**, so fifty clients scroll inside the listbox instead of growing an unbounded `absolute` box inside the modal body's own `max-h-[calc(100vh-76px)]` scroller (`modal.tsx:89`); and the active row is kept in view by **`scrollIntoView({ block: "nearest" })`** in an effect keyed to the active index. `"nearest"` is the load-bearing word — it scrolls only ancestors that actually need scrolling, so arrowing down scrolls the listbox and leaves the modal body where the user put it. Between them the clip is reachable by scrolling and the list tracks the field. A portal was considered and rejected — `<dialog>` + `showModal()` already puts the modal in the top layer (`modal.tsx:19-24`), so there is no z-index problem for it to solve, and it buys escape-from-clipping at the price of position syncing on every scroll and resize. |
| **D6** | **A selected id with no matching option renders blank and is still submitted.** The `<select>` it replaces fails the other way, documented at `src/app/(app)/tasks/[taskId]/page.tsx:38-42`: React's option reconciliation "falls back to selecting the first non-disabled option ... and the next save silently makes the task personal." A combobox reconciles nothing, so an unknown id simply has no label. Blank-but-preserved is the safe direction; silently-reassigned is not. The widened `where` at `:44-46` stays regardless — showing the name is still better than showing nothing. |

## 4. Component contract

The prop list is written out rather than spread from `InputHTMLAttributes`. That is why `field.tsx:64-68`'s `Omit<…, "size">` workaround is absent — nothing native is intersected, so `size` never collapses to `never`. Spreading was rejected for a second reason: it would let a caller pass `name` to the visible input and quietly defeat D3.

```tsx
/** Lives in src/lib/combobox.ts, not here: filtering is the only part of this
 * component that can be unit-tested (§8), and the type belongs with the
 * functions that consume it. combobox.tsx re-exports it so a call site
 * imports one thing. */
export type ComboboxOption = {
  /** The id that reaches the Server Action. "" is a legitimate value, not an
   * absence — task-form's project picker uses it for "No project (personal
   * task)" (task-form.tsx:231), and quick-add.tsx:83-93 documents why an
   * empty string beats an omitted field: formData.get() returns null for a
   * field the form never rendered, and the whole parse fails. */
  value: string;
  /** Displayed, typed against, and matched on. There is deliberately no
   * separate search key: a second field would let a picker match on text the
   * user cannot see, which reads as a bug rather than a feature.
   *
   * Labels are NOT assumed unique, and option rows are therefore keyed by
   * `value` — never by label, never by array index. Index keys would
   * re-associate rows onto different options as the filter narrows. Duplicates
   * are reachable in the Project picker specifically: schema.prisma:163
   * constrains project names per client (@@unique([clientId, name])) while
   * my-tasks/page.tsx:24-28 loads every non-DONE project across all clients
   * with no client scoping, so two clients each with a "Website Rebuild"
   * produce two identical rows, and labelForValue returns the first match for
   * either id. Accepted as-is: the <select> being replaced is ambiguous in
   * exactly the same way and by the same query, so this ships no regression.
   * Disambiguating by client name is out of scope — raise it as its own item
   * if anyone hits it. (Client.name is @unique at schema.prisma:114, so the
   * Client picker cannot collide.) */
  label: string;
};

export function Combobox(props: {
  /** The same three Field/SelectField props, forwarded untouched to
   * field.tsx's Wrap — which §2 exports for this, since it is module-private
   * today. A second label/error layout would drift from that one within a
   * phase, and Wrap already owns the rule that the label pairing carries the
   * top margin (field.tsx:38-40). */
  label?: string;
  error?: string | null;
  size?: FieldSize;
  /** Appended last by fieldClass(), so the call site wins. Width belongs to
   * the call site (field.tsx:10-14); all three adoptions pass "w-full". */
  className?: string;
  /** The name of the HIDDEN input. The visible one is never named — D3. */
  name: string;
  /** Controlled, like every field in these two forms: React 19 resets the
   * form once the action resolves and the fields re-read from component state
   * (task-form.tsx:90-101). An uncontrolled combobox would lose the selection
   * on the failed submit that made the user look at it. */
  value: string;
  /** The id, not a change event — D2. */
  onChange: (value: string) => void;
  /** Rendered in the order given, never re-sorted or re-ranked: the server
   * already sorted by name (my-tasks/page.tsx:27, projects/page.tsx:26), and
   * a picker whose rows move as you type is one you cannot aim at. */
  options: ComboboxOption[];
  /** Shown when value is "" and "" is not itself an option. This is where
   * project-form's disabled sentinel lands (project-form.tsx:153-155): a
   * prompt that can never be chosen. Adding `disabled` to ComboboxOption was
   * considered and rejected — one call site, and its only job was this
   * string. */
  placeholder?: string;
  /** Goes on the VISIBLE input, which is focusable and can therefore show the
   * browser's validation bubble; a hidden input is barred from constraint
   * validation and would enforce nothing. D4's derived text is what makes it
   * honest — the visible input is non-empty exactly when a selection exists,
   * because it is a function of `value` rather than of what was typed. Only
   * project-form.tsx:149 passes it. */
  required?: boolean;
  /** Forwarded to the VISIBLE input only, and never to the hidden one. The
   * hidden input always renders and always submits, disabled or not. A
   * disabled control is skipped when the form's entry list is built, so a
   * disabled hidden input drops the field out of FormData entirely:
   * formData.get("projectId") returns null rather than "", and taskSchema's
   * `.optional().or(z.literal(""))` (task.ts:68) rejects null — the whole
   * parse fails with "Invalid input" on a field the user cannot even see.
   * That is the exact trap quick-add.tsx:83-93 documents and the `value` doc
   * above cites. Nothing is lost by the split: disabled:opacity-50 comes from
   * fieldClass (field.tsx:18) and already lives on the visible input, and the
   * list cannot be opened because the control it opens from is disabled. This
   * parallels `required`, which is visible-input-only for the same structural
   * reason. No adoption passes `disabled` today; it is specified rather than
   * left implicit so the first one to pass it does not discover this. */
  disabled?: boolean;
})
```

Two structural constraints the markup must respect. **Everything inside `Wrap` is a `<span>`** — `Wrap` renders a `<label>`, and `field.tsx:41-44` states why: a `<label>` may not contain block elements without breaking its implicit association with the control. The popover is a `<span role="listbox">`, each row a `<span role="option">`; not `<div>`, not `<ul>`, not `<li>`. And **options commit on `mousedown` with `preventDefault()`**, not on `click`: it stops the input blurring between the press and the pick, which would fire D4's restore first and discard the selection.

That handles focus but not the enclosing `<label>`, which needs its own defence and a second `preventDefault()`. All three adoptions pass `label`, so `Wrap` renders a real `<label>` (`field.tsx:56`) around both the input and the popover — and a label's forwarding is dispatched from the `click` event, not from `mousedown`, so cancelling the mousedown default does not suppress it. Nor does the row's markup opt out of it: a `<span role="option">` is not interactive content, so the label does not skip forwarding the way it would over a `<button>` — and gate 2 forbids the `<button>` anyway (§9). The forwarded synthetic click lands on the visible input, which is the only labelable element in the label (a hidden input is not labelable), and whose handler per §5 toggles the list — so a mouse pick would commit, close, and instantly reopen. **The option row therefore calls `preventDefault()` on `click` as well as on `mousedown`**: mousedown for the commit and to hold focus, click to cancel the label's activation behaviour before it forwards. Moving the field's toggle from `click` to `mousedown` would also work and was rejected as the more surprising of the two — it puts the field's own behaviour on a different event from every other click handler in the app to fix a problem that belongs to the row.

`combobox.tsx` carries **no `"use client"` directive**, matching `field.tsx`, which has none either. Verified in `node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-client.md:10`: "You do not need to add the `'use client'` directive to every file that contains Client Components. You only need to add it to the files whose components you want to render directly within Server Components." Both adopters are already client entry points (`task-form.tsx:1`, `project-form.tsx:1`).

The hidden input leaves the Server Action contract untouched. `node_modules/next/dist/docs/01-app/02-guides/forms.md:16` — the action "automatically receives the `FormData` object" — and `:126` names hidden inputs as the way to pass a value, with the caveat that "the value will be part of the rendered HTML and will not be encoded." That changes no exposure: those ids are in the rendered HTML today as `<option value>` attributes. No claim is made about React 19's post-action form reset beyond what the code already asserts (`task-form.tsx:96-101`, `project-form.tsx:72-75`); the combobox inherits the `key={attempt}` remount that comment prescribes and relies on nothing the app is not already relying on — and relies on it for less than it might look, since §6 records that the remount reaches only the rejected-submit path and §5's derived text carries the other two.

## 5. Behaviour and keyboard model

Filtering is **case-insensitive substring match on the trimmed query against `label`**, in the given order. Nothing is ranked. `rankHits` and `matchRank` (`src/lib/search.ts:35-58`) exist and are deliberately not reused: they order a results page across three kinds, where reordering is the value. In a picker, reordering means the project that was third is now first while you are reaching for it. The `""` sentinel is an ordinary option and filters like any other — typing "personal" finds "No project (personal task)", which the native select only reaches by scrolling to the top.

**Typed text versus committed value.** Three strings are in play and only one of them is the form's answer, so they are named here rather than left to the implementation:

- **`value`** — the prop, owned by the parent, committed. The hidden input renders it verbatim, always.
- **`query`** — internal state, `string | null`. `null` means *the user is not typing*.
- **the visible input's text** — derived on every render, never separately stored: `query ?? labelForValue(options, value)`.

The filter runs against `query ?? ""`, **not** against the displayed text. That distinction is the whole point of splitting them: when the list opens without a keystroke — a click, or the first `ArrowDown`/`ArrowUp` — the query is empty, so the **full list opens**, not the single row matching the label already sitting in the box. A picker that opened onto one row and made you select-all-and-delete before you could browse would barely improve on the "unusable at fifty" complaint that motivates this spec (`TODO.md:61`). The text is selected on open, so the first keystroke replaces the label rather than appending to it; when the list closes with nothing typed, the derived text is unchanged and the selection is untouched.

`query` returns to `null` on a commit, on any close, and on **any change to the `value` prop**. That last clause is load-bearing twice over:

- It is what covers `cancel()` (`task-form.tsx:131-134`, `project-form.tsx:99-102`) and the successful-create branch (`task-form.tsx:107-110`, `project-form.tsx:81-84`). Both reset `values` **without** bumping `attempt`, so neither remounts, and `modal.tsx` cannot help — the `<dialog>` at `:69-118` renders `{children}` unconditionally, with no early return on `!open`, so the combobox stays mounted across close and reopen. Without the rule, creating a task with a project and reopening New task would show a box reading "Harlow Website Rebuild" over a hidden input submitting `""`.
- It is why the restore after a commit reads the **just-committed** id and not a `value` captured before it. There is no blur handler racing the parent's state update: `Tab` commits and then blurs, `Enter` may be followed by `Tab`, and a mousedown pick blurs too — all three land on the same derived render, because the text is a function of the current `value` rather than a string written by whichever handler ran first.

**The active index.** `-1` means *nothing is active*: `Enter` and `Tab` commit nothing, and `aria-activedescendant` is omitted. It is set two ways and only two:

- **The list opened without a keystroke** (click, first arrow) — `initialActiveIndex(options, value)`: the index of `value` in the list as it opens, which is the full list because the query is empty, or `-1` when `value` matches no option. Opening at the current selection is why a click or an arrow cannot silently replace it. In the Client picker `""` is the placeholder and *not* an option (§7), so a fresh picker opens at `-1` and tabbing straight back out commits nothing — where a default of 0 would have written the alphabetically-first client over whatever was there, with no keystroke that expressed intent.
- **The user typed** — 0, or `-1` when the filtered list is empty.

| Key or event | Behaviour |
|---|---|
| Typing | Opens the list, re-filters, and resets the active index to 0 — or to `-1` when nothing matches, in which case `aria-activedescendant` is omitted entirely and `Enter` commits nothing (§6). |
| `ArrowDown` | Opens the list if closed, with an empty query and the active index at the current selection; otherwise moves the active index down, clamped at the last match. |
| `ArrowUp` | Opens the list if closed, the same way; otherwise moves the active index up, clamped at 0. |
| `Enter`, list open | Commits the active option and closes. Calls `preventDefault()`, or the keypress also submits the form from inside a picker. At `-1` it commits nothing and still closes. |
| `Enter`, list closed | **Not intercepted.** No `preventDefault()`; the key reaches the form and submits it, exactly as it does from the Title and Name fields. |
| `Escape`, list open | Closes the list and restores the selected option's label. The selection is not cleared. Calls `preventDefault()` **and** `stopPropagation()`. |
| `Escape`, list closed | **Not intercepted at all** — it falls through to the browser's `<dialog>` close request, which is what `modal.tsx:74-78` depends on. |
| `Tab` | Commits the active option if the list is open and the active index is not `-1`, closes, and lets focus move on normally. Never `preventDefault()`ed; focus must move. |
| Blur | Closes. The text is derived, so it reads the selected label again without a handler writing it — D4. |
| Click on the field | Opens the list if closed; does nothing if already open. It never closes — a click inside an open box is the user placing the caret in their own query, and closing there would discard it. Blur, Escape, commit and outside-click close. |
| Focus | **Does not open the list.** |

**Click does not close, reversing an earlier draft of this table.** The draft had click toggle, which meant any click inside a typed query discarded it — caret repositioning and dismissal are not the same gesture, and only one of them is what a click inside a focused text input means. Owner ruling, 2026-08-04.

Three of those rows are not arbitrary, and two of them turn on a condition rather than a key.

**Escape calls `preventDefault()` and `stopPropagation()` only while the list is open.** With the list open, an un-prevented Escape closes the whole New task modal and discards everything typed into it, because `modal.tsx:74-78` records that the app depends on the browser's own Escape handling to close the `<dialog>`; `stopPropagation()` is belt-and-braces against the document-level Escape listeners at `quick-add.tsx:43`, `account-menu.tsx:87` and `notification-bell.tsx:46`, which wrap no combobox today and would each swallow one silently if they ever did. With the list **closed**, the handler returns without touching the event. That qualifier is not a detail: focus does not leave the combobox when the list closes, so the second Escape arrives at the same `onKeyDown`, and a rule stated for "Escape" as such would swallow that one too — leaving a modal that cannot be dismissed by keyboard at all whenever the caret sits in a picker.

**`Enter` calls `preventDefault()` only while the list is open**, for the same shape of reason in the other direction. Open, it must not both pick an option and submit the form. Closed, suppressing it would be a silent regression against the `<select>` this replaces, where Enter submits the enclosing form: the Project, Milestone and Client fields would become the three places in the app where Enter does nothing. Nothing here is worth that, and D1's accounting of surrendered native behaviours does not include it.

**Focus does not open the list** because `modal.tsx:64` focuses the first non-hidden field automatically; open-on-focus would drop a list of every client over the Name and Description fields the instant the New project modal appeared.

Accessibility is written by hand, because the native select was giving it away free: `role="combobox"` on the visible input with `aria-expanded`, `aria-controls` pointing at the listbox and `aria-activedescendant` at the active row; `role="listbox"` on the popover; `role="option"` with `aria-selected` on each row. Ids come from React's `useId` — the first use in this repo, so there is no house pattern to follow and this sets it.

Three details of that are spelled out rather than left to taste, because each has a silent wrong answer:

- **`aria-activedescendant` is omitted, not emptied.** Whenever the active index is `-1` or the list is closed, the attribute is not rendered at all. `aria-activedescendant=""` and an id pointing at no element are both IDREF errors, and the failure mode is a screen reader that announces nothing and gives no sign why.
- **`aria-controls` is rendered only while the list is open**, because the popover is only in the DOM while it is open — there is no hidden listbox for a collapsed combobox to point at. `aria-expanded="false"` carries the collapsed state on its own.
- **The empty row is `role="option"` with `aria-disabled="true"`.** It is a listbox child, so it must be an option or the listbox has an invalid child that many readers skip entirely; `aria-disabled` is what makes "non-interactive" true in the accessibility tree rather than only in the styling. It is never the active descendant, never counted by `nextActiveIndex`, and cannot be committed by `Enter`, `Tab` or a click.

## 6. Edge cases, empty and error states

- **No options at all**: the list opens onto one non-interactive row reading `No options`. Distinct from no matches, and reachable — a fresh install has zero clients, and `project-form.tsx:144` renders the picker whenever `clients` is present, empty or not.
- **No matches**: one non-interactive row reading `Nothing matches “xyz”` — the same words and the same typographic quotes as `searchSummary` (`src/lib/search.ts:75`, `` return `Nothing matches “${term}”` ``), so the app really does say this the same way twice. Character for character, including the curly `“` and `”`; a straight-quoted "No matches for" variant would be a second phrasing of one idea, which is the opposite of the point. §8 and §10 quote this same literal. The active index is `-1`, `Enter` commits nothing, the hidden input keeps the last committed id.
- **Selected id absent from `options`**: blank box, hidden input unchanged (D6).
- **Loading: there is none, by construction.** Every option list is materialised by the server component before the form renders (`my-tasks/page.tsx:22-32`, `projects/page.tsx:24-27`), and this repo does no client-side fetching (`task-form.tsx:240-245`). A spinner would be a state the component cannot enter.
- **Error**: `error` is display-only, straight through to `Wrap`. The combobox validates nothing. No adoption passes it today — both forms report action failures through `<FormError>` above the fields (`task-form.tsx:201`, `project-form.tsx:142`) — and the prop exists so a picker-specific message has somewhere to sit without a second layout being invented for it.
- **The `attempt` remount covers one path, and only one.** `<form key={attempt}>` (`task-form.tsx:188`, `project-form.tsx:139`) discards the combobox's open/typed/active state after a **rejected** submit, and the box re-reads `value` and shows the committed label — the re-sync that remount exists to force. But `attempt` increments only on failure (`task-form.tsx:111-113`, `project-form.tsx:85-87`), while `values` is also reset by `cancel()` (`:131-134`, `:99-102`) and by the successful-create branch (`:107-110`, `:81-84`), neither of which remounts anything. `modal.tsx` does not cover the gap either: the `<dialog>` at `:69-118` always renders `{children}`, with no early return on `!open`, so the component survives close and reopen intact. Those two paths are handled by §5's derived-text rule instead — the visible text is a function of the current `value`, and `query` clears whenever `value` changes — not by the remount. Read the remount as an optimisation of a rule that already holds, rather than as the thing keeping the box honest.
- **Every keystroke bubbles into `handleFormChange`** (`task-form.tsx:140-146`). It tests `target.name === "userId"` and does nothing otherwise; the visible input has no `name` at all (D3), so it cannot collide even accidentally.
- **Initial focus does not move.** `modal.tsx:64` takes the first match of `"input:not([type=hidden]), select, textarea"` in document order. In New task that is the Title input (`task-form.tsx:203`), which precedes the Project picker; in New project it is the client `<select>` (`project-form.tsx:145`), whose position the visible input takes exactly. Same field, both times.
- **The project → milestone cascade survives verbatim.** `task-form.tsx:229` is the one place the `set` helper is bypassed; under D2 it becomes `onChange={(id) => setValues((v) => ({ ...v, projectId: id, milestoneId: "" }))}` — same shape, one fewer unwrap. The independent guard at `:246` and its hidden `milestoneId` fallback at `:262` are untouched.
- **`clientId` derivation is untouched and must stay so.** `task-form.tsx:119-125` derives `derivedClientId` from `values.projectId` and the `projects` array, whose `ProjectOption` (`:32`) carries `clientId`. `ComboboxOption` has only `value` and `label`, so the call site maps `projects` into options for display and keeps `projects` for the lookup — which is what `:120` already does. Dropping `clientId` on the way through breaks revalidation, not validation, and fails silently.
- **An empty `clientId` still fails no validation.** `projectSchema` (`src/lib/project.ts:31-44`) has no `clientId` field and `createProjectAction` reads it raw (`src/server/actions/projects.ts:47`). That hole predates this work and is not widened by it — `required` plus D4 keeps the client picker at least as strict as the disabled-sentinel select it replaces. Named here so nobody credits this spec with closing it.

## 7. Adoption

| Call site | Today | After |
|---|---|---|
| `task-form.tsx:224` | `SelectField` + selectable sentinel `""` = "No project (personal task)" (`:231`) + `projects.map` | `<Combobox label="Project" name="projectId" value={values.projectId} onChange={(id) => …} options={[{ value: "", label: "No project (personal task)" }, …]} className="w-full" />` |
| `task-form.tsx:247` | `SelectField` + selectable sentinel `""` = "No milestone" (`:254`) + `milestones.options.map` | Same shape, `name="milestoneId"`, sentinel first, still under the unchanged `values.projectId === milestones.projectId` guard. |
| `project-form.tsx:145` | `SelectField required` + **disabled** sentinel "Select a client" (`:153-155`) + `clients.map` | `<Combobox label="Client" name="clientId" required placeholder="Select a client" …>` — the sentinel becomes the placeholder and leaves `options` entirely, so it is not merely unselectable but absent. |

Everything else keeps `SelectField` (D1). The picker still appears only where it appears today: `project-form.tsx:144` suppresses the client picker whenever `fixedClientId` is set (`:93`), which is every edit and every `/clients/[clientId]` create.

## 8. Testing

`vitest.config.ts` is twelve lines: `environment: "node"`, `include: ["tests/**/*.test.ts"]`, no `setupFiles`, no globals, no plugins. `jsdom`, `happy-dom`, `@testing-library/*` and `@vitejs/plugin-react` appear nowhere in `package.json`; a `.test.tsx` file would not even be collected. **Component rendering is not testable in this repo**, and this spec does not pretend otherwise.

So the logic moves out. `src/lib/combobox.ts` exports the option type and five pure functions, leaving `combobox.tsx` as the part that only wires them to the DOM:

```ts
export function filterOptions(options: ComboboxOption[], query: string): ComboboxOption[];
export function initialActiveIndex(options: ComboboxOption[], value: string): number;
export function nextActiveIndex(current: number, delta: number, count: number): number;
export function labelForValue(options: ComboboxOption[], value: string): string;
export function emptyMessage(query: string, hasOptions: boolean): string;
```

`initialActiveIndex` is the fifth because `nextActiveIndex(current, delta, count)` structurally cannot express "open at the current selection" — nothing passes it the selected value. Widening that signature instead was rejected: it would take a `value` and an `options` array purely to serve one caller that never moves anything, and the arithmetic function would stop being about arithmetic.

`tests/combobox.test.ts`, flat with the other 40, covering: an empty or whitespace-only query returns every option in order; matching is case-insensitive ("har" finds "Harlow & Fitch") and substring rather than prefix ("fitch" finds it too); the `""` sentinel filters like any other option ("personal" finds "No project (personal task)"); order is preserved and never re-ranked — the standing guard against someone reaching for `rankHits`; `nextActiveIndex` clamps at both ends without wrapping and returns `-1` for an empty list, so `Enter` has nothing to commit; `initialActiveIndex` returns the index of the selected value, `0` for a `""` sentinel that *is* an option (the Project and Milestone pickers), and `-1` for a value matching no option — which is both D6's absent id and the Client picker's unselected `""`, the case that stops a bare open-then-Tab writing the first client over the real one; the §5 pairing that typing resets the active index to `0` but to `-1` over an empty filtered list, asserted as one test so the two rules cannot drift apart again; `labelForValue` returns `""` for an id absent from the options (D6) and the label when present; `emptyMessage` distinguishes `No options` from `Nothing matches “xyz”`, asserted against the exact literal including the curly quotes, so it stays word-for-word with `searchSummary` (`search.ts:75`).

There is no `comboboxClass()` to test — the class string comes from `fieldClass()`, already covered at `tests/ui-class.test.ts:87-130`, including that it is not full-width by default and that caller classes are appended last, both of which this component depends on.

**What this does not test, stated plainly:** key handling, focus movement, the derived-text restore, the aria wiring, and the Escape-versus-`<dialog>` interaction. Browser QA carries all five, as it has carried components since Phase 1 and as the design-application spec §8 re-affirmed when it made the variant→className mapping its one exception. Adding `jsdom` + `@testing-library/react` + `@vitejs/plugin-react` was considered and rejected: three devDependencies and a second rendering environment to keep in step with React 19, to test a control the QA pass exercises anyway. Revisit if a second interactive primitive lands with the same untestable core — one is a special case, two is a gap in the test setup.

## 9. Gates and vocabulary lock

**No new icons and no new activity verbs.** The chevron is `expand_more`, already in `ICON_NAMES` (`src/lib/icons.ts:35`) and already rendered at `account-menu.tsx:111`, so gates 7 and 8 are unaffected and the font is not regenerated. This change writes no data, so `ActivityAction` and `describeActivity` are untouched.

- **Gate 3** exempts `src/components/ui/*` (`scripts/gates.mjs:74`). The combobox's raw `<input>` is legal there and nowhere else — the mechanical argument for building it as a primitive rather than inline in `task-form.tsx`, where identical markup would fail.
- **Gate 2** (`gates.mjs:66`): option rows are `<span role="option">`, never `<button>`. The ARIA pattern requires the same thing independently.
- **Gate 6** (`gates.mjs:96`): the popover uses `shadow-[var(--shadow-lg)]`, matching the three existing popovers (`quick-add.tsx:77`). Tailwind's built-in `shadow-lg` fails, and gate 1 cannot catch it because no hex is involved.
- **Gate 1** (`gates.mjs:62`) covers `src/**/*.ts` as well as `.tsx` and is **not** comment-stripped — `stripComments` wraps gates 2, 3, 6 and 9 only. Doc comments in `src/lib/combobox.ts` must contain nothing shaped like a hex colour.
- **Gate 5 is deliberately not extended.** It greps three named files for the literal `focus-visible:shadow-[var(--ring)]` (`gates.mjs:101-102`). `combobox.tsx` takes its ring from `fieldClass()` and will never contain that literal, so adding it to the list fails the gate on a compliant file. Hardcoding the literal to satisfy the gate was considered and rejected: it would be a second declaration of the focus ring, the exact duplication the primitive layer was extracted to remove (design-application spec §3, "Focus, declared once").

## 10. Success criteria

- [ ] Typing "har" in the Client picker narrows the list to the options containing it, in the order the server sorted them, with no row moving for any other reason.
- [ ] `ArrowDown` and `ArrowUp` move the highlight without wrapping; `Enter` with the list open picks the highlighted option and does not submit the form.
- [ ] `Enter` with the list **closed** submits the form, the same as it does from the Title field. The picker is not the one place in the app where Enter does nothing.
- [ ] `Escape` with the list open closes only the list and restores the previously selected label. A second `Escape` closes the modal.
- [ ] `Tab` commits the highlighted option and moves focus to the next field.
- [ ] Opening a picker and pressing `Tab` without arrowing or typing leaves the selection unchanged — including the Client picker with nothing selected yet, which must not silently commit the first client. Same by click-then-`Tab`.
- [ ] Reopening a picker that already has a selection shows **every** option, not just the row matching the label in the box, and the highlight starts on the current selection.
- [ ] Typing "Harlo" and clicking elsewhere leaves the box reading the selected client's full name, never "Harlo".
- [ ] Typing "Harlo" and clicking between two characters in the box repositions the caret and keeps both the query and the open list — it does not close or reset.
- [ ] Picking an option with the mouse commits it and closes the list, and the list does not immediately reopen.
- [ ] Choosing a project clears the milestone, exactly as the `<select>` did.
- [ ] Saving a task with no project submits `projectId=""` and `createTaskAction` accepts it.
- [ ] Editing a task whose project is DONE shows that project's name, and saving does not silently make the task personal.
- [ ] Create a task with a project, save, then reopen New task — the Project box reads "No project (personal task)", not the project just saved. The modal never unmounts, so this is the box tracking `value` rather than the remount doing it.
- [ ] Edit a task, change its project, press Cancel, reopen — the box reads the project the task actually has.
- [ ] With fifty options, arrowing to the last one keeps it visible inside the list and does not scroll the modal body underneath it.
- [ ] The New project modal opens with focus in the Client box and the list closed.
- [ ] A screen reader announces the control as a combobox, reports expanded and collapsed, and reads each option as the arrows move over it. It also announces both empty states, and says nothing misleading when the filter matches nothing — no stale or empty `aria-activedescendant` pointing at a row that is not there.
- [ ] An empty list says `No options`; a query with no hits says `Nothing matches “…”`, with the same curly quotes as the search page; the two are never confused.
- [ ] All three pickers checked at phone width — D1's boundary costs these three the native wheel, and that should be looked at rather than assumed acceptable.
- [ ] Both themes; the popover uses the shadow token, so it reads correctly in dark.
- [ ] Status, priority and health are still native selects.
- [ ] `npm run gates`, `npm test`, `npx tsc --noEmit`, `npm run lint` and `npm run build` all clean.
