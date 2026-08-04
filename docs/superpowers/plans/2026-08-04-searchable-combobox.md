# Searchable Combobox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three unbounded entity `<select>`s — Project and Milestone in the task form, Client in the project form — with a type-to-filter combobox built once as a UI primitive.

**Architecture:** All testable logic lives in a pure `src/lib/combobox.ts` (five functions, no DOM, no React). `src/components/ui/combobox.tsx` wires those to the DOM and owns the keyboard model, the popover and the ARIA wiring. The visible input carries no `name`; a hidden input carries the chosen id, so the existing Server Action `FormData` contract is untouched. The visible text is *derived* from the `value` prop rather than stored, which is what makes every close path restore the selected label.

**Tech Stack:** React 19, Next.js 16.2.12, TypeScript, Tailwind v4, Vitest (node environment).

**Spec:** `docs/superpowers/specs/2026-08-03-searchable-combobox-design.md`. Read §3 (rulings) and §5 (keyboard model) before starting. Where this plan and the spec disagree, the spec wins — report the conflict rather than choosing.

## Global Constraints

- **No `"use client"` in `combobox.tsx`.** `field.tsx` has none either; both adopters are already client entry points (`task-form.tsx:1`, `project-form.tsx:1`). Verified in `node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-client.md:10`.
- **Everything inside `Wrap` must be a `<span>`.** `Wrap` renders a `<label>`, and `field.tsx:41-44` states that a `<label>` may not contain block elements without breaking its implicit control association. The popover is `<span role="listbox">`, each row `<span role="option">`. Not `<div>`, not `<ul>`, not `<li>`.
- **Gate 2** (`scripts/gates.mjs:66`): option rows are never `<button>`.
- **Gate 6** (`gates.mjs:96`): the popover shadow is `shadow-[var(--shadow-lg)]`, never Tailwind's `shadow-lg`.
- **Gate 3** exempts `src/components/ui/*` (`gates.mjs:74`) — the raw `<input>` is legal there and nowhere else.
- **Gate 1** (`gates.mjs:62`) covers `src/**/*.ts` and is **not** comment-stripped. No doc comment in `src/lib/combobox.ts` may contain anything shaped like a hex colour.
- **Gate 5 is not extended.** `combobox.tsx` takes its focus ring from `fieldClass()` and will never contain the literal `focus-visible:shadow-[var(--ring)]`. Adding it to the gate's file list would fail the gate on a compliant file.
- **No new icons.** The chevron is `expand_more`, already in `ICON_NAMES` (`src/lib/icons.ts:35`).
- **Empty-state copy is exact, including curly quotes:** `No options` and `Nothing matches “…”`. The second must be character-for-character identical to `searchSummary` (`src/lib/search.ts:75`).

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/combobox.ts` (create) | `ComboboxOption` type + five pure functions. The only unit-testable part. |
| `tests/combobox.test.ts` (create) | Unit tests for the above. Flat, alongside the other 40. |
| `src/components/ui/field.tsx` (modify, 1 line) | `function Wrap(` at `:45` becomes `export function Wrap(`. |
| `src/components/ui/combobox.tsx` (create) | The primitive: markup, derived text, keyboard, ARIA. |
| `src/components/tasks/task-form.tsx` (modify) | Project picker `:224`, Milestone picker `:247`. |
| `src/components/projects/project-form.tsx` (modify) | Client picker `:145`. |

**Testability boundary, stated plainly:** Tasks 1–2 are true TDD. Tasks 3–6 have **no unit tests** because this repo cannot render components in tests (`vitest.config.ts` is `environment: "node"`, and `jsdom` / `@testing-library/*` / `@vitejs/plugin-react` are absent from `package.json`). Their gate is `npx tsc --noEmit`, `npm run lint`, `npm run gates`, and the browser QA in Task 7. Do not add test dependencies to work around this — §8 of the spec considered and rejected that.

---

### Task 1: Pure option functions

**Files:**
- Create: `src/lib/combobox.ts`
- Create: `tests/combobox.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type ComboboxOption = { value: string; label: string }`, `filterOptions(options: ComboboxOption[], query: string): ComboboxOption[]`, `labelForValue(options: ComboboxOption[], value: string): string`, `emptyMessage(query: string, hasOptions: boolean): string`.

- [ ] **Step 1: Write the failing tests**

Create `tests/combobox.test.ts`:

```ts
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
    expect(emptyMessage("xyz", true)).toBe("Nothing matches “xyz”");
  });

  it("trims the query it echoes", () => {
    expect(emptyMessage("  xyz  ", true)).toBe("Nothing matches “xyz”");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run tests/combobox.test.ts
```

Expected: FAIL — cannot resolve `@/lib/combobox`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/lib/combobox.ts`:

```ts
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
  return `Nothing matches “${query.trim()}”`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run tests/combobox.test.ts
```

Expected: PASS, 13 tests.

- [ ] **Step 5: Confirm gate 1 tolerates the doc comments**

```bash
npm run gates
```

Expected: 9/9. Gate 1 is not comment-stripped for `src/**/*.ts`, so this confirms no doc comment reads as a hex colour.

- [ ] **Step 6: Commit**

```bash
git add src/lib/combobox.ts tests/combobox.test.ts
git commit -m "feat: pure option functions for the combobox primitive"
```

---

### Task 2: Active-index arithmetic

**Files:**
- Modify: `src/lib/combobox.ts`
- Modify: `tests/combobox.test.ts`

**Interfaces:**
- Consumes: `ComboboxOption` from Task 1.
- Produces: `initialActiveIndex(options: ComboboxOption[], value: string): number`, `nextActiveIndex(current: number, delta: number, count: number): number`.

`-1` means *nothing is active* throughout: `Enter` and `Tab` commit nothing, and `aria-activedescendant` is omitted rather than emptied.

- [ ] **Step 1: Write the failing tests**

Append to `tests/combobox.test.ts`, and add `initialActiveIndex` and `nextActiveIndex` to the existing import:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run tests/combobox.test.ts
```

Expected: FAIL — `initialActiveIndex` and `nextActiveIndex` are not exported.

- [ ] **Step 3: Write the minimal implementation**

Append to `src/lib/combobox.ts`:

```ts
/** Where the highlight sits when the list opens with no keystroke — a click,
 * or the first arrow. Opening at the current selection is why neither of
 * those can silently replace it.
 *
 * This exists separately from nextActiveIndex because that function takes a
 * count and cannot express "open at the current selection" — nothing passes
 * it the selected value. Widening its signature was rejected: it would take
 * an options array purely to serve one caller that never moves anything, and
 * the arithmetic function would stop being about arithmetic. */
export function initialActiveIndex(options: ComboboxOption[], value: string): number {
  return options.findIndex((option) => option.value === value);
}

/** Arrow-key movement. Clamps at both ends rather than wrapping: a list that
 * jumps from the last row back to the first is one you overshoot. -1 in and
 * -1 out for an empty list, so Enter has nothing to commit. */
export function nextActiveIndex(current: number, delta: number, count: number): number {
  if (count <= 0) return -1;
  const next = current + delta;
  if (next < 0) return 0;
  if (next >= count) return count - 1;
  return next;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run tests/combobox.test.ts
```

Expected: PASS, 22 tests.

- [ ] **Step 5: Run the full suite**

```bash
npm test
```

Expected: all suites pass, count risen from 650.

- [ ] **Step 6: Commit**

```bash
git add src/lib/combobox.ts tests/combobox.test.ts
git commit -m "feat: active-index arithmetic for the combobox primitive"
```

---

### Task 3: Export `Wrap`, and build the combobox shell

**Files:**
- Modify: `src/components/ui/field.tsx:45`
- Create: `src/components/ui/combobox.tsx`

**Interfaces:**
- Consumes: everything from `src/lib/combobox.ts`; `fieldClass`, `FieldSize` and now `Wrap` from `./field`.
- Produces: `Combobox` — the component, with markup, derived text, the hidden input and mouse interaction. **No keyboard handling yet** (Task 4) and **no ARIA wiring yet** (Task 5).

**No unit tests in this task.** See the testability boundary above. `tsc`, `lint` and `gates` are the gate.

- [ ] **Step 1: Export `Wrap` from field.tsx**

At `src/components/ui/field.tsx:45`, change:

```tsx
function Wrap({
```

to:

```tsx
export function Wrap({
```

Nothing else in that file changes. `fieldClass` (`:33`) and `FieldSize` (`:8`) are already exported. `Wrap`'s fragment fallback at `:54` (`if (!label && !error) return <>{children}</>`) is inherited unchanged, so a combobox with neither label nor error renders bare exactly as `Field` does.

- [ ] **Step 2: Create the component shell**

Create `src/components/ui/combobox.tsx`:

```tsx
import { useEffect, useId, useRef, useState } from "react";
import {
  emptyMessage,
  filterOptions,
  initialActiveIndex,
  labelForValue,
  type ComboboxOption,
} from "@/lib/combobox";
import { fieldClass, Wrap, type FieldSize } from "./field";
import { Icon } from "./icon";

export type { ComboboxOption };

/** A type-to-filter picker for entity lists the database sizes. Deliberately
 * NOT a replacement for SelectField, which stays on the fourteen fixed-enum
 * sites: the browser gives keyboard support, mobile behaviour and
 * accessibility away free on a native select, and a list of four statuses is
 * not worth re-implementing all three for.
 *
 * No "use client" directive, matching field.tsx. Both adopters are already
 * client entry points.
 *
 * The props are written out rather than spread from InputHTMLAttributes. That
 * is why field.tsx's Omit<..., "size"> workaround is absent here — nothing
 * native is intersected, so `size` never collapses to never. Spreading would
 * also let a caller pass `name` to the visible input and quietly defeat the
 * hidden-input contract below. */
export function Combobox({
  label,
  error,
  size,
  className,
  name,
  value,
  onChange,
  options,
  placeholder,
  required,
  disabled,
}: {
  label?: string;
  error?: string | null;
  size?: FieldSize;
  className?: string;
  /** The name of the HIDDEN input. The visible one is never named: the typed
   * text and the committed value are different strings, and only one of them
   * is the form's answer. A named visible input would submit whatever
   * half-word was in the box, and taskSchema would accept "Harlo" as a
   * projectId without complaint, because it validates shape and not
   * existence. */
  name: string;
  value: string;
  /** The id, not a change event. Every call site already unwrapped
   * e.target.value immediately, and there is no HTMLSelectElement behind this
   * control for a synthesised event to honestly describe. */
  onChange: (value: string) => void;
  /** Rendered in the order given, never re-sorted: the server already sorted
   * by name, and a picker whose rows move as you type is one you cannot aim
   * at. */
  options: ComboboxOption[];
  /** Shown when value is "" and "" is not itself an option. This is where
   * project-form's disabled sentinel lands: a prompt that can never be
   * chosen. */
  placeholder?: string;
  /** Goes on the VISIBLE input, which is focusable and can therefore show the
   * browser's validation bubble; a hidden input is barred from constraint
   * validation and would enforce nothing. */
  required?: boolean;
  /** Forwarded to the VISIBLE input only, never to the hidden one. A disabled
   * control is skipped when the form's entry list is built, so a disabled
   * hidden input would drop the field out of FormData entirely —
   * formData.get() would return null rather than "", and the zod parse would
   * fail on a field the user cannot even see. */
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  /** null means the user is not typing. The visible input's text is derived
   * as `query ?? labelForValue(options, value)` and never separately stored,
   * which is what makes the snap back to the selected label a property of not
   * typing rather than of the blur event — so it happens on every route out
   * of a typed state, including the three that fire no blur. */
  const [query, setQuery] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);

  /** Clearing the query whenever `value` changes is load-bearing twice: it
   * covers cancel() and the successful-create branch, neither of which bumps
   * `attempt`, and the modal never unmounts its children — so without this,
   * creating a task with a project and reopening New task would show a box
   * reading that project over a hidden input submitting "". It is also why
   * the restore after a commit reads the just-committed id rather than one
   * captured before it. */
  const [seenValue, setSeenValue] = useState(value);
  if (seenValue !== value) {
    setSeenValue(value);
    setQuery(null);
    setActiveIndex(-1);
    setOpen(false);
  }

  const listRef = useRef<HTMLSpanElement>(null);
  const listId = useId();

  const matches = filterOptions(options, query ?? "");
  const text = query ?? labelForValue(options, value);

  /** "nearest" is the load-bearing word: it scrolls only ancestors that
   * actually need scrolling, so arrowing down scrolls the listbox and leaves
   * the modal body where the user put it. */
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  function commit(option: ComboboxOption) {
    onChange(option.value);
    setQuery(null);
    setActiveIndex(-1);
    setOpen(false);
  }

  function close() {
    setQuery(null);
    setActiveIndex(-1);
    setOpen(false);
  }

  function openList() {
    setQuery(null);
    setActiveIndex(initialActiveIndex(options, value));
    setOpen(true);
  }

  return (
    <Wrap label={label} error={error}>
      <span className="relative block">
        <input
          type="text"
          role="combobox"
          autoComplete="off"
          className={fieldClass({ size, className })}
          value={text}
          placeholder={placeholder}
          required={required}
          disabled={disabled}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIndex(filterOptions(options, e.target.value).length > 0 ? 0 : -1);
            setOpen(true);
          }}
          onClick={(e) => {
            // Opens only, never closes. A click inside an already-open box is
            // the user placing the caret in their own query, not asking to
            // dismiss the list — closing here would discard what they typed.
            // Blur, Escape, commit and outside-click all still close it.
            if (open) return;
            openList();
            e.currentTarget.select();
          }}
          onBlur={close}
        />

        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-3)]"
        >
          <Icon name="expand_more" />
        </span>

        {open ? (
          <span
            ref={listRef}
            id={listId}
            role="listbox"
            // Holds focus when the pointer lands on the popover's own
            // scrollbar, which would otherwise blur the input and close the
            // list mid-drag.
            onMouseDown={(e) => e.preventDefault()}
            className="absolute left-0 right-0 top-full z-20 mt-1 block max-h-64 overflow-y-auto rounded-md border border-[var(--border)] bg-[var(--surface)] py-1 shadow-[var(--shadow-lg)]"
          >
            {matches.length === 0 ? (
              <span
                role="option"
                aria-disabled="true"
                aria-selected="false"
                className="block px-3 py-1.5 text-sm text-[var(--text-3)]"
              >
                {emptyMessage(query ?? "", options.length > 0)}
              </span>
            ) : (
              matches.map((option, index) => (
                <span
                  key={option.value}
                  data-index={index}
                  role="option"
                  aria-selected={option.value === value}
                  onMouseDown={(e) => {
                    // mousedown, not click: it stops the input blurring
                    // between the press and the pick, which would fire the
                    // derived restore first and discard the selection.
                    e.preventDefault();
                    commit(option);
                  }}
                  onClick={(e) => {
                    // The enclosing <label> forwards a synthetic click to the
                    // visible input, whose handler toggles the list — so a
                    // mouse pick would commit, close, and instantly reopen.
                    // Label forwarding dispatches from click, not mousedown,
                    // so cancelling the mousedown default does not stop it.
                    e.preventDefault();
                  }}
                  // surface-3 and the hover pairing both match the menu rows
                  // in account-menu.tsx:25, so a listbox row and a menu row
                  // highlight identically. Hover is separate from activeIndex
                  // on purpose: pointing at a row is not the same as arrowing
                  // onto it, and only the latter is what Enter commits.
                  className={`block cursor-pointer px-3 py-1.5 text-sm transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--text)] ${
                    index === activeIndex
                      ? "bg-[var(--surface-3)] text-[var(--text)]"
                      : "text-[var(--text-2)]"
                  }`}
                >
                  {option.label}
                </span>
              ))
            )}
          </span>
        ) : null}
      </span>

      <input type="hidden" name={name} value={value} />
    </Wrap>
  );
}
```

- [ ] **Step 3: Verify it compiles and lints**

```bash
npx tsc --noEmit
```

Expected: clean. If `Icon`'s prop is not `name`, read `src/components/ui/icon.tsx` and match its real signature rather than changing the icon.

```bash
npm run lint
```

Expected: clean.

- [ ] **Step 4: Verify the gates**

```bash
npm run gates
```

Expected: 9/9. If gate 6 fails, the popover is using `shadow-lg` instead of `shadow-[var(--shadow-lg)]`. If gate 2 fails, an option row became a `<button>`.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/field.tsx src/components/ui/combobox.tsx
git commit -m "feat: combobox shell with derived text and hidden-input contract"
```

---

### Task 4: The keyboard model

**Files:**
- Modify: `src/components/ui/combobox.tsx`

**Interfaces:**
- Consumes: `nextActiveIndex` from `src/lib/combobox.ts`, plus `commit`, `close`, `openList`, `matches` and `activeIndex` from Task 3.
- Produces: nothing new for later tasks — this completes the control's behaviour.

Two rows of the spec's table turn on a **condition, not a key**, and getting either wrong produces a modal that cannot be dismissed or a picker where Enter does nothing. Read §5 before writing this.

- [ ] **Step 1: Add `nextActiveIndex` to the import**

```tsx
import {
  emptyMessage,
  filterOptions,
  initialActiveIndex,
  labelForValue,
  nextActiveIndex,
  type ComboboxOption,
} from "@/lib/combobox";
```

- [ ] **Step 2: Add the key handler**

Add this function inside the component, after `openList`:

```tsx
  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) {
        openList();
        return;
      }
      setActiveIndex(nextActiveIndex(activeIndex, e.key === "ArrowDown" ? 1 : -1, matches.length));
      return;
    }

    if (e.key === "Enter") {
      // Only while the list is open. Closed, suppressing Enter would make
      // these the three fields in the app where Enter does not submit the
      // form — a silent regression against the <select> being replaced.
      if (!open) return;
      e.preventDefault();
      if (activeIndex >= 0) commit(matches[activeIndex]);
      else close();
      return;
    }

    if (e.key === "Escape") {
      // Only while the list is open. Focus does not leave the combobox when
      // the list closes, so the second Escape arrives at this same handler —
      // and a rule stated for "Escape" as such would swallow that one too,
      // leaving a modal that cannot be dismissed by keyboard whenever the
      // caret sits in a picker.
      if (!open) return;
      e.preventDefault();
      // Belt-and-braces against the document-level Escape listeners in
      // quick-add, account-menu and notification-bell, which wrap no combobox
      // today and would each swallow one silently if they ever did.
      e.stopPropagation();
      close();
      return;
    }

    if (e.key === "Tab") {
      // Never preventDefault()ed; focus must move.
      if (open && activeIndex >= 0) commit(matches[activeIndex]);
      else if (open) close();
    }
  }
```

- [ ] **Step 3: Wire it to the input**

Add `onKeyDown={onKeyDown}` to the visible `<input>`, directly after `onClick`.

- [ ] **Step 4: Verify focus does not open the list**

Confirm there is **no** `onFocus` handler on the visible input. `modal.tsx:64` focuses the first non-hidden field automatically, so open-on-focus would drop a list of every client over the Name and Description fields the instant the New project modal appeared.

- [ ] **Step 5: Verify it compiles, lints and gates**

```bash
npx tsc --noEmit && npm run lint && npm run gates
```

Expected: all clean, gates 9/9.

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/combobox.tsx
git commit -m "feat: combobox keyboard model, with Enter and Escape gated on open"
```

---

### Task 5: ARIA wiring

**Files:**
- Modify: `src/components/ui/combobox.tsx`

**Interfaces:**
- Consumes: `listId` from `useId()` (Task 3).
- Produces: nothing new.

Three details each have a silent wrong answer, so they are spelled out rather than left to taste.

- [ ] **Step 1: Add the option id helper**

Inside the component, after `const listId = useId();`:

```tsx
  const optionId = (index: number) => `${listId}-option-${index}`;
```

- [ ] **Step 2: Add the combobox attributes to the visible input**

Add to the visible `<input>`, alongside the existing `role="combobox"`:

```tsx
          aria-expanded={open}
          // Rendered only while the list is open, because the popover is only
          // in the DOM while it is open — there is no hidden listbox for a
          // collapsed combobox to point at. aria-expanded="false" carries the
          // collapsed state on its own.
          aria-controls={open ? listId : undefined}
          // Omitted, never emptied. aria-activedescendant="" and an id
          // pointing at no element are both IDREF errors, and the failure
          // mode is a screen reader that announces nothing and gives no sign
          // why.
          aria-activedescendant={
            open && activeIndex >= 0 ? optionId(activeIndex) : undefined
          }
```

- [ ] **Step 3: Give each option row its id**

Add `id={optionId(index)}` to the mapped `<span role="option">`, beside `data-index`.

The empty row gets **no** id: it is never the active descendant, is never counted by `nextActiveIndex`, and cannot be committed by `Enter`, `Tab` or a click. It keeps `role="option"` with `aria-disabled="true"` because it is a listbox child, and a listbox with an invalid child is skipped entirely by many readers.

- [ ] **Step 4: Verify it compiles, lints and gates**

```bash
npx tsc --noEmit && npm run lint && npm run gates
```

Expected: all clean, gates 9/9.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/combobox.tsx
git commit -m "feat: combobox aria wiring, with activedescendant omitted not emptied"
```

---

### Task 6: Adopt at all three pickers

**Files:**
- Modify: `src/components/tasks/task-form.tsx` — Project `:224`, Milestone `:247`
- Modify: `src/components/projects/project-form.tsx` — Client `:145`

**Interfaces:**
- Consumes: `Combobox` from `@/components/ui/combobox`.
- Produces: nothing.

All three are in one task because they are one mechanical substitution and a reviewer would accept or reject them together.

- [ ] **Step 1: Replace the Project picker**

In `task-form.tsx`, add `Combobox` to the imports, then replace the `SelectField` at `:224` and its `<option>` children with:

```tsx
            <Combobox
              label="Project"
              name="projectId"
              className="w-full"
              value={values.projectId}
              onChange={(id) => setValues((v) => ({ ...v, projectId: id, milestoneId: "" }))}
              options={[
                { value: "", label: "No project (personal task)" },
                ...projects.map((p) => ({ value: p.id, label: p.name })),
              ]}
            />
```

The milestone reset is preserved verbatim — this is the one place the `set` helper is bypassed, and it stays bypassed. **Do not** map `clientId` away: `derivedClientId` at `:119-125` still reads it off the `projects` array, which is untouched. Dropping it breaks revalidation silently.

- [ ] **Step 2: Replace the Milestone picker**

Replace the `SelectField` at `:247`, leaving the enclosing `values.projectId === milestones.projectId` guard at `:246` and its hidden `milestoneId` fallback at `:262` exactly as they are:

```tsx
            <Combobox
              label="Milestone"
              name="milestoneId"
              className="w-full"
              value={values.milestoneId}
              onChange={(id) => set("milestoneId", id)}
              options={[
                { value: "", label: "No milestone" },
                ...milestones.options.map((m) => ({ value: m.id, label: m.title })),
              ]}
            />
```

Note `m.title`, not `m.name` — `MilestoneOptions` at `:33` is `{ id, title }`.

- [ ] **Step 3: Replace the Client picker**

In `project-form.tsx`, replace the `SelectField` at `:145`. The disabled sentinel at `:153-155` becomes the `placeholder` and leaves `options` entirely, so it is not merely unselectable but absent:

```tsx
            <Combobox
              label="Client"
              name="clientId"
              className="w-full"
              required
              placeholder="Select a client"
              value={values.clientId}
              onChange={(id) => set("clientId", id)}
              options={clients.map((c) => ({ value: c.id, label: c.name }))}
            />
```

- [ ] **Step 4: Confirm nothing else changed**

```bash
git diff --stat
```

Expected: exactly two files. If `SelectField` is now an unused import in either file, remove it — but only if it is genuinely unused; `task-form.tsx` still uses it for priority and status, and `project-form.tsx` for status and health.

- [ ] **Step 5: Verify the whole toolchain**

```bash
npx tsc --noEmit && npm run lint && npm run gates && npm test && npm run build
```

Expected: all clean, gates 9/9, all suites pass, build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/components/tasks/task-form.tsx src/components/projects/project-form.tsx
git commit -m "feat: adopt the combobox at the project, milestone and client pickers"
```

---

### Task 7: Browser QA

**Files:** none — this task changes no code unless it finds a defect.

This is where the keyboard model, focus movement, the derived-text restore, the ARIA wiring and the Escape-versus-`<dialog>` interaction are actually verified. None of them is unit-testable here, so this task is not optional.

⚠️ **Use real Chrome via `mcp__plugin_chrome-devtools-mcp`, never the embedded Browser pane.** That pane reports `document.visibilityState === "hidden"`, so view transitions never complete and every route with a `loading.tsx` shows its skeleton forever — while the real content sits in a `display:none` div where `querySelector` still finds it, so scripted assertions pass against a blank screen. This has already produced one confidently wrong diagnosis. `TODO.md` §5 and `docs/superpowers/plans/visual-language-followups.md` have the write-up. **Assert `document.visibilityState === "visible"` alongside `location.pathname` before believing any measurement.**

- [ ] **Step 1: Seed enough projects to make filtering meaningful**

The complaint being fixed is "unusable at fifty". Four projects will not exercise the scroll behaviour or the `scrollIntoView` clamp. Add temporary rows, or note explicitly in the report which criteria could not be exercised.

- [ ] **Step 2: Work through spec §10 criterion by criterion**

All 24 boxes in `docs/superpowers/specs/2026-08-03-searchable-combobox-design.md:254-276`. The ones most likely to fail, and worth doing first:

1. `Enter` with the list **closed** submits the form (the regression that would make these the three fields where Enter does nothing).
2. `Escape` with the list open closes only the list; a **second** `Escape` closes the modal.
3. Open a picker, press `Tab` without arrowing or typing — selection unchanged. Especially the Client picker with nothing selected, which must not silently commit the first client.
4. Create a task with a project, save, reopen New task — the box reads "No project (personal task)", not the project just saved. The modal never unmounts, so this tests the derived-text rule rather than the remount.
5. Edit a task, change its project, Cancel, reopen — the box reads the project the task actually has.
6. Type "Harlo", click between two characters in the box — the caret repositions and the query and open list are unchanged; it does not close or reset.
7. Pick with the mouse — commits, closes, and does **not** immediately reopen.
8. With fifty options, arrow to the last — it stays visible inside the list and the modal body underneath does not scroll.

- [ ] **Step 3: Check both themes and phone width**

D1's boundary costs these three pickers the native mobile wheel. Look at that rather than assuming it is acceptable, and report what you see.

- [ ] **Step 4: Report**

For each unmet criterion: what you did, what happened, what you expected. Do not fix defects in this task — report them, and they become their own task with their own commit.

---

## Self-Review

**Spec coverage.** §4's full prop contract → Task 3. §5's keyboard table → Task 4, with Enter and Escape gated on `open` as §5 requires. §5's ARIA paragraph and its three spelled-out details → Task 5. §6's edge cases: no options and no matches → Tasks 1 and 3; absent id (D6) → `labelForValue` returning `""`, tested in Task 1; loading → none by construction, nothing to build; error → straight through to `Wrap` in Task 3; the `attempt` remount and the two paths it misses → the `seenValue` guard in Task 3; `handleFormChange` collision → prevented by the visible input having no `name`; initial focus → verified in Task 4 Step 4 and Task 7; the milestone cascade and `clientId` derivation → Task 6 Steps 1–2. §7's adoption table → Task 6. §8's five functions and its test list → Tasks 1–2. §9's gates → the Global Constraints block and the gate runs in Tasks 3–6. §10 → Task 7.

**Placeholders.** None. Every code step carries real code; every command is runnable.

**Type consistency.** `ComboboxOption` is `{ value, label }` in Task 1 and used unchanged in Tasks 3–6. `filterOptions(options, query)`, `labelForValue(options, value)`, `emptyMessage(query, hasOptions)`, `initialActiveIndex(options, value)`, `nextActiveIndex(current, delta, count)` — all five are called in Task 3 and Task 4 exactly as declared in Tasks 1 and 2. `onChange` takes a string id at every call site.

**Facts verified against the repo while writing this plan**, so no task has to rediscover them: `Icon` takes `name: IconName` (`src/components/ui/icon.tsx:36-44`); `expand_more` is in `ICON_NAMES` (`src/lib/icons.ts:35`); `--surface-2` and `--surface-3` are both real tokens, defined across all three themes (`src/app/globals.css:12`, `:43`, `:60`). The active row uses `--surface-3` rather than `--surface-2` because that is what popover *rows* use (`account-menu.tsx:25`) — `--surface-2` is a button hover (`:108`), and picking it would have made a listbox row highlight unlike every other menu row in the app.

## Execution Handoff

Two execution options:

1. **Subagent-Driven (recommended)** — a fresh subagent per task, reviewed between tasks.
2. **Inline Execution** — executed in this session with checkpoints.
