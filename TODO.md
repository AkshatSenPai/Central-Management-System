# TODO — pick up from here

Written 2026-08-03 at the end of the session that built Phases 3c, 4 and part of 6; revised 2026-08-04. Read this first in a new chat; everything below was checked against the repo, not recalled.

**State:** `master`, working tree clean apart from untracked `.superpowers/`. **814 tests, gates 9/9**, `tsc` clean, `lint` clean (0 errors, 0 warnings), production build clean — all verified 2026-08-05 on the merged result. Not yet deployed.

**The team is six people.** Every cost and capacity figure in this file is sized for six. An earlier draft assumed fifteen, and the two specs in §3 still carry that older arithmetic in places — their conclusions hold, the numbers want correcting.

Longer context lives in `DEPLOY.md` (deployment) and `TOMORROW.md` (costs, blockers, the QA trap). Two design specs were written and adversarially reviewed on 2026-08-03; both are linked from §3.

---

## 0. In flight — `feat/r2-attachments`, paused 2026-08-05

**Read this before starting anything.** The R2 attachment pipeline is half built on a branch, not on `master`. `master` is at `237ca63` and is clean, deployable, and unaffected by any of it.

**Branch state (2026-08-06):** 14 commits ahead of `master`. **924 tests, gates 9/9, tsc clean, lint clean, clean production build.** Working tree clean. **All seven tasks are done, including the browser QA. The feature is finished and the branch is ready to merge into `master`** — that merge is the next action and nobody has done it yet.

**Plan:** `docs/superpowers/plans/2026-08-05-r2-attachments.md`. **Design:** §6 and §7 of `docs/superpowers/specs/2026-08-02-phase-3c-comments-attachments-design.md` — this needed a plan, not a new spec, because Phase 3c already designed it and parked it.

| Task | State |
|---|---|
| 1 — pure layer (`attachment.ts`) | done, 2 fix rounds, re-review clean |
| 2 — SDK install | done |
| 3 — R2 client and presigners (`r2.ts`) | done, 1 fix round |
| 4 — service and query | done, 2 fix rounds, re-review clean |
| 5 — actions, UI, and the two icons | done 2026-08-06 |
| 6 — parent-delete hooks and page wiring | done 2026-08-06 |
| 7 — browser QA | **done 2026-08-06 — full click-through passed** |

**What task 7 proved.** The R2 layer was verified against the real bucket using the app's own `presignPut`/`presignGet`/`deleteObjects` — 16 checks — and then the whole feature was clicked through in real Chrome. Highlights, because two of these are properties nobody had actually seen hold:

- **A PUT whose body size differs from the signed `content-length` is refused by R2.** §6:110's second enforcement is real, not decorative.
- **Deleting a task with two attachments left `TASK/{id}/` with zero objects and zero rows.** The leak §6:111 calls "the part to review hardest" is closed, verified by listing the prefix directly rather than trusting the UI. Same result for a client.
- A file named `../../../etc/passwd` stored under key segment `etc_passwd` — four segments, inside its own prefix — while the list and the activity log both show the name **verbatim**. Sanitised as a path, untouched as a display string, simultaneously.
- Download saved the file under its **display** name (`kickoff notes.txt`, space intact), not the sanitised key segment, and did not unload the page.
- Over-25 MB is rejected with **zero** network requests, so the client-side check genuinely precedes minting a URL.
- Both themes, and the populated list at phone width with no horizontal overflow.

The bucket and the `Attachment` table were both left empty.

**One gap, deliberate:** every upload was driven by constructing a `File` in JavaScript, because the OS file-picker dialog cannot be scripted. Everything downstream of the pick is proven; the dialog itself is not.

**Four rulings a fresh session would otherwise re-litigate:**

- **`attach_file` and `download` must be added in task 5, not earlier.** Gate 7 is "every icon in `icons.ts` is used somewhere" and fails on an icon nothing renders. The plan originally had them in task 2 and was wrong; it is corrected, but the reasoning is easy to lose.
- **`deleteAttachmentObjectsFor` deletes every row regardless and never aborts the parent delete on an R2 failure.** Leak, do not lie — spec §6:108. It cannot selectively commit because task 6 nests it inside `removeTask`/`deleteClient`'s transaction. This was a real bug found by review: task 3's fix made `deleteObjects` non-atomic, and task 4 assumed a throw meant nothing was deleted. Neither was wrong alone.
- **`removeAttachment` gates on uploader-or-admin.** A deliberate extension of the spec, which is silent on attachment permissions — it matches 3c's D3 for comments and the same rule in announcements and calendar events.
- **`requestChecksumCalculation: "WHEN_REQUIRED"` in `r2.ts` is load-bearing.** Without it the SDK bakes a checksum of an *empty* body into every presigned PUT and all uploads fail. Two reviewers confirmed it by generating URLs both ways. It is not stray config.

**Still open on this branch:** `deleteAttachmentObjectsFor` has no call site until task 6, so its nested-transaction reasoning is unverified. Task 7 must delete a parent that has attachments and then **list the bucket prefix directly** — that is the only way to prove the leak is closed.

**After R2:** chat (spec written and reviewed, four sequenced steps, zero code), then deploy, then time tracking, then invoices.

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
- [ ] **R2 env vars** (Production), the same four now in **`.env`** (not `.env.local` — earlier drafts of this file and the plan both say `.env.local`; the values are actually in `.env`): `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`. There is no region variable — R2 is always `auto`.
- [ ] **⚠️ Confirm the production origin is in the R2 bucket's CORS policy. Uploads cannot work without it.** Found 2026-08-06 during task 7's browser pass — the bucket had no CORS rules at all, and Chrome blocked every upload at the preflight (*"No 'Access-Control-Allow-Origin' header is present"*) while R2 accepted the identical presigned URL from Node. **A policy was applied that day and uploads now work locally**, but check it lists `https://cmsforuse.space` before trusting attachments in production. **R2 → cmsforuse-attachments → Settings → CORS Policy**:

  ```json
  [
    {
      "AllowedOrigins": ["https://cmsforuse.space", "http://localhost:3000"],
      "AllowedMethods": ["PUT"],
      "AllowedHeaders": ["content-type"],
      "MaxAgeSeconds": 3600
    }
  ]
  ```

  **Only `PUT` needs listing.** The download is a top-level navigation (`window.location.href`), not a `fetch`, so it is not a CORS request at all. `content-type` is the only header the browser asks permission for — `content-length` is set by the browser itself and is never in a preflight.

  This cannot be done with the credentials in `.env`: that token is object-scoped, and `GetBucketCors` on it returns `AccessDenied`. It needs the dashboard, or an admin-scoped API token.
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
- [x] **Calendar events for meetings — SHIPPED 2026-08-05.** *(Owner request, 2026-08-03.)* Create, edit and delete events on the calendar beside task deadlines; attendees get a bell row when one is scheduled or moved. Spec: `docs/superpowers/specs/2026-08-04-calendar-events-design.md`. Plans: the four in `docs/superpowers/plans/` dated 2026-08-04 and 2026-08-05.

  **It shipped in four separately-merged steps, and the first one was not the feature.** Every date in this app was day-granular and pinned to UTC, deliberately. A 3pm meeting was the first thing that needed a clock, so step 1 moved every day boundary to a single app timezone (`APP_TIMEZONE = "Asia/Kolkata"`, `startOfAppDay`, and the four app-field accessors in `src/lib/dates.ts`) with **no new tables and no feature**, so a red suite could only be blamed on one half. Stored dates kept their day because every one is a UTC-midnight instant, which always falls inside the matching IST day — verified over 55,152 instants across 150 years.

  **That step fixed a live bug you had.** `stepAnchor`'s month arithmetic read UTC fields off a value that had become an app-midnight instant: stepping back from 31 March skipped February entirely, and the forward arrow from the 31st did nothing. Three tests already in the repo caught it.

  **What is deliberately not there:** recurring events (needs the same cron and RRULE work as recurring tasks — revisit together), RSVP, per-user timezones, external calendar sync, and any conflict detection. Overlapping events render side by side; nothing warns you are double-booked.

  Neighbour, not duplicate: Phase 7 below still carries "meeting notes" as its own line.

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
