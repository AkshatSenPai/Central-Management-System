# Design Application Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consume the design tokens that already exist, extract the primitives the codebase half-built, close the app-wide focus-state hole, and apply expressive motion via native View Transitions — across every screen.

**Architecture:** Nothing here changes data, queries, server actions or schema. Five primitives under `src/components/ui/` absorb the class strings currently duplicated across 28 component files; `--shadow*`, `--ring` and `--avatar-2` get consumed for the first time; motion is React's `<ViewTransition>` behind `experimental.viewTransition`, with no new dependency. A reference screen is built and signed off before the sweep, so a rejected aesthetic costs one screen instead of thirteen.

**Tech Stack:** Next.js 16.2.12 (App Router, Turbopack), React 19.2.4 (`ViewTransition` via Next's bundled canary), Tailwind v4 with CSS-variable tokens, next-themes, Vitest 4 (node environment).

**Spec:** `docs/superpowers/specs/2026-08-01-design-application-design.md`

## Global Constraints

- **Read `node_modules/next/dist/docs/` before writing framework code.** This Next.js differs from training data (project `AGENTS.md`). The View Transitions guide is `node_modules/next/dist/docs/01-app/02-guides/view-transitions.md`.
- Every colour is `[var(--token)]`. **No `dark:` variant anywhere. No hardcoded palette colour outside `src/app/globals.css`.**
- **No behaviour changes.** No new Prisma model, migration, server action, query or activity verb. If a task appears to require one, stop and report.
- Tests use hand-rolled closure fakes. **No `vi.fn`, `vi.spyOn`, `vi.mock`, `@testing-library/react`, jsdom.**
- **Only `buttonClass` and `fieldClass` are unit-tested.** Pages and components remain browser-QA'd, per every prior phase.
- Primitives follow `src/components/ui/badge.tsx`'s shape: a `const BASE` string, `Record<Kind, string>` maps, a plain function component. Read it before writing a new one.
- Raw `<button>`, `<input>`, `<select>`, `<textarea>` are permitted **only** inside `src/components/ui/`. `<input type="hidden">` is exempt everywhere.
- Commit after every task. Never commit with a failing gate.

## File Structure

| File | Responsibility |
|---|---|
| `src/app/globals.css` (modify) | `--ico`, `--ico-s`, `--dur-exit`, `--dur-enter`, view-transition keyframes, reduced-motion reset |
| `next.config.ts` (modify) | `experimental.viewTransition`, plus the comment recording why `ViewTransition` types resolve |
| `src/components/ui/button.tsx` (create) | `buttonClass`, `<Button>` |
| `src/components/ui/field.tsx` (create) | `fieldClass`, `<Field>`, `<SelectField>`, `<TextareaField>` |
| `src/components/ui/checkbox.tsx` (create) | `<Checkbox>` |
| `src/components/ui/card.tsx` (create) | `cardClass`, `<Card>` |
| `src/components/ui/skeleton.tsx` (create) | `<Skeleton>`, `<SkeletonText>` |
| `scripts/gates.mjs` (create) | The five mechanical gates; Node, not shell, for Windows |
| `tests/ui-class.test.ts` (create) | `buttonClass` / `fieldClass` mapping only |
| `src/components/placeholder-page.tsx` (modify) | Shared by 4 placeholder routes — note it is **not** under `ui/` |
| 28 component files (modify) | Adopt primitives |
| 13 `loading.tsx` (create) | Suspense skeletons |

**Why `buttonClass` is exported separately from `<Button>`:** `src/app/(app)/projects/[projectId]/page.tsx:144` renders a `<Link>` styled as a button ("Board"). It must not become a `<button>` — it is a navigation. It needs the classes without the element, and several sweep targets are the same shape.

---

### Task 1: Spike — prove View Transitions before anything depends on them

Throwaway proof. Its only deliverable is knowledge plus two permanent files (`next.config.ts`, `src/types/react-canary.d.ts`). Everything else is reverted.

**Files:**
- Modify: `next.config.ts`
- Test: none (spike)

**Interfaces:**
- Produces: a working `import { ViewTransition } from "react"` that passes `npx tsc --noEmit`.

- [ ] **Step 1: Read the guide**

Read `node_modules/next/dist/docs/01-app/02-guides/view-transitions.md` in full. It is the authority for every motion task in this plan.

- [ ] **Step 2: Enable the flag**

`next.config.ts` currently has an empty config object. Replace with:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    viewTransition: true,
  },
};

export default nextConfig;
```

- [ ] **Step 3: Establish why the types resolve, and record it**

**Corrected during execution.** This plan and the spec both originally called for a `src/types/react-canary.d.ts` carrying `/// <reference types="react/canary" />`, on the stated grounds that `tsc` fails without it. **That is false, and was verified false three ways:**

1. `npx tsc --noEmit` exits 0 with the file deleted.
2. A control probe importing a genuinely non-existent React export still errors (`TS2305`), proving react's types are strict and the pass is not a false negative.
3. `npx tsc --noEmit --listFiles` shows `@types/react/canary.d.ts` and `experimental.d.ts` already in the program.

The cause is that `tsconfig.json` sets no `compilerOptions.types`, so TypeScript auto-includes every `@types` package — canary included. The original reasoning contradicted itself: it correctly warned that setting `compilerOptions.types` would disable automatic inclusion, without noticing that automatic inclusion was what made the manual reference unnecessary.

So **create no file.** Instead record the real constraint where it can do some good — as a comment above the flag in `next.config.ts`:

```ts
  /**
   * Enables React's <ViewTransition>. The component itself is typed in
   * @types/react/canary.d.ts, not index.d.ts — it resolves only because
   * tsconfig.json sets no `compilerOptions.types`, so TypeScript auto-includes
   * every @types package and canary.d.ts lands in the program.
   *
   * Setting `compilerOptions.types` would therefore break every
   * `import { ViewTransition } from "react"` in the app. If you ever need that
   * key, add "react/canary" to the array.
   */
```

The hazard is real; the file was the wrong mitigation for it.

- [ ] **Step 4: Verify the type resolves**

Temporarily add to `src/app/(app)/team/page.tsx` at the top: `import { ViewTransition } from "react";` and wrap the outer `<div>` in `<ViewTransition>`.

Run: `npx tsc --noEmit`
Expected: exits 0.

If it fails, the typing approach is wrong — stop and report before continuing. Every motion task depends on this.

- [ ] **Step 5: Verify it builds and runs**

Run: `npm run build`
Expected: succeeds.

Start the dev server, sign in, and navigate to `/team`. Expected: page renders normally.

- [ ] **Step 6: Prove drag survives a view transition (the real unknown)**

Temporarily, in `src/components/tasks/board-card.tsx`, add to the outer `<div>`:

```tsx
style={{ viewTransitionName: `task-${row.id}` }}
```

Open a project board with tasks in at least two columns. Drag a card to another column.

Record the answer to each:
1. Does the card animate to its new column, or jump?
2. Does the HTML5 drag image flicker, double, or leave artefacts?
3. Does the drag still complete — does the status actually change?
4. Does the browser console show errors?

**This is the one combination no documentation covers.** If drag is visibly broken, board reorder animation is dropped from Task 12 and everything else in the plan stands. Write the answer into the task report either way.

- [ ] **Step 7: Revert the spike edits, keep the one permanent file**

Revert the `team/page.tsx` and `board-card.tsx` edits. Keep `next.config.ts`.

Run: `git diff --stat`
Expected: `next.config.ts` only.

- [ ] **Step 8: Gates and commit**

Run: `npm test` → 471 passed.
Run: `npx tsc --noEmit` → exits 0.
Run: `npm run lint` → clean.

```bash
git add next.config.ts
git commit -m "build: enable React view transitions behind the experimental flag"
```

---

### Task 2: `buttonClass` and `<Button>` (TDD)

**Files:**
- Create: `src/components/ui/button.tsx`
- Test: `tests/ui-class.test.ts`

**Interfaces:**
- Produces:

```ts
export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
export type ButtonSize = "sm" | "md";
export function buttonClass(opts?: { variant?: ButtonVariant; size?: ButtonSize; className?: string }): string;
export function Button(props: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}): React.JSX.Element;
```

Defaults are `variant: "secondary"`, `size: "sm"` — the dominant pair in the codebase (12 occurrences).

- [ ] **Step 1: Write the failing tests**

Create `tests/ui-class.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buttonClass } from "@/components/ui/button";

describe("buttonClass", () => {
  it("defaults to the secondary variant at sm, the codebase's dominant pair", () => {
    const cls = buttonClass();
    expect(cls).toContain("border-[var(--border)]");
    expect(cls).toContain("hover:bg-[var(--surface-2)]");
    expect(cls).toContain("px-3 py-1.5");
  });

  it("uses the button tokens for primary, never a raw colour", () => {
    const cls = buttonClass({ variant: "primary" });
    expect(cls).toContain("bg-[var(--btn)]");
    expect(cls).toContain("hover:bg-[var(--btn-h)]");
    expect(cls).toContain("text-[var(--on-btn)]");
    expect(cls).not.toContain("border-[var(--border)]");
  });

  it("uses the bad tokens for danger", () => {
    const cls = buttonClass({ variant: "danger" });
    expect(cls).toContain("border-[var(--bad-line)]");
    expect(cls).toContain("bg-[var(--bad-bg)]");
    expect(cls).toContain("text-[var(--bad)]");
  });

  it("gives ghost no border and no background", () => {
    const cls = buttonClass({ variant: "ghost" });
    expect(cls).not.toContain("border-[var(--border)]");
    expect(cls).not.toContain("bg-[var(--btn)]");
    expect(cls).toContain("hover:bg-[var(--surface-2)]");
  });

  it("switches padding on size", () => {
    expect(buttonClass({ size: "sm" })).toContain("px-3 py-1.5");
    expect(buttonClass({ size: "md" })).toContain("px-4 py-2");
  });

  // --ring was defined in Phase 1 and used zero times across 60 files. Every
  // variant carries focus styling or the app keeps its keyboard-accessibility
  // hole, which is the entire point of extracting this component.
  it("carries a focus ring on every variant", () => {
    for (const variant of ["primary", "secondary", "danger", "ghost"] as const) {
      expect(buttonClass({ variant }), variant).toContain("focus-visible:shadow-[var(--ring)]");
    }
  });

  it("carries the disabled treatment on every variant", () => {
    for (const variant of ["primary", "secondary", "danger", "ghost"] as const) {
      expect(buttonClass({ variant }), variant).toContain("disabled:opacity-50");
    }
  });

  it("appends caller classes last so they can override", () => {
    expect(buttonClass({ className: "w-full" }).endsWith("w-full")).toBe(true);
  });

  it("emits no hardcoded colour", () => {
    for (const variant of ["primary", "secondary", "danger", "ghost"] as const) {
      expect(buttonClass({ variant }), variant).not.toMatch(/#[0-9a-fA-F]{3,6}/);
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/ui-class.test.ts`
Expected: FAIL — cannot resolve `@/components/ui/button`.

- [ ] **Step 3: Implement**

Create `src/components/ui/button.tsx`:

```tsx
import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
export type ButtonSize = "sm" | "md";

/** Focus lives in the base, not per variant. `--ring` was defined in Phase 1
 * and consumed nowhere; declaring it once here is what closes the app's
 * keyboard-accessibility hole in one file instead of sixty. */
const BASE =
  "inline-flex items-center justify-center rounded-md text-sm transition-colors " +
  "focus-visible:outline-none focus-visible:shadow-[var(--ring)] disabled:opacity-50";

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "bg-[var(--btn)] text-[var(--on-btn)] hover:bg-[var(--btn-h)]",
  secondary:
    "border border-[var(--border)] text-[var(--text-2)] hover:bg-[var(--surface-2)]",
  danger:
    "border border-[var(--bad-line)] bg-[var(--bad-bg)] text-[var(--bad)] hover:bg-[var(--bad-bg)]",
  ghost: "text-[var(--text-2)] hover:bg-[var(--surface-2)]",
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5",
  md: "px-4 py-2",
};

/** Exported apart from <Button> because several call sites are <Link>s that
 * look like buttons — the "Board" link on the project page, for one. Those
 * are navigations and must stay anchors, so they need the classes without
 * the element. */
export function buttonClass(
  opts: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}
): string {
  const { variant = "secondary", size = "sm", className } = opts;
  return `${BASE} ${VARIANT_CLASS[variant]} ${SIZE_CLASS[size]}${className ? ` ${className}` : ""}`;
}

export function Button({
  variant = "secondary",
  size = "sm",
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return <button type={type} className={buttonClass({ variant, size, className })} {...props} />;
}
```

`type="button"` defaults deliberately: an unqualified `<button>` inside a form submits it, and several sweep targets are toggles inside forms. Callers that submit pass `type="submit"` explicitly.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/ui-class.test.ts`
Expected: 9 passed.

- [ ] **Step 5: Gates and commit**

Run: `npm test` → 480 passed.
Run: `npx tsc --noEmit` → exits 0.
Run: `npm run lint` → clean.

```bash
git add src/components/ui/button.tsx tests/ui-class.test.ts
git commit -m "feat: Button primitive carrying the focus ring the app never had"
```

---

### Task 3: `fieldClass`, `<Field>`, `<SelectField>`, `<TextareaField>`, `<Checkbox>` (TDD)

**Files:**
- Create: `src/components/ui/field.tsx`, `src/components/ui/checkbox.tsx`
- Modify: `tests/ui-class.test.ts`

**Interfaces:**
- Produces:

```ts
export type FieldSize = "sm" | "md";
export function fieldClass(opts?: { size?: FieldSize; className?: string }): string;
export function Field(props: React.InputHTMLAttributes<HTMLInputElement> & {
  label?: string; error?: string | null; size?: FieldSize;
}): React.JSX.Element;
export function SelectField(props: React.SelectHTMLAttributes<HTMLSelectElement> & {
  label?: string; error?: string | null; size?: FieldSize;
}): React.JSX.Element;
export function TextareaField(props: React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label?: string; error?: string | null; size?: FieldSize;
}): React.JSX.Element;
export function Checkbox(props: React.InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
}): React.JSX.Element;
```

**Where the sizes come from.** `client-form.tsx:25` uses `px-3 py-2`; `contact-form.tsx:9`, `checklist.tsx:12` and `project-filters.tsx:11` use `px-3 py-1.5`. Those are `md` and `sm`. The `mt-1 w-full` in the form variants belongs to the **label pairing**, not the control — so a `<Field>` *with* a label gets it, a bare one does not.

- [ ] **Step 1: Write the failing tests**

Append to `tests/ui-class.test.ts` (extend the import):

```ts
import { fieldClass } from "@/components/ui/field";

describe("fieldClass", () => {
  it("defaults to md, matching the form fields that dominate the codebase", () => {
    expect(fieldClass()).toContain("px-3 py-2");
  });

  it("switches padding on size", () => {
    expect(fieldClass({ size: "sm" })).toContain("px-3 py-1.5");
    expect(fieldClass({ size: "md" })).toContain("px-3 py-2");
  });

  it("uses the surface and border tokens", () => {
    const cls = fieldClass();
    expect(cls).toContain("border-[var(--border)]");
    expect(cls).toContain("bg-[var(--surface)]");
    expect(cls).toContain("text-[var(--text)]");
  });

  it("carries a focus ring", () => {
    expect(fieldClass()).toContain("focus-visible:shadow-[var(--ring)]");
  });

  it("appends caller classes last so they can override", () => {
    expect(fieldClass({ className: "max-w-xs" }).endsWith("max-w-xs")).toBe(true);
  });

  it("emits no hardcoded colour", () => {
    expect(fieldClass()).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/ui-class.test.ts -t fieldClass`
Expected: FAIL — cannot resolve `@/components/ui/field`.

- [ ] **Step 3: Implement `field.tsx`**

Create `src/components/ui/field.tsx`:

```tsx
import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

export type FieldSize = "sm" | "md";

const BASE =
  "w-full rounded-md border border-[var(--border)] bg-[var(--surface)] text-sm text-[var(--text)] " +
  "transition-colors focus-visible:outline-none focus-visible:shadow-[var(--ring)] " +
  "placeholder:text-[var(--text-3)] disabled:opacity-50";

const SIZE_CLASS: Record<FieldSize, string> = {
  sm: "px-3 py-1.5",
  md: "px-3 py-2",
};

const LABEL = "block text-sm text-[var(--text-2)]";
const ERROR = "mt-1 text-xs text-[var(--bad)]";

export function fieldClass(opts: { size?: FieldSize; className?: string } = {}): string {
  const { size = "md", className } = opts;
  return `${BASE} ${SIZE_CLASS[size]}${className ? ` ${className}` : ""}`;
}

/** The label pairing owns the top margin, not the control — that is why the
 * old per-file FIELD constants carried `mt-1` while the bare selects did
 * not. A labelled field spaces itself; a bare one sits where it is put. */
function Wrap({
  label,
  error,
  children,
}: {
  label?: string;
  error?: string | null;
  children: ReactNode;
}) {
  if (!label && !error) return <>{children}</>;
  return (
    <label className={label ? LABEL : undefined}>
      {label}
      <span className={label ? "mt-1 block" : "block"}>{children}</span>
      {error ? <span className={ERROR}>{error}</span> : null}
    </label>
  );
}

export function Field({
  label,
  error,
  size,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  error?: string | null;
  size?: FieldSize;
}) {
  return (
    <Wrap label={label} error={error}>
      <input className={fieldClass({ size, className })} {...props} />
    </Wrap>
  );
}

export function SelectField({
  label,
  error,
  size,
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & {
  label?: string;
  error?: string | null;
  size?: FieldSize;
}) {
  return (
    <Wrap label={label} error={error}>
      <select className={fieldClass({ size, className })} {...props}>
        {children}
      </select>
    </Wrap>
  );
}

export function TextareaField({
  label,
  error,
  size,
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label?: string;
  error?: string | null;
  size?: FieldSize;
}) {
  return (
    <Wrap label={label} error={error}>
      <textarea className={fieldClass({ size, className })} {...props} />
    </Wrap>
  );
}
```

- [ ] **Step 4: Implement `checkbox.tsx`**

Create `src/components/ui/checkbox.tsx`:

```tsx
import type { InputHTMLAttributes } from "react";

/** Only three call sites, which would not normally earn a component. It
 * earns one because it needs the same focus ring as everything else, and one
 * small component is cheaper than three standing exemptions in gate 3. */
export function Checkbox({
  label,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label?: string }) {
  const input = (
    <input
      type="checkbox"
      className={`h-4 w-4 rounded border-[var(--border)] focus-visible:outline-none focus-visible:shadow-[var(--ring)]${
        className ? ` ${className}` : ""
      }`}
      {...props}
    />
  );
  if (!label) return input;
  return (
    <label className="flex items-center gap-2 text-sm text-[var(--text)]">
      {input}
      {label}
    </label>
  );
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run tests/ui-class.test.ts`
Expected: 15 passed.

- [ ] **Step 6: Gates and commit**

Run: `npm test` → 486 passed.
Run: `npx tsc --noEmit` → exits 0.
Run: `npm run lint` → clean.

```bash
git add src/components/ui/field.tsx src/components/ui/checkbox.tsx tests/ui-class.test.ts
git commit -m "feat: Field and Checkbox primitives absorbing six duplicated FIELD constants"
```

---

### Task 4: `<Card>`, `<Skeleton>` and the token additions

**Files:**
- Create: `src/components/ui/card.tsx`, `src/components/ui/skeleton.tsx`
- Modify: `src/app/globals.css`
- Test: none (no logic; `cardClass` is a constant, not a mapping)

**Interfaces:**
- Produces:

```ts
export function cardClass(opts?: { raised?: boolean; className?: string }): string;
export function Card(props: { raised?: boolean; className?: string; children: React.ReactNode }): React.JSX.Element;
export function Skeleton(props: { className?: string }): React.JSX.Element;
export function SkeletonText(props: { lines?: number; className?: string }): React.JSX.Element;
```

- [ ] **Step 1: Add the tokens**

In `src/app/globals.css`, add to the `:root` block (after the `--shadow-lg` line):

```css
--ico:#55555f;--ico-s:#8a8a94;
--dur-exit:150ms;--dur-enter:210ms;
```

Add to the `[data-theme="dark"]` block (after its `--shadow-lg` line):

```css
--ico:#9ca6ba;--ico-s:#7c869a;
```

Add to the `[data-theme="dark"][data-tone="black"]` block (after its `--shadow-lg` line):

```css
--ico:#a5a8b1;--ico-s:#83868f;
```

`--ico`/`--ico-s` mirror `--text-2`/`--text-3` per theme, which is what the mockup does. Durations are theme-independent, so they live only in `:root`.

**Do not add `--mono`.** Nothing in the app renders monospace; it arrives when something does.

- [ ] **Step 2: Add the reduced-motion reset**

Append to `src/app/globals.css`:

```css
@media (prefers-reduced-motion: reduce) {
  ::view-transition-old(*),
  ::view-transition-new(*),
  ::view-transition-group(*) {
    animation-duration: 0s !important;
    animation-delay: 0s !important;
  }
  *, *::before, *::after {
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
  }
}
```

This is the spec's stated mitigation for expressive motion (D2). It ships now, before any motion exists, so no motion task can ever land without it.

- [ ] **Step 3: Implement `card.tsx`**

Create `src/components/ui/card.tsx`:

```tsx
import type { ReactNode } from "react";

/** `--shadow` and `--shadow-md` were defined in Phase 1 and consumed nowhere
 * — every card in the app has been a flat 1px border. This is where the
 * elevation the token set already describes finally gets used. */
const BASE = "rounded-lg border border-[var(--border)] bg-[var(--surface)]";

export function cardClass(opts: { raised?: boolean; className?: string } = {}): string {
  const { raised = false, className } = opts;
  const elevation = raised ? "shadow-[var(--shadow-md)]" : "shadow-[var(--shadow)]";
  return `${BASE} ${elevation}${className ? ` ${className}` : ""}`;
}

export function Card({
  raised,
  className,
  children,
}: {
  raised?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return <div className={cardClass({ raised, className })}>{children}</div>;
}
```

- [ ] **Step 4: Implement `skeleton.tsx`**

Create `src/components/ui/skeleton.tsx`:

```tsx
/** Shape-only placeholder for the loading.tsx files. Pulses via opacity
 * rather than a sweeping gradient: a gradient needs a hardcoded colour stop,
 * and this codebase allows none outside globals.css. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`block animate-pulse rounded-md bg-[var(--surface-3)]${className ? ` ${className}` : ""}`}
    />
  );
}

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <span className={`block space-y-2${className ? ` ${className}` : ""}`}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={i === lines - 1 ? "h-3 w-2/3" : "h-3 w-full"} />
      ))}
    </span>
  );
}
```

- [ ] **Step 5: Gates and commit**

Run: `npm test` → 486 passed.
Run: `npx tsc --noEmit` → exits 0.
Run: `npm run lint` → clean.
Run: `npm run build` → succeeds.

```bash
git add src/components/ui/card.tsx src/components/ui/skeleton.tsx src/app/globals.css
git commit -m "feat: Card and Skeleton primitives, icon and motion tokens, reduced-motion reset"
```

---

### Task 5: Reference screen — project detail end to end

The one screen that gets built before any sweep, so a rejected aesthetic costs one screen instead of thirteen. It was chosen because it exercises nearly every primitive: header, progress bar, three selects, buttons, badges, list rows, section headings.

**Files:**
- Modify: `src/app/(app)/projects/[projectId]/page.tsx`, `src/components/projects/project-status-control.tsx`, `src/components/projects/project-health-control.tsx`, `src/components/projects/progress-control.tsx`, `src/components/projects/milestone-form.tsx`, `src/components/projects/milestone-strip.tsx`, `src/components/projects/project-form.tsx`, `src/components/tasks/task-row.tsx`
- Test: none (browser QA)

**Interfaces:**
- Consumes: `buttonClass`, `Button`, `Field`, `SelectField`, `TextareaField`, `Checkbox`, `Card`, `cardClass`.

- [ ] **Step 1: Convert the page**

In `src/app/(app)/projects/[projectId]/page.tsx`:

Add imports:

```tsx
import { buttonClass } from "@/components/ui/button";
import { Card, cardClass } from "@/components/ui/card";
```

Replace the stat strip's opening tag (line 84) — it is a card and should say so:

```tsx
      <div className={cardClass({ className: "flex flex-wrap items-start gap-8 p-4" })}>
```

Replace the "Board" link's `className` (line 146) — it stays a `<Link>`, it is a navigation:

```tsx
              className={buttonClass()}
```

Replace the tasks list container (line 162):

```tsx
          <div className={cardClass({ className: "overflow-hidden" })}>
```

Leave `STAT_LABEL` where it is. It is a typography constant, not one of the five the gates forbid, and it has a single consumer.

- [ ] **Step 2: Convert the three select controls**

In each of `project-status-control.tsx`, `project-health-control.tsx` and `progress-control.tsx`, delete the local `FIELD`/`SELECT` constant, import `SelectField` (and `Field` where there is a number input), and replace each raw `<select>`/`<input>` with the primitive, passing `size="sm"`.

`progress-control.tsx` additionally has a Save `<button>` — replace with `<Button type="submit">`.

Keep every `name`, `value`, `defaultValue`, `onChange` and `disabled` prop exactly as-is. **This task changes no behaviour.**

- [ ] **Step 3: Convert the remaining components on this screen**

`milestone-form.tsx`, `milestone-strip.tsx`, `project-form.tsx`, `task-row.tsx`: delete local `FIELD`/`LABEL`/`BTN` constants, replace raw `<button>` with `<Button>` (`variant="primary"` for submits that were `bg-[var(--btn)]`, default secondary otherwise), and raw inputs/selects/textareas with `Field`/`SelectField`/`TextareaField`.

`<input type="hidden">` stays exactly as it is — do not convert it.

- [ ] **Step 4: Consume `--avatar-2`**

In `src/components/tasks/board-card.tsx`, the "+N" overflow chip currently uses `bg-[var(--surface-3)]`. Change to `bg-[var(--avatar-2)]`. That token has existed since Phase 1 for exactly this and has never been used.

- [ ] **Step 5: Gates**

Run: `npx tsc --noEmit` → exits 0.
Run: `npm run lint` → clean.
Run: `npm test` → 486 passed.
Run: `npm run build` → succeeds.

Run: `git grep -nE "dark:|#[0-9a-fA-F]{3,6}" -- 'src/**/*.tsx' 'src/**/*.ts'`
Expected: no output.

- [ ] **Step 6: Look at it**

Start the dev server. Open a project detail page. Confirm in **both themes**:
1. Every button and every select shows a visible focus ring on Tab.
2. The stat strip and task list have elevation, not just a border.
3. Nothing has shifted position or changed size unexpectedly.
4. The three selects still change status, health and progress mode, and each still writes its activity row.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(app)/projects" src/components/projects src/components/tasks/task-row.tsx src/components/tasks/board-card.tsx
git commit -m "feat: apply the design system to project detail as the reference screen"
```

---

### Task 6: Owner sign-off gate

**Not an implementation task.** Stop here and hand the running app to the owner.

- [ ] **Step 1: Present the reference screen**

Ask the owner to open project detail in both themes and confirm the direction before twelve more screens adopt it.

- [ ] **Step 2: Record the verdict**

If approved, continue to Task 7. If changed, revise Tasks 2–5's primitives and re-present — **do not proceed to the sweep on an unapproved aesthetic.** That is the entire reason this gate exists.

---

### Task 7: The gates script

Written after the primitives exist, because a gate can only enforce something that is already there.

**Files:**
- Create: `scripts/gates.mjs`
- Modify: `package.json`
- Test: none (the script is its own test)

**Interfaces:**
- Produces: `npm run gates`, exit 0 when clean, exit 1 with the offending lines otherwise.

- [ ] **Step 1: Write the script**

Create `scripts/gates.mjs`:

```js
import { execFileSync } from "node:child_process";

/** Node rather than shell because the team is on Windows; `npm run` hands
 * scripts to cmd.exe, where a .sh file needs a POSIX shell that may not be
 * on PATH. */
function grep(args) {
  try {
    return execFileSync("git", ["grep", "-nE", ...args], { encoding: "utf8" }).trim();
  } catch (e) {
    // git grep exits 1 with no output when nothing matches. That is success.
    if (e.status === 1 && !e.stdout.trim()) return "";
    throw e;
  }
}

const UI = "src/components/ui";

const gates = [
  {
    name: "1. no dark: variant, no hardcoded colour outside globals.css",
    run: () => grep(["dark:|#[0-9a-fA-F]{3,6}", "--", "src/**/*.tsx", "src/**/*.ts"]),
  },
  {
    name: "2. no raw <button> outside the Button primitive",
    run: () => grep(["<button", "--", "src/**/*.tsx", `:!${UI}/button.tsx`]),
  },
  {
    // 60 hidden inputs carry every taskId/projectId/clientId in the app. They
    // have no styling and are not a design concern. A gate that flags all 60
    // on day one is a gate that gets deleted in week two.
    name: "3. no raw <input>/<select>/<textarea> outside ui/ (hidden inputs exempt)",
    run: () =>
      grep(["<(input|select|textarea)", "--", "src/**/*.tsx", `:!${UI}/*`])
        .split("\n")
        .filter((l) => l && !l.includes('type="hidden"'))
        .join("\n"),
  },
  {
    name: "4. no FIELD/LABEL/CARD/BTN/SELECT class constants outside ui/",
    run: () => grep(["^const (FIELD|LABEL|CARD|BTN|SELECT) =", "--", "src/**/*.tsx", `:!${UI}/*`]),
  },
  {
    name: "5. every interactive primitive carries focus-visible styling",
    run: () => {
      const missing = ["button.tsx", "field.tsx", "checkbox.tsx"].filter((f) => {
        const hits = grep(["focus-visible:shadow-\\[var\\(--ring\\)\\]", "--", `${UI}/${f}`]);
        return hits === "";
      });
      return missing.length ? `missing focus-visible ring: ${missing.join(", ")}` : "";
    },
  },
];

let failed = 0;
for (const gate of gates) {
  const output = gate.run();
  if (output) {
    failed++;
    console.error(`FAIL ${gate.name}\n${output}\n`);
  } else {
    console.log(`ok   ${gate.name}`);
  }
}
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Wire it into `package.json`**

Add to `scripts`:

```json
    "gates": "node scripts/gates.mjs"
```

- [ ] **Step 3: Run it and expect failures**

Run: `npm run gates`
Expected: gates 1 and 5 pass; gates 2, 3 and 4 **FAIL**, listing the not-yet-swept files. That is correct — the sweep has not run. Record the failing counts; they are the sweep's worklist.

- [ ] **Step 4: Commit**

```bash
git add scripts/gates.mjs package.json
git commit -m "build: mechanical gates for the design sweep"
```

---

### Task 8: Sweep — client and member surfaces

**Files:**
- Modify: `src/components/clients/client-form.tsx`, `src/components/clients/contact-form.tsx`, `src/components/clients/contact-list.tsx`, `src/components/clients/client-delete-button.tsx`, `src/components/members/invite-form.tsx`, `src/components/members/member-row-actions.tsx`, `src/components/profile-form.tsx`, `src/app/(app)/clients/page.tsx`, `src/app/(app)/clients/[clientId]/page.tsx`, `src/app/(app)/settings/page.tsx`, `src/app/(app)/settings/members/page.tsx`, `src/app/(app)/settings/profile/page.tsx`
- Test: none (browser QA)

**The conversion rules — apply mechanically, identically, in every sweep task:**

1. Delete every local `const FIELD`, `LABEL`, `CARD`, `BTN`, `SELECT`.
2. `<button>` with `bg-[var(--btn)]` → `<Button variant="primary">`; keep `type="submit"` where present.
3. `<button>` with `border-[var(--border)]` → `<Button>` (secondary is the default).
4. `<button>` with `bad` tokens → `<Button variant="danger">`.
5. `<button>` with neither border nor background → `<Button variant="ghost">`.
6. `px-4 py-2` → `size="md"`; `px-3 py-1.5` and `px-2 py-1` → `size="sm"` (the default; omit it).
7. `<input>` → `<Field>`; `<select>` → `<SelectField>`; `<textarea>` → `<TextareaField>`; `<input type="checkbox">` → `<Checkbox>`.
8. A control preceded by a `<label>` moves that text to the `label` prop and the `<label>` wrapper is deleted.
9. `w-full` / `max-w-xs` / `mt-2` and similar layout classes pass through `className`.
10. **`<input type="hidden">` is never converted.**
11. A `<Link>` styled as a button keeps its `<Link>` and takes `className={buttonClass(...)}`.
12. `rounded-lg border border-[var(--border)] bg-[var(--surface)]` → `cardClass(...)` or `<Card>`.
13. **Change no `name`, `value`, `defaultValue`, `checked`, `onChange`, `onClick`, `disabled`, `required` or `form` prop.** This task alters appearance only.

- [ ] **Step 1: Convert the seven component files**

Apply rules 1–13 to `client-form.tsx` (3 buttons, 9 controls), `contact-form.tsx` (3, 4), `contact-list.tsx` (2, 0), `client-delete-button.tsx` (1, 0), `invite-form.tsx` (2, 2), `member-row-actions.tsx` (2, 0), `profile-form.tsx` (1, 4).

- [ ] **Step 2: Convert the five pages**

Apply rules 11–13 to the five page files. They contain no form controls — only card containers and link-buttons.

`src/app/(app)/clients/[clientId]/page.tsx` has a `const CARD` at line 22 and a `const CHIP` at line 21. Delete `CARD` (rule 1) and keep `CHIP` — it is typography, not one of the five, and gate 4 does not name it.

- [ ] **Step 3: Gates**

Run: `npm run gates` → gates 2, 3 and 4 now list **only** files outside this task's scope.
Run: `npx tsc --noEmit` → exits 0.
Run: `npm run lint` → clean.
Run: `npm test` → 486 passed.

- [ ] **Step 4: Browser check**

In both themes, open `/clients`, a client detail page, `/settings`, `/settings/members` and `/settings/profile`. Confirm every form still submits, every button still fires, and focus rings appear on Tab.

- [ ] **Step 5: Commit**

```bash
git add src/components/clients src/components/members src/components/profile-form.tsx "src/app/(app)/clients" "src/app/(app)/settings"
git commit -m "feat: adopt the design system across client and member surfaces"
```

---

### Task 9: Sweep — task and team surfaces

**Files:**
- Modify: `src/components/tasks/task-form.tsx`, `src/components/tasks/quick-add.tsx`, `src/components/tasks/checklist.tsx`, `src/components/tasks/task-status-filter.tsx`, `src/components/tasks/task-status-control.tsx`, `src/components/tasks/task-remove-control.tsx`, `src/components/tasks/task-assignees-form.tsx`, `src/components/tasks/assignee-picker.tsx`, `src/components/tasks/board-card.tsx`, `src/components/tasks/board-column.tsx`, `src/components/team/member-card.tsx`, `src/app/(app)/my-tasks/page.tsx`, `src/app/(app)/tasks/[taskId]/page.tsx`, `src/app/(app)/team/page.tsx`, `src/app/(app)/team/[memberId]/page.tsx`, `src/app/(app)/projects/page.tsx`, `src/app/(app)/projects/[projectId]/board/page.tsx`, `src/app/(app)/dashboard/page.tsx`
- Test: none (browser QA)

Apply the same rules 1–13 from Task 8. They are repeated here because tasks may be read out of order:

1. Delete every local `const FIELD`, `LABEL`, `CARD`, `BTN`, `SELECT`.
2. `<button>` with `bg-[var(--btn)]` → `<Button variant="primary">`; keep `type="submit"`.
3. `<button>` with `border-[var(--border)]` → `<Button>`.
4. `<button>` with `bad` tokens → `<Button variant="danger">`.
5. `<button>` with neither → `<Button variant="ghost">`.
6. `px-4 py-2` → `size="md"`; `px-3 py-1.5` / `px-2 py-1` → `size="sm"` (default; omit).
7. `<input>` → `<Field>`; `<select>` → `<SelectField>`; `<textarea>` → `<TextareaField>`; checkbox → `<Checkbox>`.
8. A preceding `<label>` becomes the `label` prop.
9. Layout classes pass through `className`.
10. **`<input type="hidden">` is never converted.**
11. A `<Link>` styled as a button keeps `<Link>` and takes `className={buttonClass(...)}`.
12. Card class strings → `cardClass(...)` or `<Card>`.
13. **Change no behavioural prop.**

- [ ] **Step 1: Convert the eleven component files**

Counts, so nothing is missed: `task-form.tsx` (3 buttons, 8 controls), `quick-add.tsx` (2, 2), `checklist.tsx` (2, 2), `task-status-filter.tsx` (1, 1), `task-status-control.tsx` (0, 1), `task-remove-control.tsx` (1, 0), `task-assignees-form.tsx` (1, 0), `assignee-picker.tsx` (0, 1), `board-card.tsx` (0, 0 — card container only), `board-column.tsx` (0, 0 — container only), `member-card.tsx` (0, 0 — card container only).

**`quick-add.tsx` carries four `<input type="hidden">` added in Phase 3b** (`description`, `projectId`, `milestoneId`, `dueDate`) plus `status` and `priority`. All six stay untouched. Removing them re-breaks quick add — see `docs/superpowers/plans/phase-3b-followups.md`, carried item 1.

- [ ] **Step 2: Convert the seven pages**

Apply rules 11–13. `src/app/(app)/tasks/[taskId]/page.tsx` has `const CARD` (line 16) and `const CHIP` (line 15): delete `CARD`, keep `CHIP`.

- [ ] **Step 3: Gates**

Run: `npm run gates` → **all five gates pass.** Every raw control in `src/` is now inside `ui/` or a hidden input.
Run: `npx tsc --noEmit` → exits 0.
Run: `npm run lint` → clean.
Run: `npm test` → 486 passed.
Run: `npm run build` → succeeds.

- [ ] **Step 4: Browser check**

In both themes: `/my-tasks`, a task detail page, `/team`, a member profile, `/projects`, a project board, `/dashboard`. Confirm drag still works on the board, quick add still creates a task, and the checklist still toggles.

- [ ] **Step 5: Commit**

```bash
git add src/components/tasks src/components/team "src/app/(app)"
git commit -m "feat: adopt the design system across task and team surfaces"
```

---

### Task 10: Sweep — shell, auth and placeholders

**Files:**
- Modify: `src/components/shell/topbar.tsx`, `src/components/shell/sidebar.tsx`, `src/app/(auth)/login/page.tsx`, `src/app/(auth)/invite/[token]/page.tsx`, `src/components/placeholder-page.tsx`
- Test: none (browser QA)

- [ ] **Step 1: Convert the shell**

`topbar.tsx` (2 buttons, 1 control): the theme toggle and Sign out become `<Button>`; the disabled search input becomes `<Field disabled placeholder="Search (coming soon)" className="w-64" />`.

`sidebar.tsx` has no buttons or controls. Add focus styling to its nav links, which are `<Link>`s and therefore invisible to gate 5 — append to the className expression on line 33:

```
focus-visible:outline-none focus-visible:shadow-[var(--ring)]
```

- [ ] **Step 2: Convert the auth pages**

`login/page.tsx` (2 buttons, 2 controls) and `invite/[token]/page.tsx` (1, 2). Apply rules 1–13.

These sit outside the `(app)` shell and have no sidebar, so check them at a narrow width too.

- [ ] **Step 3: Style the placeholder page**

`src/components/placeholder-page.tsx` — note it is **not** under `ui/` — is imported by announcements, calendar, invoices and vault. One change covers all four routes:

```tsx
import { Card } from "@/components/ui/card";

export function PlaceholderPage({ title, phase }: { title: string; phase: string }) {
  return (
    <div className="p-8">
      <Card className="p-6">
        <h1 className="text-2xl font-semibold text-[var(--text)]">{title}</h1>
        <p className="mt-2 text-sm text-[var(--text-3)]">Coming in {phase}.</p>
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: Gates**

Run: `npm run gates` → all five pass.
Run: `npx tsc --noEmit` → exits 0.
Run: `npm run lint` → clean.
Run: `npm run build` → succeeds.

- [ ] **Step 5: Browser check**

Sign out and check `/login` in both themes; check one placeholder route; confirm the topbar toggle still switches theme and Sign out still works.

- [ ] **Step 6: Commit**

```bash
git add src/components/shell "src/app/(auth)" src/components/placeholder-page.tsx
git commit -m "feat: adopt the design system across shell, auth and placeholder routes"
```

---

### Task 11: Route transitions, shell anchoring and shared-element morphs

**Files:**
- Modify: `src/app/(app)/layout.tsx`, `src/app/globals.css`, `src/components/shell/sidebar.tsx`, `src/components/shell/topbar.tsx`, `src/components/tasks/board-card.tsx`, `src/components/team/member-card.tsx`, `src/app/(app)/projects/page.tsx`, `src/app/(app)/tasks/[taskId]/page.tsx`, `src/app/(app)/team/[memberId]/page.tsx`, `src/app/(app)/projects/[projectId]/page.tsx`
- Test: none (browser QA)

**Interfaces:**
- Consumes: `experimental.viewTransition` from Task 1.

- [ ] **Step 1: Add the transition CSS**

Append to `src/app/globals.css` (from the Next guide, using the duration tokens added in Task 4):

```css
::view-transition-old(.nav-forward){--slide-offset:-60px;animation:150ms ease-in both fade reverse,400ms ease-in-out both slide reverse}
::view-transition-new(.nav-forward){--slide-offset:60px;animation:var(--dur-enter) ease-out var(--dur-exit) both fade,400ms ease-in-out both slide}
::view-transition-old(.nav-back){--slide-offset:60px;animation:150ms ease-in both fade reverse,400ms ease-in-out both slide reverse}
::view-transition-new(.nav-back){--slide-offset:-60px;animation:var(--dur-enter) ease-out var(--dur-exit) both fade,400ms ease-in-out both slide}
::view-transition-group(app-sidebar),::view-transition-group(app-topbar){animation:none;z-index:100}
::view-transition-old(app-sidebar),::view-transition-old(app-topbar){display:none}
::view-transition-new(app-sidebar),::view-transition-new(app-topbar){animation:none}

@keyframes fade{from{filter:blur(3px);opacity:0}to{filter:blur(0);opacity:1}}
@keyframes slide{from{translate:var(--slide-offset)}to{translate:0}}
@keyframes slide-y{from{transform:translateY(10px)}to{transform:translateY(0)}}
```

- [ ] **Step 2: Anchor the shell**

In `sidebar.tsx`, add to the `<aside>`: `style={{ viewTransitionName: "app-sidebar" }}`.
In `topbar.tsx`, add to the `<header>`: `style={{ viewTransitionName: "app-topbar" }}`.

Without this the whole viewport slides and the user loses their spatial anchor. The shell is on every screen in the app.

- [ ] **Step 3: Wrap the main content**

In `src/app/(app)/layout.tsx`, import `ViewTransition` from `react` and wrap `{children}`:

```tsx
        <main className="flex-1 overflow-y-auto">
          <ViewTransition
            enter={{ "nav-forward": "nav-forward", "nav-back": "nav-back", default: "none" }}
            exit={{ "nav-forward": "nav-forward", "nav-back": "nav-back", default: "none" }}
            default="none"
          >
            {children}
          </ViewTransition>
        </main>
```

`default: "none"` means an untyped navigation — an initial load, or a sidebar jump — produces no slide. **Sidebar links deliberately get no `transitionTypes`:** a jump between top-level sections is lateral, not forward or back, and animating it directionally is how this pattern starts feeling wrong.

- [ ] **Step 4: Tag the drill-down links**

Add `transitionTypes={['nav-forward']}` to the `<Link>` that opens a detail view in each of: `board-card.tsx` (card → task), `member-card.tsx` (card → profile), `projects/page.tsx` (row → project), `projects/[projectId]/page.tsx` (the Board link).

- [ ] **Step 5: Tag the breadcrumbs**

Add `transitionTypes={['nav-back']}` to every breadcrumb `<Link>` in `tasks/[taskId]/page.tsx`, `team/[memberId]/page.tsx`, `projects/[projectId]/page.tsx` and `projects/[projectId]/board/page.tsx`.

- [ ] **Step 6: Add the shared-element names**

| File | Element | `viewTransitionName` |
|---|---|---|
| `board-card.tsx` | outer card `<div>` | `` `task-${row.id}` `` |
| `tasks/[taskId]/page.tsx` | page header block | `` `task-${task.id}` `` |
| `member-card.tsx` | outer card `<div>` | `` `member-${card.id}` `` |
| `team/[memberId]/page.tsx` | profile header block | `` `member-${profile.id}` `` |
| `projects/page.tsx` | project row | `` `project-${p.id}` `` |
| `projects/[projectId]/page.tsx` | header block | `` `project-${project.id}` `` |

Applied via `style={{ viewTransitionName: ... }}`.

- [ ] **Step 7: Gates**

Run: `npm run gates` → all five pass.
Run: `npx tsc --noEmit` → exits 0.
Run: `npm run lint` → clean.
Run: `npm run build` → succeeds.

- [ ] **Step 8: Browser check**

1. `/projects` → a project: content slides in from the right, sidebar and topbar do not move, and the row morphs into the header.
2. Breadcrumb back: content slides the other way.
3. A sidebar jump: crossfade, no slide.
4. Board card → task detail: the card morphs.
5. Team card → profile: the card morphs.
6. With OS "reduce motion" on: every transition is instant.

- [ ] **Step 9: Commit**

```bash
git add "src/app/(app)" src/components/shell src/components/tasks/board-card.tsx src/components/team/member-card.tsx src/app/globals.css
git commit -m "feat: directional route transitions with an anchored shell and shared-element morphs"
```

---

### Task 12: Suspense skeletons and board reorder animation

The largest single chunk of motion work: there is no `loading.tsx` and no `Suspense` anywhere in the app today.

**Files:**
- Create: `loading.tsx` in each of the 13 real route directories under `src/app/(app)/`
- Modify: `src/components/tasks/board-card.tsx`
- Test: none (browser QA)

**Interfaces:**
- Consumes: `Skeleton`, `SkeletonText` from Task 4; `Card` from Task 4.

- [ ] **Step 1: Write one representative skeleton**

Create `src/app/(app)/projects/loading.tsx`:

```tsx
import { Card } from "@/components/ui/card";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="space-y-6 p-8">
      <Skeleton className="h-7 w-48" />
      <Card className="p-4">
        <SkeletonText lines={4} />
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Add the remaining twelve**

Each is the Step 1 file with its body swapped for the shape below. Every one keeps the same wrapper: `<div className="space-y-6 p-8">`.

| Route directory | Body |
|---|---|
| `dashboard` | `<Skeleton className="h-7 w-40" />` then three `<Card className="p-4"><SkeletonText lines={3} /></Card>` in a `grid gap-4 md:grid-cols-3` |
| `my-tasks` | `<Skeleton className="h-7 w-40" />`, `<Skeleton className="h-9 w-52" />` (the filter), then `<Card className="p-4"><SkeletonText lines={6} /></Card>` |
| `clients` | `<Skeleton className="h-7 w-32" />` then `<Card className="p-4"><SkeletonText lines={6} /></Card>` |
| `clients/[clientId]` | `<Skeleton className="h-4 w-56" />` (breadcrumb), `<Skeleton className="h-8 w-64" />`, then two `<Card className="p-4"><SkeletonText lines={4} /></Card>` |
| `projects/[projectId]` | breadcrumb + `h-8 w-64` heading, one `<Card className="p-4"><SkeletonText lines={2} /></Card>` for the stat strip, then `<Card className="p-4"><SkeletonText lines={5} /></Card>` |
| `projects/[projectId]/board` | breadcrumb + heading, then **four** `<Card className="p-3"><SkeletonText lines={3} /></Card>` in `grid gap-4 md:grid-cols-2 xl:grid-cols-4`, matching the board's own grid |
| `tasks/[taskId]` | breadcrumb + `h-8 w-72` heading, then `<Card className="p-4"><SkeletonText lines={6} /></Card>` |
| `team` | `<Skeleton className="h-7 w-24" />` then three `<Card className="p-4"><SkeletonText lines={4} /></Card>` in `grid gap-4 sm:grid-cols-2 lg:grid-cols-3` |
| `team/[memberId]` | breadcrumb, a `flex items-center gap-3` row of `<Skeleton className="h-12 w-12 rounded-full" />` plus `<Skeleton className="h-6 w-40" />`, then `<Card className="p-4"><SkeletonText lines={5} /></Card>` |
| `settings` | `<Skeleton className="h-7 w-28" />` then `<Card className="p-4"><SkeletonText lines={3} /></Card>` |
| `settings/members` | `<Skeleton className="h-7 w-32" />` then `<Card className="p-4"><SkeletonText lines={5} /></Card>` |
| `settings/profile` | `<Skeleton className="h-7 w-28" />` then `<Card className="p-4"><SkeletonText lines={4} /></Card>` |

A skeleton that does not resemble its content is worse than none — it makes the page appear to change shape as it loads. Match the grid column counts exactly where one is given above.

- [ ] **Step 3: Animate board reordering**

**Only if Task 1 step 6 found drag intact.** If it did not, skip this step and record why.

In `src/components/tasks/board-card.tsx`, add to the outer `<div>`:

```tsx
style={{ viewTransitionName: `task-${row.id}` }}
```

This is the same name Task 11 step 6 assigns, and it serves both purposes — the morph into task detail and the column-to-column move. Two cards for one task id cannot coexist, so there is no collision. `board.tsx` already applies its optimistic update inside `startTransition`, which is what activates the animation; **no change to `board.tsx` is needed.**

- [ ] **Step 4: Gates**

Run: `npm run gates` → all five pass.
Run: `npx tsc --noEmit` → exits 0.
Run: `npm run lint` → clean.
Run: `npm run build` → succeeds, and the route list is unchanged.

- [ ] **Step 5: Browser check**

Throttle the network in devtools to make skeletons visible. Navigate to each of the 13 routes and confirm the skeleton resembles the content that replaces it. Then drag a board card and confirm it animates to its new column.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)" src/components/tasks/board-card.tsx
git commit -m "feat: route skeletons and animated board card movement"
```

---

### Task 13: Same-route crossfade on filtered lists

**Files:**
- Modify: `src/app/(app)/my-tasks/page.tsx`, `src/app/(app)/team/[memberId]/page.tsx`
- Test: none (browser QA)

- [ ] **Step 1: Wrap both task lists**

In each file, import `ViewTransition` from `react` and wrap the list block — the `rows.length === 0 ? <EmptyState … /> : <div>…</div>` expression — like this, using `profile.tasks` in place of `rows` on the profile page:

```tsx
      <ViewTransition key={status ?? "OPEN"} name="task-list" share="auto" enter="auto" default="none">
        {rows.length === 0 ? (
          <EmptyState message="Nothing assigned to you." />
        ) : (
          <div className={cardClass({ className: "overflow-hidden" })}>
            {rows.map((row) => (
              <TaskRow key={row.id} row={row} />
            ))}
          </div>
        )}
      </ViewTransition>
```

The `key` is what triggers the transition when the filter changes. `status` is `null` in the default view, so it falls back to `"OPEN"` — a `key` of `null` would not change between the default view and a cleared filter, and the crossfade would silently not fire.

Keep each page's own empty-state string: "Nothing assigned to you." on My Tasks, "Nothing assigned." on the profile. They differ, and the Vocabulary Lock pins both.

- [ ] **Step 2: Gates**

Run: `npm run gates` → all five pass.
Run: `npx tsc --noEmit` → exits 0.
Run: `npm run lint` → clean.
Run: `npm test` → 486 passed.
Run: `npm run build` → succeeds.

- [ ] **Step 3: Browser check**

On `/my-tasks` and on a member profile, change the status filter. The list crossfades; the heading, filter control and surrounding layout do not move.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/my-tasks" "src/app/(app)/team"
git commit -m "feat: crossfade filtered task lists within their route"
```

---

### Task 14: Browser QA and final gates

Per spec §8 this is the primary verification. Only `buttonClass` and `fieldClass` have unit tests; every screen and every transition is carried by this task. Budget real time.

**Setup:** an authenticated session is required. Do not ask for or handle the owner's password. The owner runs this task.

- [ ] **Step 1: Every screen, both themes**

For each of the 13 real routes plus `/login`, an invite link, and one placeholder route, in **light and dark**:
1. Nothing overlaps, clips, or has visibly wrong spacing.
2. Every button, input, select and checkbox shows a visible focus ring on Tab.
3. Cards show elevation, not just a flat border.
4. No element renders an off-palette colour.

- [ ] **Step 2: Every form still works**

Create and edit a client, a contact, a project, a milestone, a task, a checklist item, an invite, and a profile change. Each must submit, and each must still show its error inline on failure.

- [ ] **Step 3: Motion**

1. Drill-down slides forward; breadcrumb slides back; sidebar jump crossfades.
2. Sidebar and topbar never move during any transition.
3. Board card, team card and project row each morph into their detail page.
4. Board drag still moves cards, and they animate to the new column.
5. Filter changes crossfade the list.
6. Skeletons appear on a throttled network and match their content's shape.
7. With OS reduce-motion enabled, every one of the above is instant and nothing breaks.

- [ ] **Step 4: Final gates**

Run: `npm run gates` → all five pass.
Run: `npm test` → 486 passed.
Run: `npx tsc --noEmit` → exits 0.
Run: `npm run lint` → clean.
Run: `npm run build` → succeeds.

- [ ] **Step 5: Confirm no token is dead by accident**

Run: `node scripts/gates.mjs` and then check each of `--shadow`, `--shadow-md`, `--ring`, `--avatar-2`, `--ico` has at least one consumer:

```bash
for t in shadow shadow-md ring avatar-2 ico; do printf "%s: " "$t"; git grep -o "var(--$t)" -- 'src/**/*.tsx' | wc -l; done
```

Expected: all non-zero. `--leave` and `--pj3`–`--pj6` remain at zero — they await Phases 7 and 4 and must not be deleted.

- [ ] **Step 6: Record the results**

Write to `docs/superpowers/plans/design-application-followups.md`: every QA line with its result, anything **not** exercised stated explicitly rather than skipped silently, and any follow-up worth carrying.

- [ ] **Step 7: Commit**

```bash
git add docs/superpowers/plans/design-application-followups.md
git commit -m "docs: record design application browser QA results"
```

---

## Done Criteria

- [ ] `--shadow`, `--shadow-md`, `--shadow-lg`, `--ring`, `--avatar-2` and `--ico` are consumed; only `--leave` and `--pj3`–`--pj6` remain unused, awaiting Phases 7 and 4.
- [ ] Every interactive element shows a visible focus ring on keyboard traversal, in both themes.
- [ ] `<button>`, `<input>`, `<select>`, `<textarea>` and checkboxes appear only inside `src/components/ui/`, apart from `<input type="hidden">`.
- [ ] No `FIELD`/`LABEL`/`CARD`/`BTN`/`SELECT` class constants remain outside `src/components/ui/`.
- [ ] Board card → task detail, team card → profile, and project row → project detail each morph the shared element.
- [ ] Drilling down slides forward, breadcrumbs slide back, sidebar navigation crossfades, and the shell never moves.
- [ ] All 13 real routes have a `loading.tsx` shaped like their content.
- [ ] Moving a board card between columns animates its position (or Task 1 recorded why not).
- [ ] With `prefers-reduced-motion: reduce`, every transition is instant.
- [ ] `npm run gates` passes all five; `npm test`, `npx tsc --noEmit`, `npm run lint`, `npm run build` all clean.
- [ ] No behaviour changed: no schema, query, server action or activity verb was touched.
