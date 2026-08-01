# Design Application — Primitives, Elevation, Focus and Motion

**Status:** approved, not yet planned
**Branch:** fresh from `master` (`a06c23d`, Phase 3b merged)
**Runs before:** Phase 3c (comments, @mentions, attachments, rich text)

## 1. Why this phase exists, and what it actually is

Phase 1's plan, line 24, said:

> Styling in this phase is deliberately plain Tailwind — the visual design arrives later from the Claude Design hand-off. Do not invest in polish; invest in structure.

Every phase since honoured that. The hand-off itself was produced (`docs/design/claude-design-prompt.md`, and the parameterised mockup at `docs/design/meridian-ops/desktop.html`), but the roadmap's build-phase table — Foundation, Clients, Tasks, Scheduler, Vault, pack A, pack B — never contained a phase that *applies* it. "Later" was deferred to and never scheduled. This phase is that missing entry, inserted before 3c so that 3c's new surfaces are built against a design system rather than retrofitted into one.

**This is adoption, not invention.** Measured against the working tree:

- `globals.css` already carries the mockup's full token set. All 37 tokens match; only `--ico`, `--ico-s` and `--mono` are absent.
- The app consumes almost none of the expressive half. `--shadow`, `--shadow-md`, `--shadow-lg`: **0 uses**. `--ring`: **0 uses**. `--avatar-2`, `--leave`: **0 uses**. `--border-2`: 1. `--pj1…--pj6`: 1–2 each.
- **There is no focus styling anywhere.** Zero `focus:`, `focus-visible:` or `outline` across all 60 `.tsx` files. This is a keyboard-accessibility defect, not a cosmetic one, and `--ring` has been sitting defined and unused since Phase 1.
- The primitives were never extracted, but the codebase repeatedly tried: `const FIELD` is defined independently in 6 files, `const LABEL` in 3, `const CARD` byte-identically in 2, plus a `const BTN` and a `const SELECT`. The same input class string is hand-written in 9 files; primary-button styling in 11; bordered-button styling in 15.

So the work is to finish an abstraction that is half-built, consume tokens that already exist, and close a focus-state hole — then sweep.

## 2. Decisions (settled — do not relitigate)

| # | Decision |
|---|---|
| D1 | **Foundation *and* full screen sweep.** Primitives, elevation and focus first; then every screen. The foundation is a prerequisite for the sweep either way. |
| D2 | **Motion is expressive**, not merely state-communicating: route transitions, skeleton reveals, animated board reordering, shared-element morphs. This is a deliberate departure from the brief's "clarity over decoration", taken by the owner with the day-30 fatigue risk stated. `prefers-reduced-motion` is the mitigation, not an afterthought. |
| D3 | **Native View Transitions, no motion library.** `experimental.viewTransition` in `next.config.ts` plus React's `<ViewTransition>`. No new dependency, no bundle cost, graceful degradation where unsupported. |
| D4 | **Reference screen first.** Project detail is built end to end and signed off before the other twelve are touched, so a rejected aesthetic costs one screen rather than thirteen. |
| D5 | **Mechanical gates plus browser QA.** Gates catch the "missed a file" failure that a sweep of this size invites. They cannot judge whether it looks good; QA does that. |
| D6 | **No modal or drawer primitive.** Phase 3a ruled "no overlay primitive" (its D6) and built Quick add as a popover to honour it. Nothing here needs one, and adding it would silently reverse a deliberate decision. |
| D7 | **No toast system unless the work turns up a case that needs one.** The brief lists toasts as systematic, but this app reports every error inline beside the thing that failed, and Phase 3a deliberately scoped checklist errors *per item*. Inline is better than a toast for form errors. Build toasts only if motion work surfaces a message with nowhere to live. |
| D8 | **One accent colour.** The mockup is a parameterised prototype exposing four accent colours and four dark tones. The brief says "One accent color only." The knobs stay in the mockup; the app ships indigo. |

## 3. The primitive layer

Every variant below is derived from occurrence counts in the working tree, not invented.

### `<Button>`

| Variant | Evidence | Treatment |
|---|---|---|
| `secondary` | 12 occurrences — the dominant button | `border border-[var(--border)]`, `hover:bg-[var(--surface-2)]` |
| `primary` | 11 occurrences across two sizes | `bg-[var(--btn)]`, `hover:bg-[var(--btn-h)]`, `text-[var(--on-btn)]` |
| `danger` | 1 | `border-[var(--bad-line)]`, `bg-[var(--bad-bg)]`, `text-[var(--bad)]` |
| `ghost` | 1 | no border, `hover:bg-[var(--surface-2)]` |

Sizes `sm` (`px-3 py-1.5`) and `md` (`px-4 py-2`) — the two that exist. `disabled:opacity-50` folds into the base; its absence on some current buttons reads as accidental rather than intended. `className` passes through for `w-full`, which appears on 4.

### `<Field>`

The `FIELD` constant from those 6 files, plus its `LABEL` pairing and an inline error slot. One component covering `input`, `select` and `textarea` — today's markup differs only in the element rendered.

### `<Checkbox>`

Only 3 usages, which would not normally earn a component. It earns one here because it needs the same focus ring as everything else, and a small component is cheaper than three standing exemptions in the gate.

### `<Card>`

The `CARD` constant, plus the elevation the tokens already define. This is where `--shadow` is finally consumed.

### `<Skeleton>`

New. Shape-only placeholder used by the `loading.tsx` files in §5.

### Focus, declared once

`--ring` is defined and used zero times across 60 files. Putting `focus-visible:shadow-[var(--ring)]` into `Button`, `Field` and `Checkbox` closes the app's keyboard-accessibility hole in three files rather than sixty. This is the argument for extraction, made concrete.

### `--avatar-2` finds its consumer

Defined since Phase 1, used zero times. Its intended home is visible in `board-card.tsx`: the "+N" avatar-overflow chip currently renders on `--surface-3`, a generic surface tone, where a dedicated secondary avatar tone exists for exactly this. The avatar stack moves to `--avatar-2`.

### Token additions

`--ico` and `--ico-s` from the mockup. Motion tokens `--dur-exit: 150ms` and `--dur-enter: 210ms`. The `prefers-reduced-motion` reset. **`--mono` is not added** — nothing in the app renders monospace; it arrives when something does.

## 4. Motion architecture

### The typing gotcha, first

> **Corrected 2026-08-01 during the spike.** This section originally claimed a naive `import { ViewTransition } from "react"` fails `tsc`, and prescribed a `src/types/react-canary.d.ts` carrying `/// <reference types="react/canary" />`. **The claim was false** and the file was not built. What follows is what is actually true.

`ViewTransition` is declared in `@types/react/canary.d.ts` as a `declare module "."` augmentation, and is **not** in `index.d.ts`. It nonetheless resolves with no extra file, because `tsconfig.json` sets no `compilerOptions.types` — so TypeScript auto-includes every `@types` package and `canary.d.ts` lands in the program. Verified three ways: `tsc` exits 0 with no such file; a control probe importing a genuinely absent React export still errors `TS2305`, so the pass is not a false negative; and `tsc --listFiles` shows `canary.d.ts` in the program.

The original reasoning contradicted itself — it correctly warned that setting `compilerOptions.types` disables automatic `@types` inclusion, without noticing that automatic inclusion was precisely what made the manual reference redundant.

**The hazard is real even though the fix was not:** adding `compilerOptions.types` later would break every `ViewTransition` import in the app. That is recorded as a comment above the flag in `next.config.ts`, where someone editing tsconfig has a chance of meeting it.

### Route transitions

`(app)/layout.tsx` wraps `<main>` in `<ViewTransition>` keyed on transition types. Drill-down links carry `transitionTypes={['nav-forward']}`; breadcrumbs carry `['nav-back']`.

**Sidebar navigation carries neither.** A jump between top-level sections is lateral, not forward or back; animating it directionally is how this pattern starts to feel wrong. Sidebar navigations crossfade.

### The shell is anchored

Sidebar and topbar receive a `viewTransitionName` with their animation suppressed. Without this the entire viewport slides and the user loses their spatial anchor — and this shell is persistent on every screen in the app.

### Shared-element morphs

Three pairs, all of which already exist as navigations:

| From | To | `name` |
|---|---|---|
| Board card | Task detail | `task-${id}` |
| Team card | Member profile | `member-${id}` |
| Project row | Project detail | `project-${id}` |

### Board reordering

`board.tsx` already applies its optimistic move inside `startTransition`, which is precisely what activates `<ViewTransition>`. The same `task-${id}` name serves both the column-to-column morph and the morph into task detail — one name, one element, no collision, because two cards for one task id cannot coexist.

### Suspense reveals

**The largest single chunk of motion work.** There is currently no `loading.tsx` anywhere in the app and no `Suspense` usage at all. Each real route gains a `loading.tsx` whose skeleton is shaped like its actual content, wrapped per the guide's pattern: fallback `exit="slide-down"`, content `enter="slide-up"`, `default="none"`.

### Same-route crossfade

The status filter on My Tasks and on the member profile swaps a list within one route. `<ViewTransition key={status} name="task-list" share="auto" enter="auto" default="none">` — the guide's Step 4 pattern.

### Reduced motion

The documented reset zeroes `animation-duration` and `animation-delay` on all view-transition pseudo-elements. Anyone who opts out gets instant swaps, which is the browser default.

### Two risks, on the record

1. **Drag and view transitions may conflict.** HTML5 drag paints its own drag image; a view transition firing on drop could double-animate or fight it. No documentation covers this combination. The spike proves it on the board. If it is bad, board reordering falls back to CSS and every other motion pattern still stands.
2. **`experimental.viewTransition` is a flag Next can reshape.** Contained: one config line plus `<ViewTransition>` wrappers. If it regresses, removing the flag degrades to no animation rather than breaking pages.

## 5. Scope

| Area | Detail |
|---|---|
| Tokens | `globals.css` — `--ico`, `--ico-s`, motion durations, reduced-motion reset |
| Config | `next.config.ts` — `experimental.viewTransition`; new `src/types/react-canary.d.ts` |
| Primitives | `button`, `field`, `checkbox`, `card`, `skeleton` under `src/components/ui/` |
| Adoption | ~40 component files |
| Screens | 13 real pages, 4 placeholders (one shared `PlaceholderPage`), login, invite |
| Loading | ~13 new `loading.tsx` |
| Gates | `npm run gates` |

Real routes: dashboard, my-tasks, clients, clients/[clientId], projects, projects/[projectId], projects/[projectId]/board, tasks/[taskId], team, team/[memberId], settings, settings/members, settings/profile.
Placeholders: announcements, calendar, invoices, vault.

## 6. Gates

Shipped as `npm run gates`. **There is no CI in this repository** — no `.github/workflows`. Prior phases ran `tsc`, `lint` and `test` by hand at each plan step, and these gates follow that discipline. They are a checklist, not an enforcement mechanism, unless a pre-commit hook is added; that decision is open and noted in §9.

| # | Gate | Expected |
|---|---|---|
| 1 | No `dark:` variant, no hex outside `globals.css`, over `'src/**/*.tsx' 'src/**/*.ts'` | no output |
| 2 | No `<button` outside `src/components/ui/button.tsx` | no output |
| 3 | No `<input`/`<select`/`<textarea` outside the field primitives, **excluding `type="hidden"`** | no output |
| 4 | No `FIELD`/`LABEL`/`CARD`/`BTN`/`SELECT` class-string constants outside `src/components/ui/` | no output |
| 5 | Every interactive primitive carries `focus-visible` styling | present |

**Gate 3's exclusion is load-bearing.** There are 60 `type="hidden"` inputs in the codebase — the mechanism by which every form passes `taskId`, `projectId` and `clientId`. They carry no styling and are not a design concern. A gate that flags all 60 on day one is a gate that gets commented out in week two.

## 7. Sequencing

| Stage | Work | Rationale |
|---|---|---|
| 0 | Spike: flag on, canary types resolving, one route transition, one shared-element morph, drag-versus-transition checked on the board | Kills the only real technical unknowns before anything depends on them |
| 1 | Project detail end to end — primitives it needs, elevation, focus, motion | Richest screen: header, progress bar, three selects, buttons, badges, avatar stack, list rows, section headings. Exercises nearly every primitive in one place |
| 2 | **Owner sign-off on the look** | The cheap moment to change direction |
| 3 | Extract the proven primitives properly; enable gates 2–5 | A gate can only be written once the thing it enforces exists |
| 4 | Sweep the remaining 12 screens plus placeholders, login and invite | Mechanical by this point |
| 5 | App-wide motion: route transitions, `loading.tsx` skeletons, crossfades | Needs stable markup underneath |
| 6 | Browser QA, both themes | |

## 8. Testing

Prior phases held that pages and components get no unit tests and browser QA carries them. That holds here, with **one deliberate exception**: the variant→className mapping in `Button` and `Field`.

Those are pure functions of props, trivially testable, and a regression in them lands on all 60 files at once. That is a materially different risk profile from a page, and it is the one place the existing rule does not fit. Everything else stays browser-QA'd.

**The QA burden is large and should not be undersold:** 13 screens × 2 themes = 26 passes, plus motion checks, which are the fiddliest kind — a transition must be *watched*, it cannot be diffed. The gates catch missed files; they say nothing about whether the result looks good.

## 9. Pre-commit hook

**Default: no hook.** `npm run gates` is invoked explicitly at each plan gate step, matching how `tsc`, `lint` and `test` have been run since Phase 1. Adding a hook is a one-file change at stage 3 if the sweep shows the gates being forgotten; it is not a prerequisite and does not change the plan's shape.

## 10. Done criteria

- [ ] `--shadow`, `--shadow-md`, `--shadow-lg`, `--ring` and `--avatar-2` are consumed. The only tokens still unused are `--leave` (Phase 7, leave calendar) and `--pj3…--pj6` (Phase 4, calendar chips) — both awaiting features that do not exist yet, and both recorded here so a later reader does not delete them as dead.
- [ ] Every interactive element in the app shows a visible focus ring on keyboard traversal, in both themes.
- [ ] `<button>`, `<input>`, `<select>`, `<textarea>` and `<input type="checkbox">` appear only inside `src/components/ui/`, apart from `type="hidden"`.
- [ ] No `const FIELD`/`CARD`/`LABEL`/`BTN`/`SELECT` class-string constants remain outside `src/components/ui/`.
- [ ] Navigating from a board card to task detail, a team card to a profile, or a project row to project detail morphs the shared element.
- [ ] Drilling down slides forward; breadcrumbs slide back; sidebar navigation crossfades; the sidebar and topbar never move.
- [ ] Every real route has a `loading.tsx` whose skeleton is shaped like its content.
- [ ] Moving a board card between columns animates its position.
- [ ] With `prefers-reduced-motion: reduce`, every transition is instant.
- [ ] All five gates pass; `npm test`, `npx tsc --noEmit`, `npm run lint` and `npm run build` clean.
- [ ] Both themes reviewed on all 13 real screens.

## 11. Explicitly out of scope

Modal and drawer primitives (D6). A toast system unless §D7's condition is met. Configurable accents and dark tones (D8). `--mono` and monospace rendering. Visual-regression screenshots — considered and declined in favour of mechanical gates. Restyling of Phase 4/5/7 surfaces beyond the shared `PlaceholderPage`. Any change to data, queries, server actions or schema: **this phase adds no behaviour**, and the one exception is `board.tsx` gaining `viewTransitionName` attributes, which changes no logic.
