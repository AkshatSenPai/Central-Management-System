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

## Phase 4 — half done, and the half that is missing is blocked on you

**Built and live:** the notification centre (bell, badge, panel, mark-read) with triggers on assignment, @mention and status change; and the calendar (month, week, day) with person, project and status filters.

**Not built, blocked:**

| Piece | Needs |
|---|---|
| Email delivery | A Resend API key **and a domain you own and verify**. Resend's sandbox address only delivers to your own account, so a key alone is not enough |
| Reminders (due-soon, overdue digest) | A deployed URL for Vercel Cron |
| Recurring tasks | The same cron, plus a schema change (`recurrenceRule`, `recurringTemplateId`) and an RRULE dependency |

`NotificationType` already carries `TASK_DUE_SOON` and `Notification.actorId` is nullable for exactly that case, so the reminder cron writes rows without a migration.

**Resend free tier, verified 2026-08-02:** 3,000 emails/month, **capped at 100/day**, one custom domain. That daily cap is a design constraint, not a footnote — spec §5.7 lists status changes as an email trigger, and 50 board moves × 2 interested people would rate-limit you before lunch. **Keep status changes in-app only when email lands.** Assignment, mentions and due-soon are the ones worth an inbox.

**Known papercut:** deactivated members still receive notifications. Harmless now — they cannot sign in — but worth an `active: true` filter on the recipient set before anyone leaves.

## Parked, with the trigger to unpark it

**Attachments (Phase 3c).** The `Attachment` table is migrated and live; only the R2 upload code is missing. Parked because R2 needs a Cloudflare account with a company card, which the owner does not hold personally.

Nothing on the roadmap is blocked. The only item that structurally needs object storage is the Phase 5 Vault, and there only the *files* type — notes and credentials need none.

**Unpark when** either: someone first needs to attach a brief and cannot, or the card is obtained for Vercel Pro at deployment. Do both in one call; R2 costs nothing sitting idle. Resuming needs no migration and no rework — see §6 of the 3c spec for the upload design, which is already written.

## Costs, established 2026-08-02

Nothing is paid today; the app runs on localhost and Neon's free tier. Checked against the vendors' own pricing pages:

| Service | Cost |
|---|---|
| Neon | $0 free tier (0.5 GB). Then ~$0.35/GB-month, no minimum |
| Cloudflare R2 | $0 to 10 GB, egress always free. Card needed to activate |
| **Vercel** | **$20/month** — see below |
| Resend (Phase 4) | Free: 3,000/month, **100/day**, 1 domain — verified 2026-08-02 |
| Google OAuth, Auth.js, cron | $0 |

**Vercel's free Hobby tier is licensed non-commercial**, and a studio's internal ops tool is commercial use, so a real deployment needs Pro at $20/month. That is per *Vercel seat* — the people who deploy — not per studio member, so $20 total rather than $300. It also consumes the whole of the master spec's "under ~$20/month at 15 users" criterion on its own; everything else genuinely is free at this scale.

Agreed approach: deploy to Hobby while building and testing, decide hosting properly before the team onboards. If the $20 is the sticking point the lever is hosting, not the rest — a small VPS is ~€4/month, or Cloudflare's free tier permits commercial use but needs checking against the Next.js features in use.

## Open items carried

1. **The populated dashboard has not been seen.** Item 1 above.
2. **Cross-document crossfade still unproven** — and the reason it could not be checked before is the `visibilityState` artifact. Worth retrying in the compositing browser.
3. **`prefers-reduced-motion` never exercised** with the OS setting on.
4. **Admin-only surfaces never QA'd** — the QA account is MEMBER.
5. **Drag and drop** still needs a real human drag; synthetic `DragEvent`s do not drive React's handlers.
6. **The modal on a narrow viewport** — only 1280px was used.
7. **`--leave` unconsumed** (Phase 7). `--pj1`–`--pj6` are now consumed.
8. **`next-themes` script-tag warning** persists, pre-existing since Phase 1.
