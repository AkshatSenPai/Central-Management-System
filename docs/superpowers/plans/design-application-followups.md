# Design Application — QA record and follow-ups

Branch `design-application`, 19 commits. QA run 2026-08-01 against a local dev server on the live Neon database.

Unlike Phase 3b, most of this was machine-verifiable, because the phase's claims are structural (does this token get consumed, does this element carry a focus ring, did a view transition actually run) rather than aesthetic. What follows separates **measured**, **owner-confirmed**, and **not exercised**, because conflating them is how a QA record becomes fiction.

**QA was performed under a minted local session for Test Member** (MEMBER role, 8-hour expiry), not the owner's admin account. No application code was modified to bypass authentication. Consequence: admin-only surfaces were not seen — see *Not exercised*.

## Automated gates

| Gate | Result |
|---|---|
| `npm run gates` | 6/6 pass |
| `npm test` | 489 passed, 34 files |
| `npx tsc --noEmit` | exit 0 |
| `npm run lint` | clean |
| `npm run build` | clean from a deleted `.next` |

## Measured

1. **Focus rings exist for the first time.** `--ring` was defined in Phase 1 and used zero times across 60 files. Verified with genuine keyboard focus: computes `rgba(75,83,201,0.2) 0 0 0 3px` in light theme.
2. **Route transitions fire.** Polling `document.getAnimations()` across a real navigation reports 12 view-transition animations, including `::view-transition-group(project-<id>)` with both `-old` and `-new` — the shared-element morph.
3. **The shell is anchored.** No `app-sidebar` / `app-topbar` entries in that animation list, which is what `animation: none` produces.
4. **Card elevation is live.** Card elements compute `rgba(16,17,26,0.05) 0 1px 2px` — `--shadow` in light theme.
5. **Board motion.** Card transitions `opacity, box-shadow` over 0.15s; column transitions colours over 0.15s.
6. **Field labels are properly associated.** The accessibility tree shows `label "Email"` *containing* its textbox — why `Wrap` emits `<span>`, not `<div>`.
7. **Forms still work.** Profile save persisted to the database and was reverted. Quick add created a `TO_DO`/`MEDIUM`/personal task assigned correctly, with all six hidden fields intact — no "Invalid input".
8. **Status changes log exactly one row.** 24 rapid toggles produced 24 rows, zero double-logged, each `from` matching the previous `to`. A harder version of Phase 3b's QA line 9.

## Owner-confirmed

- Reference screen (project detail) signed off before the sweep — the Task 6 gate.
- Route transitions reviewed and accepted.
- **Board drag: reorder animation, source-card dim, and highlight clearing all work.** This closes the Task 1 step 6 question, open since the spike: *HTML5 drag and view transitions do not conflict.* Nothing in the documentation covered that combination.

## Not exercised

- **Cross-document crossfade on the status filters.** `@view-transition { navigation: auto }` is in place, but in the QA browser the navigation fires `pageswap` with no `viewTransition`, so it never activates. Cause not established; cross-document view transitions shipped later than same-document, so most likely the embedded browser. Recorded as unproven in `globals.css` itself.
- **Admin-only surfaces.** Settings → Members and client deletion render differently for ADMIN; the QA session was MEMBER.
- **Touch drag.** HTML5 drag does not fire on touch; `<TaskStatusControl>` is the designated path there (spec D4) and works, but no touch device was used.
- **Both themes on every screen.** Light and dark were both checked on project detail and the shell. Other screens were seen in one theme only.
- **`prefers-reduced-motion`.** The reset ships and is correct by inspection, but was not exercised with the OS setting enabled.

## Defects found and fixed during the phase

Nine, of which **six were in my own plan or primitives** rather than in pre-existing code:

1. **`fieldClass` was full-width** — would have stretched every bare select. Caught on the first real call site.
2. **Two control sizes should have been three.** `px-2 py-1 text-xs` appears in 8 files, more than the `danger` and `ghost` variants combined. Collapsing it would have loosened every task, contact and member row, and **no gate would have caught it**.
3. **`Field`/`SelectField` needed `Omit<…, "size">`.** `<input>` and `<select>` declare `size?: number`, so the string union collapsed to `never`.
4. **The `react-canary.d.ts` the spec demanded was unnecessary.** The spec claimed `tsc` fails without it; it does not. Verified three ways. The spec had contradicted itself.
5. **`enter`/`exit` should have been `update`.** The plan copied the Next.js guide, but the guide puts `<ViewTransition>` in a page (which unmounts); this one is in the layout (which does not). **No animation fired at all** until this was found.
6. **Task 13 targeted the wrong mechanism.** The status filters are native GET form submits that replace the document, so a React `<ViewTransition>` could never animate them. Proven: a marker set on `window` is gone afterwards.
7. **Links had no focus indicator** — 7 of 35 elements. Gate 5 only inspects the three primitives.
8. **Quick add used Tailwind's `shadow-lg`**, a fixed value, so that popover rendered identically in both themes. Added gate 6.
9. **My own gate description broke the CSS build.** Tailwind v4 scans the whole project; gate 6's text contained a literal arbitrary-value class and was emitted as a real utility with an invalid `var()`. Fixed by scoping Tailwind to `src/**`.

## A note on measurement

Four verification attempts returned false results, every one my instrumentation rather than the app:

- `element.focus()` does not trigger `:focus-visible` on buttons or links — reported **25 false failures**.
- A 660ms poll window against a 2s dev-mode navigation — reported view transitions as dead when they had not started.
- Twice measured the wrong page after `navigate()` landed on `/` and redirected.
- Synthetic `DragEvent`s do not drive React's drag handlers — reported drag as non-functional.

Each would have led to "fixing" working code. The lesson worth carrying: **a negative result from a new measurement is a claim about the measurement until proven otherwise.**

## Carried forward

1. **`--leave` and `--pj1`–`--pj6` remain unconsumed**, awaiting the leave calendar (Phase 7) and calendar chips (Phase 4). Recorded so a dead-token sweep does not delete them.
2. **Cross-document crossfade unproven** — check in a real browser.
3. **`prefers-reduced-motion` unexercised.**
4. **The mockup has never been rendered.** `docs/design/meridian-ops/desktop.html` was read for its token definitions but never displayed. If its *layout* differs from what shipped, nothing in this phase would have caught it. A launch config exists (`design-preview`, port 5050).
5. **No skeleton `ViewTransition` wrappers.** The plan called for `exit="slide-down"` / `enter="slide-up"` on all 13 pages; not done, as the route-level transition already animates the swap.
6. **`next-themes` script-tag warning persists**, pre-existing since Phase 1, and fires on ordinary pages, not only the `notFound()` path as the Phase 3b handoff recorded.
7. **`.claude/settings.local.json`** grants `mcp__Claude_Browser__javascript_tool`. Covered by the global gitignore. Revoke if unwanted.
