# Handoff — 2026-08-06

**Start here.** This is where the work stopped and what happens next. `TODO.md` remains the long-form backlog; this file is the shorter question of *what do I do now*.

**The goal for the next session: deploy. Then build chat.**

---

## Where the code is

| Branch | State |
|---|---|
| `master` | Clean and deployable. **924 tests**, gates 9/9, tsc and lint clean, clean production build. **Attachments are merged in.** |

`feat/r2-attachments` was merged on 2026-08-06 and deleted. Nothing is in flight; there is no half-built branch to pick up.

Note: the R2 credentials live in **`.env`**, not `.env.local` — the attachments plan and older docs both say `.env.local` and are wrong about it.

---

## Done — shipped and on `master`

Everything below works and is merged.

- Tasks, projects, clients, the board, milestones
- Comments with @mentions, the notification bell, global search, announcements
- Team and member management, invites, settings
- **Searchable combobox** on the Project, Milestone and Client pickers *(shipped 2026-08-04)*
- **Calendar events** — create, edit, delete meetings on the calendar beside task deadlines, with attendee notifications *(shipped 2026-08-05, four merged steps)*
- **File attachments** — attach files to a task, project or client; browser uploads straight to Cloudflare R2 and downloads through a presigned URL minted per click *(shipped 2026-08-06, seven tasks)*

The calendar work also moved every day boundary in the app from UTC to `Asia/Kolkata`, which fixed a live bug: stepping back from 31 March used to skip February entirely.

---

## ⚠️ One thing attachments need per environment: a CORS policy

The bucket needs a CORS policy or **no file can be uploaded from a browser** — the code is fine, Chrome just blocks the preflight. This was missing entirely until 2026-08-06 and blocked the whole QA pass. It now lists `http://localhost:3000` and `https://cmsforuse.space`.

**Confirm the production origin is really in there before trusting attachments after deploying.** The failure looks like a generic "could not be uploaded" in the UI, with the real reason only in the browser console.

**Cloudflare → R2 → `cmsforuse-attachments` → Settings → CORS Policy:**

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

Only `PUT` needs listing — the download is a top-level navigation, not a `fetch`, so CORS never sees it. Only `content-type` — `content-length` is browser-set and never appears in a preflight. **Not scriptable with the credentials in `.env`**: that token is object-scoped and `GetBucketCors` returns `AccessDenied`. Dashboard, or an admin-scoped token.

---

## 1. Deploy — the next thing to do

`TODO.md` §1 has the full checklist. Short version: Vercel on the free Hobby plan, region `sin1`, eight environment variables (four auth/app, four R2), the CORS origin above, deploy, then invite the team from **Settings → Members**.

Two things this unblocks that are impossible today: **reminders and recurring tasks** both need a live URL for cron, and **email** needs a verified domain.

---

## 2. Build chat

**Spec:** `docs/superpowers/specs/2026-08-03-in-app-chat-design.md` — written and adversarially reviewed. **Zero code exists.**

DMs plus open channels, sitting *alongside* WhatsApp rather than replacing it — that ruling is what removes presence, typing indicators, read receipts and push in one stroke. Three new models, delivery by a polled route handler, and exactly one thing writing to the notification bell.

**Be realistic about size.** §14 sequences it into four steps with its own migration. It is comparable to the calendar feature, which took most of a day. **Deploying before chat rather than after** is the version that fits.

---

## After the deploy

- **Time tracking** — start/stop a timer on a task; fills the dashboard's empty "logged this week" slot. New `TimeEntry` model.
- **Invoices** — wanted, not urgent. Still a placeholder page.
- **Vault** — not planned. Still a placeholder page.
- **Next.js upgrade** — `postcss` and `sharp` carry high-severity advisories reachable only through `next`. Fixing them forces `next@16.3.0`, outside the pinned `16.2.12`, in a codebase whose `AGENTS.md` opens by warning this version has breaking changes. Deliberately deferred to its own task with a full suite and browser pass behind it.

---

## Attachments — the rulings, so nobody re-argues them

The plan is `docs/superpowers/plans/2026-08-05-r2-attachments.md`, with the QA results recorded under task 7. The design is §6 and §7 of `docs/superpowers/specs/2026-08-02-phase-3c-comments-attachments-design.md`.

1. **`requestChecksumCalculation: "WHEN_REQUIRED"` in `r2.ts` is load-bearing.** Without it the SDK bakes a checksum of an *empty* body into every presigned PUT and all uploads fail with an opaque signature error. Verified twice, most recently by decoding a real URL.
2. **The delete sweep leaks rather than lies.** `deleteAttachmentObjectsFor` deletes every row regardless and never aborts the parent delete when R2 fails. It runs nested inside `removeTask`/`deleteClient`'s transaction, so it cannot selectively commit. Spec §6:108 picks the orphan.
3. **The sweep is the LAST statement in each transaction, not the first.** It is the only step touching something Postgres cannot roll back, so nothing later can undo a bucket change that already happened. Placed first, a P2025 race on `task.delete` would roll the rows back into existence pointing at objects already deleted.
4. **`removeAttachment` is gated on uploader-or-admin** — a deliberate extension; the spec is silent, but comments (3c D3), announcements and calendar events all draw that line.
5. **The download action takes an `attachmentId`, never a `fileKey`,** and `fileKey` is not on `AttachmentRow` at all. An action that signs whatever key it is handed signs *any* key in the bucket. This version of Next's own Server Actions guide prescribes the id form directly.
6. **No project-delete path was invented.** None exists in the app, so §6:111's third call site has nothing to attach to. What a future one would have to do is recorded on `deleteAttachmentObjectsFor` itself.

**Before you touch `task-service.ts` or `client-service.ts`:** both now reach `r2.ts` through `attachment-service.ts`, and **`r2.ts` builds its `S3Client` at module scope** — so any test file importing either service throws on import without the four R2 env vars. Both suites mock `@/lib/r2`, the pattern `attachment-service.test.ts` documents at length. If a new suite imports a service and dies before running a single test, that is why.

**The one thing QA could not cover:** every upload in the browser pass was driven by constructing a `File` in JavaScript, because the OS file-picker dialog cannot be scripted. Everything downstream of the pick is proven; the dialog itself is not. Worth one human click.

---

## Three things about this repo worth knowing before you start

**Read `node_modules/next/dist/docs/` before writing Next.js code.** `AGENTS.md` says this version has breaking changes versus what you may assume. Every Next API claim in the specs is cited to a bundled doc file for this reason. It paid off twice on 2026-08-06: the 1 MB Server Action body limit is why the upload control's form action is a *client* function, and the "send a reference, re-read the rest from a trusted source" rule is ruling 5 above.

**Never QA in the embedded browser pane.** It reports `document.visibilityState === "hidden"`, so pages with a `loading.tsx` show their skeleton forever while scripted assertions pass against a blank screen. Use `chrome-devtools-mcp` and assert `visibilityState === "visible"` before believing any measurement. This has already cost a full session once.

**Tailwind v4 silently drops a class written flush against a `${`.** It finds classes by scanning source text, so `has-[:disabled]:opacity-50${className ? …}` compiled to nothing while every other class on the same line worked — no error, just a control that renders at full opacity when disabled. Keep a space, or build the class string as its own constant.
