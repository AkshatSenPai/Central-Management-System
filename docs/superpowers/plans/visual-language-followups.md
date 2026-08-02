# Visual language — QA record and follow-ups

Work of 2026-08-02, on `master` (the `design-application` branch was merged first, fast-forward, and deleted). Three commits: the icon system and modal primitive, the dashboard, and a modal focus fix.

This closes **layer 2** of the three-layer split in `TOMORROW.md`: the design had 80 icon usages and the app had none. It does not close layer 3 — see *Not done*.

## Automated gates

| Gate | Result |
|---|---|
| `npm run gates` | 9/9 pass (was 6, three added) |
| `npm test` | 507 passed, 35 files (was 489/34) |
| `npx tsc --noEmit` | exit 0 |
| `npm run lint` | clean |
| `npm run build` | clean from a deleted `.next` |

New gates:

- **7. every icon in `src/lib/icons.ts` is used somewhere.** The direct answer to `--ico` shipping unused last phase.
- **8. the committed icon font matches `src/lib/icons.ts`.** Runs `scripts/fetch-icon-font.mjs --check`.
- **9. no raw icon spans.** Icons go through `<Icon>`, the way colours go through tokens.

One fix to the gate harness itself: `git grep` searches only tracked files, so **every gate was blind to new components until the commit that added them**. Found when gate 7 reported five icons as unused while the file rendering them sat untracked. `--untracked` fixes all nine.

## Decisions taken by the owner

- **D6 is reversed.** "No modal or drawer primitive" (inherited from Phase 3a's "no overlay primitive") could not stand alongside a design containing two modals. `src/components/ui/modal.tsx` exists; New task and New project use it. The reversal is narrow and the boundary is written into the primitive's own doc comment: a modal is for content you commit to. `<QuickAdd>` and `<AccountMenu>` remain popovers and must not become dialogs.
- **`--mono` ships with a consumer**, rather than being restored empty. The consumer is the dashboard's This-week figures. See *Judgement calls* — this one is worth a second look.
- **The icon font is self-hosted**, not linked from Google. 25 icons subset to 4.4 KB.

## Measured

1. **The icon font loads and renders glyphs.** `document.fonts` reports the face loaded with `display: block`; a sidebar icon's box is exactly 20×20. Raw ligature text would be ~100px wide, so this distinguishes a rendered glyph from a failed one.
2. **`<Icon>` is `aria-hidden`.** Confirmed on live elements. Necessary: the element's text content is the literal string `space_dashboard`.
3. **`font-variant-numeric: tabular-nums` is live on `body`.**
4. **`--mono` resolves** to `"IBM Plex Mono", "IBM Plex Mono Fallback", ui-monospace, monospace` on the stat figures.
5. **The modal is a real modal.** `dialog.matches(":modal")` is true — that is `showModal()`, not a styled div — with the backdrop computing `rgba(2,4,9,.62)`, the dark `--scrim`. Panel 648px at 56px from the top, matching the design.
6. **Focus lands on the title field**, Escape closes, it **reopens** (which proves the `close` event syncs React state back — without that it could never reopen), and a backdrop click closes.
7. **The footer submit reaches its form.** The button sits outside the `<form>` and targets it by `form={id}`; verified the id matches.
8. **The theme row is chosen by CSS.** In light theme exactly one `role="switch"` row is in the document with `aria-checked="false"`; the other is `display: none` and therefore absent from the accessibility tree. Clicking it switches `data-theme` to dark, `body` background to `rgb(13,16,23)` (`--bg` dark), and the rows swap.
9. **Dashboard renders in both themes** — heading, Today, in-progress, This week, Recent activity, with real activity rows.

## The trap that cost this session

**The embedded QA browser reports `document.visibilityState === "hidden"` and does not composite.** In that state `document.startViewTransition()` never completes, and React's Suspense reveal is gated on it — so **every route with a `loading.tsx` shows its skeleton and never reveals its content.**

What makes this vicious rather than merely annoying:

- Nothing throws. No console error. The server HTML is correct and fully resolved (`<!--$-->`).
- The finished content *is* in the DOM, parked in a `display: none` div with `id="S:0"`, where **`querySelector` finds it perfectly happily**. Every scripted assertion about headings, buttons and text passes while the user sees nothing but a skeleton.
- `getBoundingClientRect()` returns zeroes for everything in that subtree, which reads as "element missing" rather than "you are looking at the wrong copy of the page".

I spent an afternoon on this, including a bisect against a baseline worktree, and produced a **confident and wrong** diagnosis: that `useSyncExternalStore` with differing server/client snapshots caused it. It did not. Every measurement in the bisect was taken in the broken environment, so each "revert X → fixed" result was noise. I had committed a gate banning the hook before catching it; that gate has been removed.

The correct move, and the one that resolved it in two minutes: **open the page in a browser that composites.** `mcp__plugin_chrome-devtools-mcp` reports `visibilityState: "visible"` and every route rendered correctly there, on the same commit that looked broken.

This is the previous phase's meta-lesson recurring, one level up. It is not enough to distrust a negative result; **assert the properties your measurement depends on** — here, `document.visibilityState` — before drawing any conclusion from it. Two prior sessions' notes are consistent with the same artifact: "Shadow card selectors not found in DOM" and "Expected UI components not found in Meridian Ops DOM" are exactly what a permanently-skeletonised page produces.

**Always assert `document.visibilityState === "visible"` alongside `location.pathname` before measuring anything.**

## Judgement calls worth a second look

1. **`--mono` on the This-week figures.** IBM Plex Mono's zero is slashed, which reads as technical next to the sans labels. The mockup actually uses `tabular-nums` for stat figures and reserves `--mono` for the task reference (`MER-024`), which is not buildable. If the slashed zero is wrong, delete `mono` from `week-stats.tsx` — one class — and `--mono` goes back to having no consumer.
2. **`AccountMenu` was built.** The design has one; the app had three loose controls. This was not on the list in `TOMORROW.md`, which said "topbar" without saying how much of it.
3. **Quick add stays a popover.** The owner left this open. The design's topbar create control is a split button whose primary opens the New task modal. Quick add's fast-capture flow is tested and works, so it was kept and given the design's treatment rather than replaced.
4. **Two icon sizes only.** The mockup also writes one-off 13/14/15/16px icon fonts inline in a dozen places. Those were treated as the inconsistency a primitive absorbs, not a vocabulary to reproduce.

## Not exercised

- **The populated dashboard.** Test Member has nothing assigned, so only the empty state was seen. The buckets, the week figures and the date arithmetic have 17 unit tests with a pinned `now`, but the populated *layout* — overdue callout, task rows, avatar stacks, progress bars — has not been looked at. **The owner's own account has 7 assigned tasks, so their first load will show it.** No live data was created or modified to manufacture a screenshot.
- **Admin-only surfaces**, again. The session was MEMBER.
- **Drag and drop**, again. Synthetic `DragEvent`s do not drive React's handlers.
- **`prefers-reduced-motion`** with the OS setting on. The modal's enter/exit uses `--dur-enter`/`--dur-exit`, so the existing reset covers it by construction, but it was not run.
- **The modal on a narrow viewport.** `width` is a max, and the panel is `w-full` under it, but only 1280px was used.

## Carried forward

1. **`--leave` remains unconsumed** (Phase 7). `--pj1`–`--pj6` now *are* consumed — by the dashboard rows as well as `project-row.tsx`.
2. **Cross-document crossfade still unproven**, and the reason it could not be checked here is the same `visibilityState` artifact. Worth re-checking in the compositing browser.
3. **The notification bell, pinned announcement and "time logged"** are deliberately absent, not forgotten: Phase 4, Phase 6, Phase 6.
4. **Task reference numbers (`MER-024`)** still need a schema change before the modal header can carry one.
5. **Sidebar collapse** exists in the design (`left_panel_close` / `right_panel_open`) and was not built — it is a feature, not icon application.
6. **`next-themes` script-tag warning** persists, unchanged.
