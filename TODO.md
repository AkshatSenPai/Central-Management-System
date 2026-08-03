# TODO — pick up from here

Written 2026-08-03, at the end of the session that built Phases 3c, 4 and part of 6. Read this first in a new chat; everything below was checked against the repo, not recalled.

**State:** `master`, working tree clean apart from untracked `.superpowers/`. **650 tests, gates 9/9**, `tsc` clean, `lint` clean, production build clean. Not yet deployed.

Longer context lives in `DEPLOY.md` (deployment) and `TOMORROW.md` (costs, blockers, the QA trap).

---

## 1. Deploy — the next thing to do

Everything below is in `DEPLOY.md` in full. Short version:

- [ ] **Buy a domain.** If the studio already owns one, use `ops.<domain>` instead of buying — cheaper and clearer.
- [ ] **Decide the name before there are many tasks.** If it is not "Meridian", three things carry the old one: the sidebar brand block (`src/components/shell/sidebar.tsx`), the page title (`src/app/layout.tsx`), and — the one that matters — the `MER` task-reference prefix in `src/lib/task.ts`. References are permanent and never reused, so changing the prefix later leaves old tasks as `MER-008` and new ones as something else. Decide early or accept the split.
- [ ] **Vercel Pro**, $20/month, one seat. The free tier is licensed non-commercial and this is a company tool.
- [ ] **Set the Vercel region to `sin1` (Singapore)** so the app sits beside the Neon database. Neon has no Mumbai region; Singapore is the closest, and leaving Vercel on the US default costs a round trip on every page.
- [ ] **Env vars** (Production): `DATABASE_URL`, `AUTH_SECRET` (a NEW one, not the local), `AUTH_URL`, `NEXT_PUBLIC_APP_URL`. The last is not optional — invite links refuse to generate without it.
- [ ] Optional: `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`, plus the callback URL in Google Cloud. Email + password works without it.
- [ ] Deploy, sign in, invite the team from **Settings → Members**. Invite links are copy-paste — there is no email yet.

The build already handles Prisma: `postinstall: prisma generate` and `build: prisma migrate deploy && next build`. Both were added because either one missing fails the first Vercel build outright.

---

## 2. Blocked on a purchase or the deploy

| Item | Blocked on | Notes |
|---|---|---|
| **Email** (invites, notification emails) | Resend API key **+ a domain you own and verify** | Sandbox only delivers to your own inbox, so a key alone is not enough. Free tier: 3,000/month but **capped at 100/day** |
| **Reminders** (due-soon, overdue digest) | A deployed URL for cron | `NotificationType.TASK_DUE_SOON` and a nullable `actorId` already exist, so the cron writes rows with no migration |
| **Recurring tasks** | The same cron, plus a migration (`recurrenceRule`, `recurringTemplateId`) and an RRULE dependency | |
| **File attachments** | Cloudflare R2 (card on file, then free to 10 GB) | The `Attachment` table is already migrated. Code only — see §6 of the 3c spec for the upload design |

**When email lands, keep status changes in-app only.** Spec §5.7 lists them as an email trigger, but 50 board moves × 2 interested people would exhaust the 100/day cap before lunch. Assignment, mentions and due-soon are the ones worth an inbox.

---

## 3. Needs nothing from you — buildable now

Roughly in order of value to a fifteen-person studio.

- [ ] **Time tracking** (Phase 6). Start/stop a timer on a task. Fills the "6h 12m logged this week" slot the dashboard design has and currently leaves empty. New `TimeEntry` model.
- [ ] **Vault** (Phase 5). The biggest remaining phase and the only genuinely security-critical code in the app: envelope encryption, AES-256-GCM, master key from env (you generate it — no purchase), click-to-reveal, and an access log. Its three item types split — notes and credentials need nothing; only the *files* type needs R2.
- [ ] **Phase 7**: leave calendar, meeting notes, project/task templates, invoicing, weekly auto-report.
- [ ] **Search over comments and client notes.** Today it covers names only, and the empty state says so.
- [ ] **Deactivated members still receive notifications.** Harmless while they cannot sign in; a one-line `active: true` filter on the recipient set. Do it before anyone actually leaves.

Only **Vault** and **Invoices** are still placeholder pages. Everything else in the sidebar does something real.

---

## 4. Carried QA items

- [ ] **The populated dashboard has never been looked at.** The QA account has almost nothing assigned; your own account has real tasks, so your first sign-in is the first honest look at the overdue callout, task rows and avatar stacks.
- [ ] `prefers-reduced-motion` never exercised with the OS setting on.
- [ ] Admin-only surfaces never QA'd — the test account is MEMBER.
- [ ] Drag and drop needs a real human drag; synthetic events do not drive React's handlers.
- [ ] The modal and calendar at mobile widths — only 1280px was used.
- [ ] `next-themes` script-tag warning, pre-existing since Phase 1.

---

## 5. Read this before any browser QA

**The embedded Claude Browser pane does not composite — `document.visibilityState` is `"hidden"`.** View transitions never complete there, so every route with a `loading.tsx` shows its skeleton forever. It fails silently: the server HTML is correct and the real content sits in a `display:none` div where `querySelector` still finds it, so scripted assertions pass while the screen is blank.

Use `mcp__plugin_chrome-devtools-mcp` instead, and **assert `document.visibilityState === "visible"` alongside `location.pathname` before believing any measurement.** This cost most of a session and produced a confidently wrong diagnosis before it was caught. Full write-up in `docs/superpowers/plans/visual-language-followups.md`.
