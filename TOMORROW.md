# Tomorrow — implementing the design

Written 2026-08-01 to survive a chat switch. Everything below was verified against the working tree, not recalled.

## Where things stand

**Branch `design-application`, 20 commits ahead of `master`. Nothing merged.**

Gates right now: **6/6 pass** (`npm run gates`), **489 tests**, `npx tsc --noEmit` clean, `npm run lint` clean, `npm run build` clean. Working tree clean apart from untracked `.superpowers/`.

The Design Application phase (spec `docs/superpowers/specs/2026-08-01-design-application-design.md`, plan `docs/superpowers/plans/2026-08-01-design-application.md`) is **complete as written** — all 14 tasks. QA record: `docs/superpowers/plans/design-application-followups.md`.

**But the phase closed a smaller gap than the name suggests.** Read the next section before planning anything.

## The honest position

Split the design into three layers. Measured, not estimated:

| Layer | State | Evidence |
|---|---|---|
| **Foundation** — tokens, primitives, focus, elevation, motion | **~90% done** | 37 of 40 tokens consumed |
| **Visual language** — icons, mono, pills, dots, counts | **~0%** | design has **80** icon usages, app has **0** |
| **Screens** | Structurally present, visually plain | every route exists; Dashboard is a stub; 4 modals missing |

The foundation is real and is the hard-to-retrofit part. The visible gap is layer 2, and it is almost entirely **icons**.

### Why this happened — do not repeat it

Throughout the phase the mockup was treated as a *token dictionary*: grepped for variable **names**, never opened. Consequences:

- `--ico`/`--ico-s` were added with **invented colour values** (`#55555f`). They are actually **font shorthands** — `20px/1 'Material Symbols Outlined'`. They were later deleted for being unused, which was the right action for the wrong reason.
- The absence of an icon system was invisible, because the design's *use* of icons was never seen.

**Rule for tomorrow: render the mockup before writing code.** `npx serve docs/design/meridian-ops -l 5050`, then open `/desktop.html`. There is a `design-preview` entry in `.claude/launch.json` that does exactly this.

## The one decision that blocks work

**Spec D6 says "no modal or drawer primitive."** It inherits Phase 3a's own D6 ("no overlay primitive"), and Quick add was deliberately built as a popover to honour it.

The new mockup contains **two modals** — New task and New project. The design contradicts the decision.

**This needs an explicit ruling from the owner before any modal work starts.** It has been raised and is not yet answered. Do not quietly reverse a decision two phases have honoured.

## Suggested order for tomorrow

Smallest first, each independently shippable.

### 1. Icons — highest return, no decisions needed
80 usages in the design, 0 in the app, touches every screen, no data-model implications.

- Add the **Material Symbols Outlined** font (self-host or link — check what the mockup does).
- Restore `--ico` and `--ico-s` with the **correct** values from the mockup, i.e. font shorthands, not colours.
- Restore `--mono` (`'IBM Plex Mono',ui-monospace,monospace`) — the modal renders a task reference in it.
- Add an `<Icon>` primitive under `src/components/ui/`, following `badge.tsx`'s shape.
- Sidebar nav, topbar, empty states, buttons.

Verify by rendering the mockup beside the app, not by reading the markup.

### 2. Modal primitive — **blocked on the D6 ruling**
If approved: build it, then convert New task and New project. Note the mockup's modal is richer than the current data model — see *Not buildable yet* below.

### 3. Dashboard
Currently renders `Signed in as Test Member (MEMBER)`. The design has a pinned announcement, an overdue callout, Today, in-progress work with time logged, and a This-week stat card.

Build only what today's data supports. **Announcements and time tracking are Phase 6; notifications are Phase 4.**

### Not buildable yet — do not design around these
The mockup shows the *finished* product, several phases out:

- **Task reference numbers** (`MER-024`) — no such field exists; needs a schema change.
- **Repeat weekly** — recurring tasks, Phase 4.
- **File attachments** ("Drop files here") — Phase 3c.
- **Notification bell with badge** — Phase 4.
- **Time logged** — Phase 6.
- **Announcements banner** — Phase 6.

## Environment notes

### Getting an authenticated session
Browser QA needs a session and **no application code should be modified to bypass auth**. A local session token can be minted for the **Test Member** account (MEMBER role) with `.superpowers/mint-session.mjs`, then set as the `authjs.session-token` cookie on `localhost:3000`.

`.claude/settings.local.json` grants `mcp__Claude_Browser__javascript_tool`, which is what allows setting that cookie. It is covered by the global gitignore. **Revoke it if unwanted.**

Test Member is MEMBER, so **admin-only surfaces render differently** and were not QA'd — Settings → Members, client deletion.

### Helper scripts (untracked, in `.superpowers/`)
`qa-targets.mjs` (real IDs for QA), `qa-verify.mjs` (board state, activity, double-log detection), `qa-activity.mjs`, `restore-board.mjs` (restores the Launch Toolkit board to its original layout), `mint-session.mjs`.

### Servers
`.claude/launch.json` has `internal-cms-app` (port 3000) and `design-preview` (port 5050, serves the mockup).

## Traps learned today — these cost real time

1. **`element.focus()` does not trigger `:focus-visible`** on buttons or links, only on text inputs. A scripted focus audit reported **25 false failures**.
2. **Dev-mode navigations take 1–3s.** A 660ms poll window reported view transitions as dead when they had not started.
3. **`navigate()` sometimes lands on `/` and redirects.** Two measurements ran against the wrong page. **Always assert `location.pathname` before measuring.**
4. **Synthetic `DragEvent`s do not drive React's drag handlers.** Drag and drag-over behaviour cannot be verified from the harness; it needs a real human drag.
5. **Tailwind v4 scans the whole project**, `scripts/` and `docs/` included. A gate description containing a literal arbitrary-value class was emitted as a real utility with an invalid `var()` and **broke the CSS build**. `globals.css` now uses `source(none)` plus an explicit `@source "../**/*.{ts,tsx}"`. Do not undo that.
6. **`npm run build` can pass on a warm cache while the dev server fails.** For CSS changes, restart the dev server or delete `.next`.

**The meta-lesson: a negative result from a new measurement is a claim about the measurement until proven otherwise.** Four of today's "failures" were instrumentation, one was real.

## Corrections owed to the spec and plan

Both documents contain claims now known to be false. They were corrected in place where found, but a reader should know:

- The spec's `react-canary.d.ts` requirement was wrong — `tsc` passes without it. Corrected in §4.
- The plan's `enter`/`exit` on the layout's `<ViewTransition>` never fires; it must be `update`. Corrected in the code, and the reason is in the commit.
- The plan's Task 13 targeted React's `<ViewTransition>` for the status filters, which are native GET form submits that replace the document. Replaced with `@view-transition { navigation: auto }` — **still unverified**, see below.

## Open items carried

1. **D6 modal ruling** — blocks item 2 above.
2. **Cross-document crossfade unproven.** `@view-transition { navigation: auto }` is in place; in the QA browser the navigation fires `pageswap` with no `viewTransition`. Check in a real browser.
3. **`prefers-reduced-motion` never exercised** with the OS setting on.
4. **`--leave` unconsumed** (Phase 7), and `--ico`/`--mono` currently absent pending item 1 of tomorrow's list.
5. **Both themes not checked on every screen** — only project detail and the shell.
6. **`next-themes` script-tag warning** persists, pre-existing since Phase 1, fires on ordinary pages not just `notFound()`.
7. **Branch is not merged.** Decide whether to merge `design-application` to `master` before starting tomorrow, or keep stacking on it.

## How this work is being run

Plan first (`superpowers:writing-plans`), then execution with gates after every task and a commit per task. Merges are local (`git merge`, delete the branch); there is no remote. Browser QA that needs a real human interaction — drag, above all — is the owner's.
