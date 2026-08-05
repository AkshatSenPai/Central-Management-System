# File attachments — the R2 upload pipeline

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** attach files to tasks, projects and clients. Bytes go browser → R2 directly and never through this server.

**Spec:** `docs/superpowers/specs/2026-08-02-phase-3c-comments-attachments-design.md` — **§6 Storage** (lines 102-111) and **§7 Security** (113-121) are the design. §8's vocabulary is already half-landed (see below). **Where this plan and the spec disagree, the spec wins — report the conflict rather than choosing**, except where this plan explicitly overrides it below with a reason.

**Already in place, verified:** the `Attachment` table and `AttachmentParent` enum are migrated. `attachment.added` and `attachment.removed` are already in `ActivityAction` and `describeActivity` — Phase 3c landed the vocabulary and parked the feature. The R2 bucket, credentials and CORS exist; `.env.local` carries `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`.

**Not in place:** `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` are not installed. `attach_file` and `download` are **not** in `ICON_NAMES`.

## Global Constraints

- **The bucket is private, always.** Reads go through a short-lived presigned GET minted per click. Never make it public, never proxy bytes through this origin.
- **Upload is direct browser → R2** via presigned PUT. Routing bytes through a Server Action would hit Next's body limits and burn server memory on a file the server has no reason to see.
- **Two-step write, and the failure direction is deliberate.** `requestUpload` mints the PUT and returns the `fileKey`; the browser PUTs; `confirmUpload` writes the row. An abandoned upload leaves an **orphan object with no row** — invisible in the UI and reapable later. The reverse (row without object) would show a broken download. **Never write the row before the object exists.**
- **Keys are `{parentType}/{parentId}/{cuid}/{sanitised filename}`.** The cuid segment means knowing a task id is not enough to guess a key.
- **`fileName` is displayed but never used to build the key.** A file called `../../etc/passwd` is a display string, not a path.
- **25 MB limit, enforced twice** — client-side before requesting a URL, **and** in the presigned URL's own content-length condition, "because a client-side check alone is advice".
- Presigned URLs expire in **5 minutes** and are bound to the exact key, content-type and content-length the client declared, so one cannot be reused to write something else.
- Every action behind `requireUser()`.
- **Gate 1** (no hex, not comment-stripped), **Gate 2** (no raw `<button>`), **Gate 3** (no raw `<input>` outside `src/components/ui/` — a file input needs a primitive or an exemption; decide in Task 5 and say which), **Gate 6**, **Gates 7/8** (the font must match `icons.ts`).
- **Write real Unicode characters, never `\uXXXX` escape text.**

## ⚠️ The storage-leak surface, corrected against the code

Spec §6:111 says "`removeTask` / `deleteClient` / project deletion gain that call" and calls this "**the one place where a missed code path silently leaks storage, and it is the part to review hardest**". The warning stands. **Its list of three does not** — verified against the schema and services:

| Path | Exists? | Orphans |
|---|---|---|
| `removeTask` (`task-service.ts:312`) | yes | TASK attachments |
| `deleteClient` (`client-service.ts:124`) | yes | CLIENT attachments |
| project deletion | **no such path anywhere in the app** | — |

`Task.project` and `Task.milestone` are optional relations with **no `onDelete`**, so Prisma defaults to `SetNull` — deleting a milestone or project does not destroy tasks. `deleteClient` **refuses while any project exists** (`client-service.ts:131`). So PROJECT attachments cannot be orphaned by any delete that exists today.

**Do not invent a project-delete path to satisfy the spec.** If one is ever added, it must clear attachments, and that belongs in a comment where the deletion would go.

## File Structure

| File | Change |
|---|---|
| `package.json` | add the two AWS SDK packages |
| `src/lib/icons.ts` + font | add `attach_file`, `download`; regenerate |
| `src/lib/attachment.ts` (create) | pure: key building, filename sanitising, size and type validation |
| `tests/attachment.test.ts` (create) | its tests — the only unit-testable surface |
| `src/lib/r2.ts` (create) | the S3 client and the two presigners |
| `src/lib/attachment-queries.ts` (create) | list attachments for a parent |
| `src/lib/attachment-service.ts` (create) | `requestUpload`, `confirmUpload`, `removeAttachment`, `deleteAttachmentObjectsFor` |
| `tests/attachment-service.test.ts` (create) | the `fakeDb` two-sink harness |
| `src/server/actions/attachments.ts` (create) | the actions |
| `src/components/attachments/` (create) | the upload control and the list |
| `src/lib/task-service.ts`, `client-service.ts` | the two parent-delete hooks |

---

### Task 1: the pure layer

**Files:** create `src/lib/attachment.ts`, `tests/attachment.test.ts`

**Produces:** `buildFileKey`, `sanitiseFileName`, `validateUpload`, `formatFileSize`, `MAX_UPLOAD_BYTES`.

- [ ] **Step 1: Write the failing tests.** Cover at minimum:
  - `sanitiseFileName` strips path separators and traversal — `"../../etc/passwd"` must not survive as a path, `"a/b\\c.pdf"` must flatten. Assert the **absence** of `/`, `\` and `..` in the result, not just that it changed.
  - It preserves a readable name and the extension for ordinary input, and never returns an empty string (a file named `"..."` still needs a key segment).
  - `buildFileKey(parentType, parentId, cuid, fileName)` produces `{parentType}/{parentId}/{cuid}/{sanitised}` and **uses the sanitised name, never the raw one** — pass a traversal name and assert the key has exactly four segments.
  - `validateUpload` rejects over 25 MB and accepts at the boundary. **Derive `MAX_UPLOAD_BYTES` from 25 × 1024 × 1024 and assert the number**, so a future edit to the constant fails loudly.
  - `formatFileSize` — its contract, whatever you choose; state it in the report.
- [ ] **Step 2: Run, confirm failure. Step 3: Implement. Step 4: Run, pass.**
- [ ] **Step 5:** `npm test`, `npm run gates` 9/9, `npx tsc --noEmit`. Commit.

No Prisma, no React, no AWS import in this file — it is the only unit-testable surface here.

---

### Task 2: dependencies only

**Files:** `package.json`, `package-lock.json`

- [ ] **Step 1:** `npm i @aws-sdk/client-s3 @aws-sdk/s3-request-presigner`. Both are approved with the phase (spec §6:104).
- [ ] **Step 2:** `npm run gates` 9/9, `npm test` **853**, `npx tsc --noEmit` clean. Commit the lockfile with the manifest.

⚠️ **The icons are NOT added here, and that is deliberate.** `attach_file` and `download` belong to **Task 5**, in the same commit as the components that render them.

**Gate 7** is *"every icon in `src/lib/icons.ts` is used somewhere"*, and its comment records why: "`--ico` was added, never consumed, and later deleted for being unused. An icon nobody renders is dead weight in the font subset and a lie in the vocabulary. **Listing one is now a commitment to using it.**" Adding the icons before the UI exists would fail that gate — the plan originally sequenced it that way and was wrong.

---

### Task 3: the R2 client and presigners

**Files:** create `src/lib/r2.ts`

- [ ] **Step 1:** An `S3Client` configured for R2 — `region: "auto"`, endpoint `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, credentials from env. Read env once at module scope the way `src/lib/prisma.ts` does; match that file's shape.
- [ ] **Step 2:** `presignPut({ key, contentType, contentLength })` → a URL valid **5 minutes**, bound to that exact key, content-type **and content-length**. The content-length condition is not optional — spec §6:110 says a client-side size check "alone is advice".
- [ ] **Step 3:** `presignGet({ key })` → a URL valid 5 minutes, minted per click.
- [ ] **Step 4:** `deleteObjects(keys: string[])` — used by both the single-attachment delete and the parent-delete sweeps.
- [ ] **Step 5:** No unit tests — this wraps a third-party SDK against a live service and has no logic of its own. Say so in the report rather than writing a test that asserts the SDK was called. `npx tsc --noEmit`, `npm run lint`, `npm run gates`. Commit.

---

### Task 4: the service

**Files:** create `src/lib/attachment-service.ts`, `tests/attachment-service.test.ts`, `src/lib/attachment-queries.ts`

- [ ] **Step 1: Read `tests/calendar-event-service.test.ts`** for the two-sink `fakeDb` harness — separate write sinks for `db` and `tx` so a write outside the transaction fails loudly. Copy it.
- [ ] **Step 2: Write the failing tests**, then implement:
  - `requestUpload` — validates size and type, mints the key, returns `{ uploadUrl, fileKey }`. **Writes no row.**
  - `confirmUpload` — writes the `Attachment` row **and** `recordActivity(tx, "attachment.added")` in one transaction.
  - `removeAttachment` — deletes the R2 object **and** the row, and records `attachment.removed`.
  - `deleteAttachmentObjectsFor(parentType, parentId)` — reads the keys, deletes the objects, deletes the rows. This is what the two parent-delete paths call.
- [ ] **Step 3:** Test that `confirmUpload` never writes on the outer `db`, and that a failed object-delete does not leave the row claiming a file that is gone. **State in the report which order you chose for delete (object first or row first) and why** — one of them leaves a broken download and the other leaks storage; the spec prefers leaking.
- [ ] **Step 4:** `npm test`, gates, tsc. Commit.

---

### Task 5: actions and UI

**Files:** create `src/server/actions/attachments.ts`, `src/components/attachments/`

- [ ] **Step 1:** Actions behind `requireUser()`, opening with the revalidation-map block comment both existing action files carry.

- [ ] **Step 1b: Add `attach_file` and `download` to `ICON_NAMES` and regenerate the font — in THIS task, not earlier.** `scripts/fetch-icon-font.mjs` owns the font; read it and gates 7 and 8 first. **Gate 7 fails on any icon nothing renders**, so the icons and the components that use them must land together. **Gate 8** runs `fetch-icon-font.mjs --check` and fails if the committed font and `icons.ts` disagree. Commit the font binary alongside the list. If either gate fails, reconcile the font and the list — never edit the gate.

- [ ] **Step 2:** An upload control. ⚠️ **Gate 3 forbids a raw `<input>` outside `src/components/ui/`.** A file input is a raw input. **Decide: add a `FileField` primitive to `src/components/ui/`, or justify an exemption — and say which in the report.** Do not disable the gate.
- [ ] **Step 3:** The list — filename, size via `formatFileSize`, uploader, a download button that mints a presigned GET on click, and a remove control. Follow the existing comment-list components for shape.
- [ ] **Step 4:** Client-side size check **before** requesting a URL, with the same 25 MB constant. Both checks exist; neither replaces the other.
- [ ] **Step 5:** No unit tests for components — this repo cannot render them. tsc, lint, gates. Commit.

---

### Task 6: wire the parents, and close the leak

**Files:** modify `src/lib/task-service.ts`, `src/lib/client-service.ts`; the three parent pages

⚠️ **This is the task spec §6:111 says to review hardest.** A missed path leaks storage silently — no error, no broken UI, just objects nobody can reach and nobody is billed for noticing.

- [ ] **Step 1:** `removeTask` calls `deleteAttachmentObjectsFor("TASK", taskId)` **inside its existing transaction**.
- [ ] **Step 2:** `deleteClient` calls it for `("CLIENT", clientId)`.
- [ ] **Step 3: Do NOT add a project-delete path.** None exists. Instead, leave a comment on the `Attachment` model or in `attachment-service.ts` stating that PROJECT attachments have no delete path today **because projects cannot be deleted**, and that any future project deletion must call `deleteAttachmentObjectsFor`.
- [ ] **Step 4:** Render the attachment list and upload control on the task detail, project and client pages.
- [ ] **Step 5:** Full toolchain, then **stop any dev server, `rm -rf .next`, `npm run build`** in that order. Commit.

---

### Task 7: browser QA

⚠️ **Real Chrome via `mcp__plugin_chrome-devtools-mcp`, never the embedded pane** — it reports `visibilityState: "hidden"` and shows a correct page as a blank one. Assert `visibilityState === "visible"` before believing any measurement.

- [ ] Upload a small file to a task. It appears in the list; the object exists in R2.
- [ ] Download it — the presigned GET works and the file is intact.
- [ ] Remove it — row and object both gone.
- [ ] **Upload something over 25 MB** — rejected client-side before any URL is minted.
- [ ] **A file named with traversal characters** uploads under a sanitised key, and the display name is unchanged.
- [ ] **Delete a task that has attachments — then check the bucket.** The objects must be gone. This is the leak check and it cannot be done from the UI alone; list the bucket prefix directly.
- [ ] Same for a client with attachments and no projects.
- [ ] Both themes; phone width.
- [ ] Remove every test object and confirm the bucket prefix is empty.

---

## Self-Review

**Spec coverage.** §6's two-step write, key shape, limits and deletion → Tasks 3, 4, 6. §7's security properties → Tasks 3 and 5. §8's vocabulary → already landed; only the two icons remain (Task 2).

**The one place this plan overrides the spec**, with reason: §6:111 names three parent-delete paths; only two exist, and inventing the third would be worse than omitting it. Recorded in Task 6 Step 3.

**Out of scope:** attachments on comments or calendar events, image thumbnails, drag-and-drop upload, virus scanning, and any reaper for orphaned objects. The orphan direction is deliberate and reapable later; nothing reaps today.

## Execution Handoff

Subagent-driven, fresh implementer per task, review between each. **Never run a review concurrently with an implementer** — a review earlier in this project had to work around a mutating tree.
