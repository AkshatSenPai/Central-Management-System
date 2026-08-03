# TODO — pick up from here

Written 2026-08-03, at the end of the session that built Phases 3c, 4 and part of 6. Read this first in a new chat; everything below was checked against the repo, not recalled.

**State:** `master`, working tree clean apart from untracked `.superpowers/`. **650 tests, gates 9/9**, `tsc` clean, `lint` clean, production build clean. Not yet deployed.

Longer context lives in `DEPLOY.md` (deployment) and `TOMORROW.md` (costs, blockers, the QA trap).

---

## 1. Deploy — the next thing to do

Everything below is in `DEPLOY.md` in full. Short version:

- [x] **Domain: `cmsforuse.space`** — bought 2026-08-03. Use the exact values below; `AUTH_URL` and `NEXT_PUBLIC_APP_URL` must both be the full origin with `https://` and **no trailing slash**.

  ```
  AUTH_URL            https://cmsforuse.space
  NEXT_PUBLIC_APP_URL https://cmsforuse.space
  ```

  Decide whether the canonical host is the apex or `www` and set both variables to whichever you redirect *to*. A mismatch between the real origin and `AUTH_URL` breaks the sign-in callback, and a wrong `NEXT_PUBLIC_APP_URL` silently produces invite links pointing at the wrong host.

  If you enable Google sign-in, the authorised redirect URI is `https://cmsforuse.space/api/auth/callback/google`.

- [x] **Naming decision — resolved: keep `MER`.** The domain is a host, not a brand, so it no longer forces a rename. The app stays "Meridian Ops" in the sidebar and page title, and task references stay `MER-024`. This was the one item with a deadline, and it is now closed: nothing about the domain requires touching `src/lib/task.ts`.

  If the studio later picks a real product name, the three places carrying the old one are the sidebar brand block (`src/components/shell/sidebar.tsx`), the page title (`src/app/layout.tsx`), and the `TASK_REFERENCE_PREFIX` in `src/lib/task.ts`. Only the third is irreversible — existing references keep their old prefix, because a reference must never point at a different task.
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
- [ ] **Searchable project picker.** *(Owner request, 2026-08-03.)* The Project dropdown in the New/Edit task modal is a native `<select>`. Fine at four projects, unusable at fifty — you cannot type to filter, only scroll. Same problem will hit the Client picker in the project form and the Milestone picker.

  This needs a real combobox, and the app has none — **every picker in the codebase is a native `<select>`** (`SelectField` in `src/components/ui/field.tsx`), which is why they have all been free so far: the browser gives keyboard support, mobile behaviour and accessibility for nothing. A combobox has to re-implement all three.

  So build it once as `src/components/ui/combobox.tsx`, not inline in the task form: text input filtering a list, arrow keys and Enter, Escape to close, `role="combobox"` with `aria-expanded`/`aria-activedescendant`, and a hidden input carrying the chosen id so the existing Server Action form contract is untouched. Then swap in the three pickers. Keep `SelectField` for short fixed lists — status, priority, health — where a native select is genuinely better.

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
