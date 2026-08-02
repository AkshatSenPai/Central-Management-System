# Next — after the visual language

Rewritten 2026-08-02, replacing the handoff of 2026-08-01. Everything below was verified against the working tree, not recalled.

## Where things stand

**On `master`.** `design-application` was merged first (fast-forward, 21 commits) and deleted, as ruled. Three commits have landed since:

```
a69b931 fix: focus the first field when a modal opens, not the close button
88e3d24 feat: build the dashboard
0954490 feat: icon system and the modal primitive
```

Gates **9/9** (was 6/6), **507 tests** (was 489), `tsc` clean, `lint` clean, `build` clean from a deleted `.next`. Working tree clean apart from untracked `.superpowers/`.

QA record: `docs/superpowers/plans/visual-language-followups.md`. **Read its "trap that cost this session" section before doing any browser QA.**

## What the last handoff asked for, and what happened

| Asked | State |
|---|---|
| **1. Icons** — 80 usages in the design, 0 in the app | **Done.** Vocabulary in `src/lib/icons.ts`, self-hosted 4.4 KB subset, `<Icon>` primitive, three gates keeping it honest. |
| **2. Modal** — blocked on the D6 ruling | **Done.** Owner reversed D6. `ui/modal.tsx` on native `<dialog>`; New task and New project converted. Spec D6 rewritten with the reversal and its boundary. |
| **3. Dashboard** | **Done**, built only from what the schema answers. |

`--mono` was restored *with* a consumer rather than empty — see the judgement call below.

Two things were built that the handoff did not name: `AccountMenu` (the design's topbar has one; the app had three loose controls) and `ui/form-error.tsx` (the same three lines were written twenty times, and none of them announced themselves to a screen reader).

## Read this before touching the browser

**The embedded QA browser does not composite — `document.visibilityState` is `"hidden"`.** In that state `document.startViewTransition()` never completes, and React's Suspense reveal is gated on it, so **every route with a `loading.tsx` shows its skeleton forever.**

It fails silently and convincingly: nothing throws, the server HTML is correct, and the real content sits in a `display:none` div where **`querySelector` still finds it**, so scripted assertions about headings and buttons all pass while the screen shows nothing. `getBoundingClientRect()` returns zeroes, which reads as "element missing".

I lost an afternoon to this and produced a confident, wrong diagnosis before catching it. Use `mcp__plugin_chrome-devtools-mcp` — it reports `visibilityState: "visible"` and everything renders.

**Assert `document.visibilityState === "visible"` as well as `location.pathname` before measuring anything.** This is the previous handoff's meta-lesson one level up: distrusting a negative result is not enough; assert the properties the measurement depends on.

## Suggested order

### 1. Look at the populated dashboard — five minutes, no code
Test Member has nothing assigned, so only the empty state was seen. **Your own account has 7 assigned tasks**, so signing in normally shows the overdue callout, task rows, avatar stacks and progress bars for the first time. No live data was created to fake this. If the layout is wrong, it is wrong now.

### 2. Decide on `--mono` in the stat card
IBM Plex Mono's zero is slashed, which reads as technical beside the sans labels. The mockup actually uses `tabular-nums` for figures and reserves `--mono` for the task reference. If you dislike it, delete `mono` from `week-stats.tsx` — one class — and `--mono` goes back to having no consumer.

### 3. Sidebar collapse
In the design (`left_panel_close` / `right_panel_open`), not built. It is a feature, not icon application, which is why it was left. Needs a persisted preference.

### 4. Task reference numbers
`MER-024` in the modal header needs a schema change. It is the last piece of the modal design that is not buildable.

### Still not buildable — do not design around these
- **Repeat weekly** — recurring tasks, Phase 4.
- **File attachments** ("Drop files here") — Phase 3c.
- **Notification bell with badge** — Phase 4.
- **Time logged**, **announcements banner** — Phase 6.

The dashboard and topbar deliberately render none of these rather than showing a zero for a feature that does not exist.

## Environment notes

Unchanged from the last handoff: `.superpowers/mint-session.mjs` mints a **Test Member** (MEMBER) token for the `authjs.session-token` cookie on localhost; `.claude/settings.local.json` grants the browser JS tool and is covered by the global gitignore; `.claude/launch.json` has `internal-cms-app` (3000) and `design-preview` (5050, serves the mockup).

`scripts/fetch-icon-font.mjs` regenerates the icon font from `src/lib/icons.ts`. Adding an icon: add the name, run the script, use it — gate 7 fails if you list one and render it nowhere, gate 8 fails if the font is stale.

## Open items carried

1. **The populated dashboard has not been seen.** Item 1 above.
2. **Cross-document crossfade still unproven** — and the reason it could not be checked before is the `visibilityState` artifact. Worth retrying in the compositing browser.
3. **`prefers-reduced-motion` never exercised** with the OS setting on.
4. **Admin-only surfaces never QA'd** — the QA account is MEMBER.
5. **Drag and drop** still needs a real human drag; synthetic `DragEvent`s do not drive React's handlers.
6. **The modal on a narrow viewport** — only 1280px was used.
7. **`--leave` unconsumed** (Phase 7). `--pj1`–`--pj6` are now consumed.
8. **`next-themes` script-tag warning** persists, pre-existing since Phase 1.
