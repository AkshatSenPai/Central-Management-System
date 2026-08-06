# Handoff — 2026-08-06

**Start here.** This is where the work stopped and what happens next. `TODO.md` remains the long-form backlog; this file is the shorter question of *what do I do now*.

**The goal for the next session: set one CORS policy, finish attachments' QA, then build chat or deploy.**

---

## The one thing blocking everything

**The R2 bucket has no CORS policy, so no file can be uploaded from a browser.** Not in production, not locally. The code is correct — R2 accepts the presigned PUT from Node — but Chrome blocks the preflight: *"No 'Access-Control-Allow-Origin' header is present on the requested resource."*

Fix it in the Cloudflare dashboard: **R2 → `cmsforuse-attachments` → Settings → CORS Policy**.

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

Only `PUT` needs listing — the download is a top-level navigation, not a `fetch`, so CORS never sees it. **This cannot be scripted with the credentials in `.env`**: that token is object-scoped and `GetBucketCors` returns `AccessDenied`. It needs the dashboard or an admin-scoped token.

Everything else on the branch is done.

---

## Where the code is

| Branch | Commit | State |
|---|---|---|
| `master` | `cda4ec9` | Clean, deployable, **814 tests**. Unaffected by any of the below. |
| `feat/r2-attachments` | 13 commits ahead | Attachments, **tasks 1-6 of 7 done**. Clean tree, **924 tests**, gates 9/9, tsc and lint clean, clean production build. |

Note: the R2 credentials live in **`.env`**, not `.env.local` — the plan and older docs both say `.env.local` and are wrong about it.

---

## 1. Finish attachments — task 7 only

**Branch:** `feat/r2-attachments`
**Plan:** `docs/superpowers/plans/2026-08-05-r2-attachments.md`

Tasks 5 and 6 landed on 2026-08-06: the four Server Actions, a `FileField` primitive, the upload control, the file list, the `attach_file` and `download` icons, both parent-delete sweeps, and the component on the task, project and client pages.

### What task 7 already proved

The R2 layer was verified end to end against the real bucket, using the app's own exports rather than a reimplementation — 16 checks, all passing:

- R2 accepts the presigned PUT, and the URL signs `content-length;content-type;host`.
- **A PUT whose body differs in size from the signed `content-length` is refused.** §6:110's second enforcement is real, not decorative.
- The presigned GET returns the bytes intact, as `Content-Disposition: attachment` under the *display* name.
- A traversal-shaped filename stays inside its own four-segment prefix.
- `deleteObjects` really empties the prefix — confirmed by listing the bucket with a **separate** client from the one under test.
- No checksum parameter is baked into the URL, so the `WHEN_REQUIRED` ruling below still holds in practice.

In the browser: the 25 MB rejection fires with **zero network requests** (the client-side check genuinely precedes minting a URL), and the Files section renders in both themes with the focus ring landing on the file picker.

### What is left, all of it gated on CORS

- [ ] Upload a small file to a task — it appears in the list, and the object is in R2.
- [ ] Download it; remove it; confirm row *and* object are gone.
- [ ] A file named with traversal characters uploads under a sanitised key **and keeps its display name in the list**.
- [ ] **Delete a task that has attachments, then list the bucket prefix directly.** The leak check. It cannot be done from the UI.
- [ ] Same for a client with attachments and no projects.
- [ ] The populated list at phone width (the empty state is already checked).
- [ ] Remove every test object; confirm the bucket is empty.

The bucket is empty right now, so anything found in it later is from that session.

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

`TODO.md` §1 has the full checklist. Short version: Vercel on the free Hobby plan, region `sin1`, eight environment variables (four auth/app, four R2), **the CORS policy above**, deploy, then invite the team from **Settings → Members**.

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
