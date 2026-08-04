# TODO — pick up from here

Written 2026-08-03 at the end of the session that built Phases 3c, 4 and part of 6; revised 2026-08-04. Read this first in a new chat; everything below was checked against the repo, not recalled.

**State:** `master`, working tree clean apart from untracked `.superpowers/`. **673 tests, gates 9/9**, `tsc` clean, `lint` clean (0 errors, 0 warnings), production build clean — all verified 2026-08-04 on the merged result. Not yet deployed.

**The team is six people.** Every cost and capacity figure in this file is sized for six. An earlier draft assumed fifteen, and the two specs in §3 still carry that older arithmetic in places — their conclusions hold, the numbers want correcting.

Longer context lives in `DEPLOY.md` (deployment) and `TOMORROW.md` (costs, blockers, the QA trap). Two design specs were written and adversarially reviewed on 2026-08-03; both are linked from §3.

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
- [ ] **Vercel — start on the free Hobby plan; upgrade to Pro when Vercel asks.** *(Owner decision, 2026-08-04, reversing the earlier "buy Pro up front".)* Hobby runs all of this technically — Server Actions, Route Handlers, the Prisma build step, custom domains. The constraint is licensing, not capability: Hobby is licensed for personal, non-commercial use, and an internal company tool is commercial use whether or not it earns money. In practice enforcement is an email asking you to upgrade, with roughly a week before the project is disabled. The owner's call is to run free and upgrade on that email.

  **Two things that follow.** The upgrade email is the only warning, so it has to reach an inbox somebody reads. And Hobby is single-user — the moment a second person needs the Vercel dashboard, that forces the upgrade regardless of usage.

  At six people the capacity argument is moot: normal use is roughly 26k function invocations a month, which is noise. Only chat polling would move that number, and chat is the last thing on the list.
- [ ] **Set the Vercel region to `sin1` (Singapore)** so the app sits beside the Neon database. Neon has no Mumbai region; Singapore is the closest, and leaving Vercel on the US default costs a round trip on every page.
- [ ] **Env vars** (Production): `DATABASE_URL`, `AUTH_SECRET` (a NEW one, not the local), `AUTH_URL`, `NEXT_PUBLIC_APP_URL`. The last is not optional — invite links refuse to generate without it.
- [ ] **R2 env vars** (Production), the same four now in `.env.local`: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`. There is no region variable — R2 is always `auto`.
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
| ~~**File attachments**~~ | ~~Cloudflare R2~~ — **unblocked 2026-08-03** | Bucket `cmsforuse-attachments`, private, APAC, scoped Object Read & Write token, CORS set. Moved to §3 |

**When email lands, keep status changes in-app only.** Spec §5.7 lists them as an email trigger, but 50 board moves × 2 interested people would exhaust the 100/day cap before lunch. Assignment, mentions and due-soon are the ones worth an inbox.

---

## 3. Needs nothing from you — buildable now

Roughly in order of value to a six-person studio.

- [ ] **File attachments / the R2 upload pipeline.** *(Unblocked 2026-08-03 — the bucket and credentials now exist.)* Nothing in `src/` reads or writes `Attachment` yet: there is no R2 client, no presign, no upload UI. The design is already written — §6 of `docs/superpowers/specs/2026-08-02-phase-3c-comments-attachments-design.md` — and must not be re-invented. Build it against tasks, projects and clients first; chat attachments extend it later.
- [ ] **Calendar events for meetings.** *(Owner request, 2026-08-03.)* Someone books a meeting — a client call, a sales pitch — and the whole team can see it on the shared calendar: "Priya has a client call Thursday 3pm."

  **This is a new model, not a calendar tweak.** The calendar today is a view over `Task.dueDate` and nothing else: `listTasksInRange` (`src/lib/task-queries.ts:129`) returns tasks, `CalendarGrid` renders task rows, and `src/app/(app)/calendar/page.tsx:15` states outright that no second date column exists or should be invented. An event is a different shape — title, attendees, and a start *time*.

  **The time is the hard part, and it is worth knowing before planning.** Every date in this app is day-granular and UTC-pinned deliberately: `groupByUtcDay`, `startOfUtcDay`, and `isOverdueOnDay` (`src/lib/calendar.ts:80`) exists precisely because comparing instants was wrong for a calendar cell. A meeting at 3pm is the first thing in the app that needs a clock, and it turns the UTC/IST +5:30 offset from a harmless 3am curiosity into "the meeting displays at the wrong time". Settle the timezone story before writing the model, not after.

  For the brainstorm: all-day vs timed; who counts as an attendee vs who can merely see it; whether RSVP exists at all (probably not at six people); whether the bell notifies attendees (probably yes, reusing the Phase 4 path); and recurring meetings, which need the same cron and RRULE work as recurring tasks and are likely out of the first version.

  Neighbour, not duplicate: Phase 7 below already carries "meeting notes" as its own line.

- [ ] **Time tracking** (Phase 6). Start/stop a timer on a task. Fills the "6h 12m logged this week" slot the dashboard design has and currently leaves empty. New `TimeEntry` model.
- [ ] **Vault** (Phase 5). The biggest remaining phase and the only genuinely security-critical code in the app: envelope encryption, AES-256-GCM, master key from env (you generate it — no purchase), click-to-reveal, and an access log. Its three item types split — notes and credentials need nothing; only the *files* type needs R2.
- [ ] **Phase 7**: leave calendar, meeting notes, project/task templates, invoicing, weekly auto-report.
- [x] **Searchable combobox for entity pickers — SHIPPED 2026-08-04.** *(Owner request, 2026-08-03.)* `src/components/ui/combobox.tsx` plus its pure half `src/lib/combobox.ts` (23 tests), adopted at Project and Milestone in the task form and Client in the project form. `SelectField` stays on the fourteen fixed-enum pickers. Spec: `docs/superpowers/specs/2026-08-03-searchable-combobox-design.md`; plan: `docs/superpowers/plans/2026-08-04-searchable-combobox.md`. Merged to `master` at `baaffa6`.

  **The account-lead picker in `client-form.tsx` was NOT converted** — the spec scoped it out alongside the two calendar filters, which stay native because they auto-submit on change, so picking there means navigating rather than filling a field. Revisit once these three have been used for a week.

  Three defects worth remembering, because each was caught at a different layer and the last one is the interesting one. Spec review, pre-code: `Wrap` was not exported; forwarding `disabled` to the hidden input drops the field out of `FormData`; unconditional `Escape` traps the modal open. Task review: the click handler toggled on every click, so clicking to fix a typo mid-search discarded the query — that behaviour was **mandated by the spec** and needed an owner ruling to reverse. Whole-branch review: `commit()` fired `onChange` unconditionally, so re-picking the project you already had **silently wiped the milestone** — a regression against the `<select>`, which fires no change event on re-select. No per-task review could see that one; Task 4 reviewed the keyboard handler with no call sites, Task 6 reviewed the call sites with no view of `commit()`.

- [ ] **In-app chat — DMs and open channels.** *(Spec written and adversarially reviewed 2026-08-03: `docs/superpowers/specs/2026-08-03-in-app-chat-design.md`, 15 sections, 10 numbered rulings.)* Work-context chat that sits **alongside WhatsApp, not instead of it** — the ruling that removes presence, typing indicators, read receipts, push notifications and mobile-first layout in one stroke.

  Three new models (`Conversation`, `ConversationMember`, `Message`). All channels open, with membership created lazily on first open — no invite flow and no permission check on read. Delivery is a polled `GET` Route Handler rather than a Server Action, backing off 5s focused → 30s unfocused → stopped when the tab is hidden. Exactly one thing writes to the notification bell: a new `CHAT_MENTION` type, and only from channel mentions. Unread is arithmetic over `ConversationMember.lastReadAt`, never a row per message — that is what keeps the bell meaningful.

  **§14 of the spec sequences it into four steps**, with chat-text and chat-attachments as separate deployments. Attachments depend on the R2 pipeline above being built first.

  Worth re-testing against the owner's own description of the tool's purpose — projects, client data, invoices, assigning work — which did not mention chat. The spec is written and keeps; it does not have to be next.

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
