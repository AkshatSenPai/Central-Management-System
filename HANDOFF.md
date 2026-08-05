# Handoff — 2026-08-05, end of day

**Start here.** This is where the work stopped and what happens next. `TODO.md` remains the long-form backlog; this file is the shorter question of *what do I do now*.

**The goal for the next session: finish attachments, build chat, then deploy.**

---

## Where the code is

| Branch | Commit | State |
|---|---|---|
| `master` | `237ca63` | Clean, deployable, **814 tests**. Everything shipped is here. |
| `feat/r2-attachments` | 12 commits ahead | Attachments, **4 of 7 tasks done**. Clean tree, **896 tests**, gates 9/9. |

The branch ends on a **completed and reviewed task**, not a half-written one. Nothing is broken; nothing is mid-edit. `master` is unaffected and could be deployed today as-is.

---

## Done — shipped and on `master`

Everything below works and is merged.

- Tasks, projects, clients, the board, milestones
- Comments with @mentions, the notification bell, global search, announcements
- Team and member management, invites, settings
- **Searchable combobox** on the Project, Milestone and Client pickers *(shipped 2026-08-04)*
- **Calendar events** — create, edit, delete meetings on the calendar beside task deadlines, with attendee notifications *(shipped 2026-08-05, four merged steps)*

The calendar work also moved every day boundary in the app from UTC to `Asia/Kolkata`, which fixed a live bug: stepping back from 31 March used to skip February entirely.

---

## 1. Finish attachments — resume at task 5

**Branch:** `feat/r2-attachments`
**Plan:** `docs/superpowers/plans/2026-08-05-r2-attachments.md`
**Design:** §6 and §7 of `docs/superpowers/specs/2026-08-02-phase-3c-comments-attachments-design.md` — already written in Phase 3c and parked. **Do not re-invent it.**

| Task | State |
|---|---|
| 1 — pure layer: key building, filename sanitising, size validation | done |
| 2 — AWS SDK installed | done |
| 3 — R2 client, presigned PUT/GET, batch delete | done |
| 4 — service (`requestUpload`/`confirmUpload`/`removeAttachment`/sweep) and read query | done |
| **5 — server actions, upload UI, attachment list, the two icons** | **resume here** |
| 6 — wire the parent-delete hooks and place the components on pages | not started |
| 7 — browser QA | not started |

### Four rulings already settled — don't re-argue them

1. **`attach_file` and `download` are added in task 5, not before.** Gate 7 is *"every icon in `icons.ts` is used somewhere"* and fails on an icon nothing renders. They must land in the same commit as the components that use them, with the font regenerated.
2. **The delete sweep leaks rather than lies.** `deleteAttachmentObjectsFor` deletes every row regardless and never aborts the parent delete when R2 fails. It runs *nested inside* `removeTask`/`deleteClient`'s transaction, so it cannot selectively commit — the only choice is an orphaned object (invisible, reapable) or a row whose download 404s. Spec §6:108 picks the orphan.
3. **`removeAttachment` is gated on uploader-or-admin.** A deliberate extension — the spec is silent on attachment permissions, but comments (3c D3), announcements and calendar events all draw that line.
4. **`requestChecksumCalculation: "WHEN_REQUIRED"` in `r2.ts` is load-bearing.** Without it the AWS SDK bakes a checksum of an *empty* body into every presigned PUT and every upload fails with an opaque signature error. Two reviewers confirmed this by generating URLs both ways. It is not stray config — do not remove it.

### Still unproven

`deleteAttachmentObjectsFor` has **no caller** until task 6, so the nested-transaction reasoning everything above rests on is untested. **Task 7 must delete a parent that has attachments and then list the bucket prefix directly** — the UI cannot show you an orphaned object, which is exactly why the spec calls this "the part to review hardest".

---

## 2. Build chat

**Spec:** `docs/superpowers/specs/2026-08-03-in-app-chat-design.md` — written and adversarially reviewed. **Zero code exists.**

DMs plus open channels, sitting *alongside* WhatsApp rather than replacing it — that ruling is what removes presence, typing indicators, read receipts and push in one stroke. Three new models, delivery by a polled route handler, and exactly one thing writing to the notification bell.

**Be realistic about size.** §14 sequences it into four steps with its own migration. It is comparable to the calendar feature, which took most of a day. If the aim is to deploy tomorrow, **deploying before chat rather than after** is the version that fits.

---

## 3. Deploy

`TODO.md` §1 has the full checklist. Short version: Vercel on the free Hobby plan, region `sin1`, eight environment variables (four auth/app, four R2), deploy, then invite the team from **Settings → Members**.

Two things this unblocks that are impossible today: **reminders and recurring tasks** both need a live URL for cron, and **email** needs a verified domain.

---

## After the deploy

- **Time tracking** — start/stop a timer on a task; fills the dashboard's empty "logged this week" slot. New `TimeEntry` model.
- **Invoices** — wanted, not urgent. Still a placeholder page.
- **Vault** — not planned. Still a placeholder page.
- **Next.js upgrade** — `postcss` and `sharp` carry high-severity advisories reachable only through `next`. Fixing them forces `next@16.3.0`, outside the pinned `16.2.12`, in a codebase whose `AGENTS.md` opens by warning this version has breaking changes. Deliberately deferred to its own task with a full suite and browser pass behind it.

---

## Two things about this repo worth knowing before you start

**Read `node_modules/next/dist/docs/` before writing Next.js code.** `AGENTS.md` says this version has breaking changes versus what you may assume. Every Next API claim in the specs is cited to a bundled doc file for this reason.

**Never QA in the embedded browser pane.** It reports `document.visibilityState === "hidden"`, so pages with a `loading.tsx` show their skeleton forever while scripted assertions pass against a blank screen. Use `chrome-devtools-mcp` and assert `visibilityState === "visible"` before believing any measurement. This has already cost a full session once.
