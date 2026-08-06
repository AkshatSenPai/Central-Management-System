# Handoff — 2026-08-06

**Start here.** This is where the work stopped and what happens next. `TODO.md` remains the long-form backlog; this file is the shorter question of *what do I do now*.

**The goal for the next session: merge the attachments branch, then deploy.**

---

## Attachments are finished

All seven tasks are done and the browser QA passed end to end on 2026-08-06. **`feat/r2-attachments` is ready to merge into `master` and nobody has merged it yet — that is the next action.**

One thing to carry forward: the bucket needed a **CORS policy**, which did not exist and blocked every browser upload until it was set. It now lists `http://localhost:3000` and `https://cmsforuse.space`. **Verify the production origin is really there before trusting attachments after deploying** — a fresh bucket or a new origin needs this again, and the failure looks like a generic "could not be uploaded" with the real reason only in the browser console.

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

Only `PUT` needs listing — the download is a top-level navigation, not a `fetch`, so CORS never sees it. Only `content-type` — `content-length` is browser-set and never appears in a preflight. **Not scriptable with the credentials in `.env`**: that token is object-scoped and `GetBucketCors` returns `AccessDenied`. Dashboard or an admin-scoped token.

---

## Where the code is

| Branch | Commit | State |
|---|---|---|
| `master` | `cda4ec9` | Clean, deployable, **814 tests**. Does not yet have attachments. |
| `feat/r2-attachments` | 14 commits ahead | Attachments, **all 7 tasks done and QA'd**. Clean tree, **924 tests**, gates 9/9, tsc and lint clean, clean production build. **Ready to merge.** |

Note: the R2 credentials live in **`.env`**, not `.env.local` — the plan and older docs both say `.env.local` and are wrong about it.

---

## 1. Merge attachments

**Branch:** `feat/r2-attachments`
**Plan:** `docs/superpowers/plans/2026-08-05-r2-attachments.md` — every task checked off, with the QA results recorded under task 7.

Tasks 5-7 landed on 2026-08-06: the four Server Actions, a `FileField` primitive, the upload control, the file list, the `attach_file` and `download` icons, both parent-delete sweeps, the component on the task/project/client pages, and the full browser pass.

### What QA proved

- **A PUT whose body size differs from the signed `content-length` is refused by R2.** §6:110's second enforcement is real, not decorative.
- **Deleting a task with two attachments left its bucket prefix with zero objects and zero rows.** The leak §6:111 calls "the part to review hardest" is closed — verified by listing the prefix directly, not by trusting the UI. Same for a client.
- A file named `../../../etc/passwd` stored under key segment `etc_passwd`, four segments, inside its own prefix — while the list *and* the activity log show the name verbatim. §7:118 holding in both directions at once.
- Download saves under the **display** name (`kickoff notes.txt`, space intact), not the sanitised key segment, and does not unload the page.
- Over-25 MB rejected with **zero** network requests.
- Both themes; populated list at phone width, no horizontal overflow.

The bucket and the `Attachment` table were both left empty.

**One gap, deliberate:** every upload was driven by constructing a `File` in JavaScript, because the OS file-picker dialog cannot be scripted. Everything downstream of the pick is proven; the dialog itself is not. It is the least likely thing to be broken, but it is the one step a human should click once.

### Rulings — don't re-argue these

1. **`requestChecksumCalculation: "WHEN_REQUIRED"` in `r2.ts` is load-bearing.** Without it the SDK bakes a checksum of an *empty* body into every presigned PUT and all uploads fail with an opaque signature error. Verified again on 2026-08-06 by decoding a real URL.
2. **The delete sweep leaks rather than lies.** `deleteAttachmentObjectsFor` deletes every row regardless and never aborts the parent delete when R2 fails. It runs nested inside `removeTask`/`deleteClient`'s transaction, so it cannot selectively commit. Spec §6:108 picks the orphan.
3. **The sweep is the LAST statement in each transaction, not the first.** It is the only step that touches something Postgres cannot roll back, so nothing later can undo a bucket change that already happened. Placed first, a P2025 race on `task.delete` would roll the rows back into existence pointing at objects already deleted.
4. **`removeAttachment` is gated on uploader-or-admin** — a deliberate extension; the spec is silent, but comments (3c D3), announcements and calendar events all draw that line.
5. **The download action takes an `attachmentId`, never a `fileKey`,** and `fileKey` is not on `AttachmentRow` at all. An action that signs whatever key it is handed signs *any* key in the bucket. This version of Next's own Server Actions guide prescribes the id form directly.
6. **No project-delete path was invented.** None exists in the app, so §6:111's third call site has nothing to attach to. What a future one would have to do is recorded on `deleteAttachmentObjectsFor` itself.

### One thing worth knowing before you touch the services

`task-service.ts` and `client-service.ts` now reach `r2.ts` through `attachment-service.ts`, and **`r2.ts` builds its `S3Client` at module scope** — so any test file that imports either service throws on import without the four R2 env vars. Both suites mock `@/lib/r2`, the pattern `attachment-service.test.ts` documents. If a new suite imports a service and dies before running a test, that is why.

---

## 2. Build chat

**Spec:** `docs/superpowers/specs/2026-08-03-in-app-chat-design.md` — written and adversarially reviewed. **Zero code exists.**

DMs plus open channels, sitting *alongside* WhatsApp rather than replacing it — that ruling is what removes presence, typing indicators, read receipts and push in one stroke. Three new models, delivery by a polled route handler, and exactly one thing writing to the notification bell.

**Be realistic about size.** §14 sequences it into four steps with its own migration. It is comparable to the calendar feature, which took most of a day. **Deploying before chat rather than after** is the version that fits.

---

## 3. Deploy

`TODO.md` §1 has the full checklist. Short version: Vercel on the free Hobby plan, region `sin1`, eight environment variables (four auth/app, four R2), **`https://cmsforuse.space` confirmed in the bucket's CORS policy**, deploy, then invite the team from **Settings → Members**.

Two things this unblocks that are impossible today: **reminders and recurring tasks** both need a live URL for cron, and **email** needs a verified domain.

---

## After the deploy

- **Time tracking** — start/stop a timer on a task; fills the dashboard's empty "logged this week" slot. New `TimeEntry` model.
- **Invoices** — wanted, not urgent. Still a placeholder page.
- **Vault** — not planned. Still a placeholder page.
- **Next.js upgrade** — `postcss` and `sharp` carry high-severity advisories reachable only through `next`. Fixing them forces `next@16.3.0`, outside the pinned `16.2.12`, in a codebase whose `AGENTS.md` opens by warning this version has breaking changes. Deliberately deferred to its own task with a full suite and browser pass behind it.

---

## Two things about this repo worth knowing before you start

**Read `node_modules/next/dist/docs/` before writing Next.js code.** `AGENTS.md` says this version has breaking changes versus what you may assume. Every Next API claim in the specs is cited to a bundled doc file for this reason. It paid off twice on 2026-08-06: the 1 MB Server Action body limit is why the upload control's form action is a *client* function, and the "send a reference, re-read the rest from a trusted source" rule is ruling 5 above.

**Never QA in the embedded browser pane.** It reports `document.visibilityState === "hidden"`, so pages with a `loading.tsx` show their skeleton forever while scripted assertions pass against a blank screen. Use `chrome-devtools-mcp` and assert `visibilityState === "visible"` before believing any measurement. This has already cost a full session once.

**One more, learned on 2026-08-06:** Tailwind v4 finds classes by scanning source text, and a class written flush against a `${` interpolation is **not** recognised. `has-[:disabled]:opacity-50${className ? …}` compiled to nothing while every other class on the same line worked — no error, just a control that renders at full opacity when disabled. Keep a space, or build the class string as its own constant.
