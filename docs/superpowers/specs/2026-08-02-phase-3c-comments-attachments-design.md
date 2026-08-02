# Phase 3c — Comments, @mentions & Attachments

**Runs after:** the visual language phase (icons, modal primitive, dashboard).
**Delivers:** the rest of §5.3 — "comments with @mentions, attachments" — plus the `Comment` and `Attachment` models from the master spec's data sketch (§7).

## 1. Why now

Phases 3a and 3b made the app somewhere work is *tracked*. Nothing in it lets anyone say anything about that work. Discussion currently happens in WhatsApp, which means the reason a task changed lives outside the tool that records the change.

Attachments have the same shape of problem: a brief, a contract or a proof is emailed around and the task links to nothing.

## 2. Scope

**In:**

- Comments on tasks — add, edit own, delete own or any (admin), flat, newest last.
- @mentions of active members inside a comment body, rendered as links to the member profile.
- Attachments on **tasks, projects and clients**, stored in Cloudflare R2, uploaded direct from the browser via presigned PUT and read via short-lived presigned GET.
- Activity log entries for every one of the above.

**Out:**

- **Notification of a mention.** §5.7 puts the notification centre and Resend in Phase 4. A mention in 3c records and renders; nobody is told. This mirrors 3b, where a task assigned via quick-add notifies nobody. Say so in the UI rather than implying otherwise.
- **Rich text / markdown.** Ruled out below (D1).
- Threaded replies, reactions, comment attachments as a distinct concept, comment search.
- Vault files (Phase 5) — a different model with envelope encryption, not this one.
- Virus scanning, image thumbnailing, previews. A file is a name, a size and a download.

## 3. Owner rulings

| # | Decision |
|---|---|
| **D1** | **Comment bodies are plain text**, not markdown. Line breaks are preserved, bare URLs become links, `@Name` becomes a mention link. **No HTML is generated anywhere** — the renderer emits React elements, so React's own escaping is the whole XSS story and there is nothing to sanitise. A markdown parser plus a sanitiser would be two dependencies and a permanent security surface, in exchange for bold text in a task comment. Revisit if people start asking for lists. |
| **D2** | **Attachments on all three parents** — task, project and client. `parentType` is in the model regardless, per §7; building one surface and deferring two would leave the polymorphic path half-exercised and untested. |
| **D3** | **The author may edit their own comment; the author or an admin may delete.** An edited comment is marked "edited" so the thread stays honest, and every edit and delete writes to the activity log. Immutable comments were considered and rejected: a wrong @mention would be permanent. |

## 4. Data model

```prisma
model Comment {
  id               String   @id @default(cuid())
  task             Task     @relation(fields: [taskId], references: [id], onDelete: Cascade)
  taskId           String
  author           User     @relation("CommentAuthor", fields: [authorId], references: [id])
  authorId         String
  body             String
  /// Denormalised at write time, per the master spec's sketch. The renderer
  /// re-derives mentions from the body against the member list, so this array
  /// is not what draws them — it is what Phase 4 will query to notify people,
  /// and what makes "tasks where I was mentioned" answerable without scanning
  /// every body.
  mentionedUserIds String[]
  /// Null until the first edit. Presence is what renders the "edited" marker;
  /// updatedAt cannot do that job because Prisma touches it on every write.
  editedAt         DateTime?
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  @@index([taskId, createdAt])
}

enum AttachmentParent {
  TASK
  PROJECT
  CLIENT
}

model Attachment {
  id           String           @id @default(cuid())
  parentType   AttachmentParent
  /// Deliberately NO relation and no onDelete — the same decision as
  /// ActivityLog.clientId. A polymorphic parent cannot carry three foreign
  /// keys at once. The cost is that orphan rows and orphan R2 objects are the
  /// service layer's job, not the database's: see §6.
  parentId     String
  /// The R2 object key. Unique so a retried upload cannot register twice.
  fileKey      String           @unique
  fileName     String
  contentType  String
  size         Int
  uploadedBy   User             @relation("AttachmentUploader", fields: [uploadedById], references: [id])
  uploadedById String
  createdAt    DateTime         @default(now())

  @@index([parentType, parentId, createdAt])
}
```

`Task` gains `comments Comment[]`; `User` gains `comments Comment[] @relation("CommentAuthor")` and `attachments Attachment[] @relation("AttachmentUploader")`.

## 5. Mentions

Bodies are stored exactly as typed: `ask @Dana Reeve about the copy`. There is no `@[id]` token, because a stored body should be readable in the database and re-editable as the author wrote it.

Resolution is **longest-name-first matching against the active member list**, at both save time (to fill `mentionedUserIds`) and render time (to draw the links). Consequences, accepted:

- Two active members with identical names resolve to the first. Fifteen people; if it happens, they can be told apart by title, and the fix is a display-name rule, not a schema change.
- Renaming a member re-points their old mentions to the new name — arguably correct for an internal tool.
- Someone typing `@Dana Reeve` when no such member exists gets literal text, not a broken link.

## 6. Storage

Cloudflare R2, S3-compatible, via `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` (approved with the phase).

- **Private bucket.** No public access, ever. Reads go through a short-lived presigned GET minted per click.
- **Upload is direct browser → R2** via a presigned PUT. Routing bytes through a Server Action would hit Next's body limits and burn server memory on a file the server has no reason to see.
- **Two-step write.** `requestUpload` mints the presigned PUT and returns the `fileKey`; the browser PUTs; `confirmUpload` writes the `Attachment` row. A failed or abandoned upload therefore leaves an orphan **object** with no row, which is invisible in the UI and reapable later — the safe direction to fail. The reverse (row without object) would show a broken download.
- **Keys are namespaced and non-guessable**: `{parentType}/{parentId}/{cuid}/{sanitised filename}`. The cuid segment means knowing a task id is not enough to guess a key.
- **Limits:** 25 MB per file, enforced client-side before requesting a URL *and* in the presigned URL's own content-length condition, because a client-side check alone is advice.
- **Deletion:** removing an attachment deletes the R2 object and the row. Deleting a *parent* (task, project, client) must delete its attachments' objects too — the database cannot cascade to R2, so `removeTask` / `deleteClient` / project deletion gain that call. **This is the one place where a missed code path silently leaks storage, and it is the part to review hardest.**

## 7. Security

- Every action is behind `requireUser()`, as everywhere else.
- Presigned URLs are minted only after the caller's session is checked, and expire in 5 minutes.
- The upload URL is bound to the exact key, content-type and content-length the client declared, so it cannot be reused to write something else.
- `fileName` is displayed but never used to build the key; the key uses a sanitised copy. A file called `../../etc/passwd` is a display string, not a path.
- No file is ever served from our origin, so no stored-XSS-by-upload: an HTML file in the bucket is downloaded from R2's domain via a presigned URL, not rendered on ours.
- Comment bodies are never HTML. See D1.

## 8. Vocabulary lock

New activity verbs, added to `ActivityAction` and `describeActivity`:

`comment.added` · `comment.edited` · `comment.deleted` · `attachment.added` · `attachment.removed`

New icons: `attach_file`, `alternate_email`, `chat_bubble`, `download`. Added to `src/lib/icons.ts` and the font regenerated — gate 7 fails otherwise.

## 9. Success criteria

- [ ] A member can comment on a task, mention a colleague, and see the mention link to that colleague's profile.
- [ ] An author can edit their own comment; it shows "edited". A non-author cannot edit it.
- [ ] An admin can delete anyone's comment; a member can delete only their own.
- [ ] Every comment and attachment event appears in the client's activity timeline.
- [ ] A file can be attached to a task, a project and a client, and downloaded again.
- [ ] Deleting a task deletes its attachments' R2 objects, verified by listing the bucket.
- [ ] `mentionedUserIds` is populated correctly, ready for Phase 4 to notify from.
- [ ] The mention UI states plainly that nobody is notified yet.
- [ ] Gates pass, including the two new ones, and the phase adds tests for every pure function it introduces.
