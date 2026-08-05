import { randomUUID } from "crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { ActionResult, ok, err } from "@/lib/action-result";
import { recordActivity } from "@/lib/activity";
import { buildFileKey, validateUpload, type AttachmentParentType } from "@/lib/attachment";
import { presignPut, deleteObjects } from "@/lib/r2";

/** `requestUpload`, `confirmUpload`, `removeAttachment` and
 * `deleteAttachmentObjectsFor` — spec §6's two-step write, its deletion
 * rule, and the parent-delete sweep Task 6 wires up. No React, no R2-shaped
 * assumptions beyond `r2.ts`'s three exports — this file's own logic is the
 * DB half of the pipeline, matching the split `r2.ts`'s header describes for
 * the R2 half. */

/** Narrow read surface `resolveParentScope` needs — task, project and
 * client reads only, never a write. Matches `ActivityDb`
 * (`activity.ts:63`) and `NotificationDb` (`notification-service.ts:8`)'s
 * own narrow-`Pick` shape: a function that only ever reads three delegates
 * should not have to accept the whole `PrismaClient` to do it, and this
 * narrowing is also what lets `resolveParentScope` run against either the
 * outer `db` or a `tx` — both structurally satisfy the same three keys. */
type ParentScopeDb = Pick<PrismaClient, "task" | "project" | "client">;

/** `Attachment` has no `clientId` column — the model is deliberately
 * polymorphic (schema.prisma:472-482: "a polymorphic parent cannot carry
 * three foreign keys at once"), so every write that needs the activity
 * log's `clientId` scope has to walk the real parent to find it. This is
 * the same problem `loadCommentScope` (`comment-service.ts:28`) solves for
 * a comment's fixed task -> project -> client chain, generalised over all
 * three `AttachmentParentType`s instead of one:
 *
 * - `CLIENT`: the parent IS the client — no hop needed.
 * - `PROJECT`: one hop, the project's own `clientId`.
 * - `TASK`: two hops, and — same as `loadCommentScope` — a personal task
 *   with no project resolves to `null` rather than throwing. `Task.project`
 *   is optional (schema.prisma:235-236: `Project? @relation`), so this is a
 *   real, allowed state, not a bug to guard against.
 *
 * Returns `null` when the parent row itself does not exist, so `confirmUpload`
 * can turn that into the same "X not found" branch a missing task, project or
 * client produces everywhere else in this codebase — see `PARENT_NOT_FOUND`
 * below — instead of silently writing an attachment (and an activity row)
 * under a `parentId` that names nothing real. */
async function resolveParentScope(
  db: ParentScopeDb,
  parentType: AttachmentParentType,
  parentId: string
): Promise<{ clientId: string | null } | null> {
  if (parentType === "CLIENT") {
    const client = await db.client.findUnique({ where: { id: parentId }, select: { id: true } });
    return client ? { clientId: client.id } : null;
  }
  if (parentType === "PROJECT") {
    const project = await db.project.findUnique({ where: { id: parentId }, select: { clientId: true } });
    return project ? { clientId: project.clientId } : null;
  }
  const task = await db.task.findUnique({
    where: { id: parentId },
    select: { project: { select: { clientId: true } } },
  });
  return task ? { clientId: task.project?.clientId ?? null } : null;
}

const PARENT_NOT_FOUND: Record<AttachmentParentType, string> = {
  TASK: "Task not found",
  PROJECT: "Project not found",
  CLIENT: "Client not found",
};

/** True when `e` is the row-vanished race a concurrent delete can win
 * against a later read-then-write. Duplicated rather than imported, the same
 * call `calendar-event-service.ts:74` and `comment-service.ts:9` make about
 * `task-service.ts`'s own copy — a three-liner each service repeats rather
 * than reaching into another service module for. */
function isRowGoneRace(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025";
}

/** `Attachment.fileKey` is `@unique` specifically so a retried `confirmUpload`
 * cannot register the same object twice (schema.prisma:484-485's own
 * comment). A retry is a real path here, not a hypothetical one: unlike
 * `setTaskAssignees`'s `skipDuplicates` insert (task-service.ts:457-463),
 * this is a plain `create`, so the duplicate is a thrown `P2002`, and
 * `client-service.ts:78-80`'s own `createClient`/`updateClient` set the
 * precedent for turning that specific, known race into a friendly
 * `ActionResult` rather than a raw 500. */
const ALREADY_CONFIRMED = "This upload was already confirmed";

/**
 * Step one of spec §6:108's two-step write: validate, confirm the parent is
 * real, mint the presigned PUT, hand back the key — **and write no row**.
 * The browser PUTs the bytes directly to R2 next; only `confirmUpload`,
 * after that PUT succeeds, ever touches the `Attachment` table. An abandoned
 * upload (the browser never PUTs, or the PUT fails) therefore leaves
 * nothing here at all: no row, and whatever R2 does or does not have at
 * `fileKey` is invisible to every other query in this app, which all read
 * the row, never the bucket. §6:108 spells out why that is the safe
 * direction to fail: the reverse — a row written before the object exists —
 * would show a user a download button for a file that was never actually
 * PUT.
 *
 * The parent lookup (`resolveParentScope`) is the one read this function
 * performs, and it exists to close a leak that is avoidable, unlike the one
 * §6:108 accepts: without it, a request naming a `parentId` that names
 * nothing real still mints a perfectly valid presigned URL, the browser
 * still PUTs, and `confirmUpload` then fails on the parent check — leaving
 * an object in R2 that no row will ever reference and no UI will ever show.
 * That is a *guaranteed* orphan, not the merely-possible one §6:108 accepts
 * for a genuinely abandoned upload, and one read before minting turns it
 * into a clean `"Task not found"` / `"Project not found"` /
 * `"Client not found"` instead — the same call `createCalendarEvent` makes
 * for its own project lookup (`calendar-event-service.ts`): a plain read up
 * front rather than letting a foreign-key failure surface later, in a
 * different function, with no way back to which step actually caused it.
 * `clientId` on the resolved scope goes unused here — this function writes
 * no activity row to scope — but reusing `resolveParentScope` rather than a
 * second, existence-only lookup keeps one parent-walk implementation
 * instead of two that could drift apart.
 *
 * The cuid segment of the key (§6:109) is minted with `crypto.randomUUID()`,
 * not Prisma's own `cuid()`. The two are not the same value by construction
 * — `confirmUpload` lets `Attachment.id` take its own default rather than
 * threading this token through as the literal row id (see its own comment)
 * — so nothing here needs the *cuid* algorithm specifically, only an
 * unguessable, collision-free token, which is exactly what a v4 UUID is and
 * what Node already ships with no new dependency. Adding a `cuid` package
 * for one call site, when this repo's actual cuids are all generated
 * server-side by Postgres via Prisma's `@default(cuid())`, would be a
 * dependency bought for a naming coincidence.
 */
export async function requestUpload(
  db: PrismaClient,
  input: {
    parentType: AttachmentParentType;
    parentId: string;
    fileName: string;
    contentType: string;
    sizeBytes: number;
    actorId: string;
  }
): Promise<ActionResult<{ uploadUrl: string; fileKey: string }>> {
  const validationError = validateUpload(input.fileName, input.sizeBytes);
  if (validationError) return err(validationError);

  const scope = await resolveParentScope(db, input.parentType, input.parentId);
  if (!scope) return err(PARENT_NOT_FOUND[input.parentType]);

  const fileKey = buildFileKey(input.parentType, input.parentId, randomUUID(), input.fileName);
  const uploadUrl = await presignPut({
    key: fileKey,
    contentType: input.contentType,
    contentLength: input.sizeBytes,
  });
  return ok({ uploadUrl, fileKey });
}

/**
 * Step two of the two-step write: the browser's PUT to `fileKey` already
 * succeeded by the time this runs (Task 5's upload control awaits it before
 * calling this), so the object is real — this is the first and only moment
 * the `Attachment` row is written. Row and `recordActivity(tx,
 * "attachment.added")` land in the same `db.$transaction`, so a failure
 * partway through (the duplicate-key race below, or anything else) rolls
 * back to no row and no activity entry together, never one without the
 * other.
 *
 * `Attachment.id` is left to its own `@default(cuid())` rather than set
 * explicitly from anything carried over from `requestUpload` — this
 * function's caller supplies `fileKey` as an opaque string, not the token
 * that built it, and nothing downstream (`listAttachments`, the download
 * button, `removeAttachment`) ever needs the row's `id` to relate back to
 * that token. Re-deriving or threading it through would be state kept alive
 * across two HTTP round trips for a value nothing reads.
 *
 * Re-runs `validateUpload` on the declared size even though `requestUpload`
 * already ran it once. The two calls are not guaranteed to be the same
 * request: `confirmUpload` is Task 5's own Server Action, callable with
 * whatever `sizeBytes` its caller supplies, and the actual enforcement for
 * the *real* uploaded bytes is the presigned URL's own content-length
 * condition (`r2.ts`'s `presignPut`), which this function cannot re-check
 * without a `HeadObject` call this task's scope does not include. Re-running
 * the cheap, already-available check at least keeps the *stored* size
 * inside the same bounds `requestUpload` enforced, rather than trusting a
 * second, independent call to have repeated a client-side check this
 * codebase already treats as advice, not proof (`attachment.ts:210-213`).
 */
export async function confirmUpload(
  db: PrismaClient,
  input: {
    parentType: AttachmentParentType;
    parentId: string;
    fileKey: string;
    fileName: string;
    contentType: string;
    sizeBytes: number;
    actorId: string;
  }
): Promise<ActionResult<{ id: string }>> {
  const validationError = validateUpload(input.fileName, input.sizeBytes);
  if (validationError) return err(validationError);

  const scope = await resolveParentScope(db, input.parentType, input.parentId);
  if (!scope) return err(PARENT_NOT_FOUND[input.parentType]);

  try {
    const created = await db.$transaction(async (tx) => {
      const attachment = await tx.attachment.create({
        data: {
          parentType: input.parentType,
          parentId: input.parentId,
          fileKey: input.fileKey,
          fileName: input.fileName,
          contentType: input.contentType,
          size: input.sizeBytes,
          uploadedById: input.actorId,
        },
      });
      await recordActivity(tx, {
        actorId: input.actorId,
        entityType: "ATTACHMENT",
        entityId: attachment.id,
        action: "attachment.added",
        clientId: scope.clientId,
        meta: { name: attachment.fileName },
      });
      return attachment;
    });
    return ok({ id: created.id });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return err(ALREADY_CONFIRMED);
    }
    throw e;
  }
}

const PERMISSION_DENIED = "You can only remove attachments you uploaded";

/**
 * **Permission gate: the uploader, or an admin.** Neither the brief nor
 * spec §6/§7 rules on who may remove an attachment — this is a deliberate
 * extension of the spec, not a requirement it states, applying the one
 * pattern this codebase already uses for every other destructive,
 * non-owner-restricted-by-default action: comments (spec 3c **D3** —
 * "the author may edit their own comment; the author or an admin may
 * delete", `comment-service.ts:184-195`), announcements
 * (`announcement-service.ts:82`), and calendar events (**D10**,
 * `calendar-event-service.ts`'s `PERMISSION_DENIED`). Without this gate,
 * any signed-in member could delete any other member's uploaded file —
 * visibility being studio-wide by design (no per-resource ACLs anywhere in
 * this app) is not the same claim as destruction being unrestricted, and
 * every one of the three precedents above draws exactly that line.
 * `isAdmin` is passed in rather than read here, matching `removeComment`'s
 * own reasoning for the same split: this layer never touches the session.
 *
 * Removes one attachment: the row, its activity entry, and the R2 object.
 * The three cannot be one atomic write — Postgres and R2 are two systems —
 * so this function has to pick an order, and the choice made here is
 * **row (and activity) first, inside a `db.$transaction`; the R2
 * object-delete only after that transaction has actually committed.**
 *
 * The two orders were weighed against each other directly, not just against
 * an abstract preference:
 *
 * - **Object-first, row-second** (delete from R2, then delete the row) has a
 *   failure window that produces exactly the outcome §6:108/§6:111 call out
 *   as the bad one: if the object-delete succeeds and the *row*-delete then
 *   fails for any unrelated reason (a transient DB error, a dropped
 *   connection right as the transaction runs), the row survives pointing at
 *   an object that is now actually gone. Every open tab still shows the
 *   attachment; its download button now 404s. That is the "lie" — a row
 *   that looks fine and is not — and it is reachable under this order
 *   whenever the *second* step is the one that can fail after the first
 *   already succeeded.
 * - **Row-first, object-second** (this function's actual order) cannot
 *   produce that outcome at all. By the time R2 is even asked to delete
 *   anything, the row is already durably gone — committed to Postgres, not
 *   merely staged in a transaction that could still roll back. If the R2
 *   call then fails, there is no row left for anyone to see; the worst
 *   outcome is an object nobody's `Attachment` table names any more —
 *   orphaned, invisible, and exactly the "reapable later" shape §6:108
 *   already accepts as correct for an abandoned upload. Never a lie,
 *   because once the row is gone there is nothing left to lie.
 *
 * The R2 call's own failure is **not** swallowed into a friendly
 * `ActionResult` — it is awaited and left to throw, deliberately. By the
 * point it runs, the row is already gone and the transaction has already
 * committed, so returning `ok(undefined)` before attempting it would be
 * accurate about the database and would hide a real, worth-noticing
 * storage-cleanup failure from ever surfacing — the same "silently leaks
 * storage" failure mode §6:111 warns `deleteAttachmentObjectsFor` against,
 * just at the single-attachment scale instead of the bulk-sweep one.
 * Letting it throw here matches every other narrowly-scoped catch in this
 * codebase (`isRowGoneRace` below catches only P2025; nothing else is
 * swallowed) and matches `r2.ts`'s own `deleteObjects` doc comment, which
 * says its thrown error exists so "the caller could have caught it" —
 * leaving that choice to whatever calls this function, not deciding it here
 * by silence.
 */
export async function removeAttachment(
  db: PrismaClient,
  input: { attachmentId: string; actorId: string; isAdmin: boolean }
): Promise<ActionResult> {
  const attachment = await db.attachment.findUnique({
    where: { id: input.attachmentId },
    select: { id: true, parentType: true, parentId: true, fileKey: true, fileName: true, uploadedById: true },
  });
  if (!attachment) return err("Attachment not found");

  if (attachment.uploadedById !== input.actorId && !input.isAdmin) {
    return err(PERMISSION_DENIED);
  }

  // Unlike confirmUpload, a missing parent is not an error here: removing an
  // attachment is a cleanup operation on a row that already exists, and a
  // stray attachment whose parent is somehow already gone is exactly the
  // kind of row someone should be able to remove, not one this function
  // refuses to touch. `clientId: null` mirrors the same fallback
  // `client.deleted` uses for an activity row that outlives its own client
  // (activity.ts:80-81).
  const scope = await resolveParentScope(db, attachment.parentType, attachment.parentId);
  const clientId = scope?.clientId ?? null;

  try {
    await db.$transaction(async (tx) => {
      await tx.attachment.delete({ where: { id: input.attachmentId } });
      await recordActivity(tx, {
        actorId: input.actorId,
        entityType: "ATTACHMENT",
        entityId: attachment.id,
        action: "attachment.removed",
        clientId,
        meta: { name: attachment.fileName },
      });
    });
  } catch (e) {
    if (isRowGoneRace(e)) return err("Attachment not found");
    throw e;
  }

  // Only reached once the transaction above has committed — see the
  // ordering comment on this function for why that sequencing is the whole
  // point. Left to throw on failure rather than caught.
  await deleteObjects([attachment.fileKey]);

  return ok(undefined);
}

/** The narrow surface `deleteAttachmentObjectsFor` needs to run nested
 * inside someone else's transaction (Task 6's `removeTask`/`deleteClient`)
 * as easily as it runs standalone — matching `ActivityDb`/`NotificationDb`'s
 * own reasoning (`activity.ts:63`, `notification-service.ts:8`): the
 * `Prisma.TransactionClient` a caller's own `tx` provides satisfies this
 * `Pick` structurally, with no cast required at the call site. */
export type AttachmentDb = Pick<PrismaClient, "attachment">;

/**
 * The sweep Task 6 calls when a task or client is deleted (spec §6:111: "the
 * database cannot cascade to R2, so `removeTask` / `deleteClient` … gain
 * that call"). Reads every attachment row under `(parentType, parentId)`,
 * deletes their R2 objects, then deletes the rows — **objects first,
 * deliberately the opposite order from `removeAttachment` above**, for a
 * reason specific to how this function is actually called rather than a
 * different opinion about which failure direction is worse in general:
 *
 * Task 6 nests this call **inside** `removeTask`'s own `db.$transaction`, so
 * by design the row-deletion step here is never durably committed on its
 * own — it is staged inside a transaction someone else owns, which only
 * actually commits once every other step in that outer transaction (the
 * task delete itself, notification cleanup, the activity row) also
 * succeeds. `removeAttachment`'s row-first reasoning — "the row is durably
 * gone before the risky external call even runs" — does not hold here,
 * because there is no independent commit point to make it durable before
 * the R2 call happens. What *does* hold: if the object-delete is attempted
 * first and throws, this function returns control to its caller before
 * touching a single row, so the enclosing `removeTask` transaction rolls
 * back cleanly with every attachment row exactly as it was — no partial
 * sweep, no row deleted for an object that was never actually confirmed
 * gone.
 *
 * Deletes by the exact `id` list read in the same call, not by re-issuing
 * the `(parentType, parentId)` filter a second time. The gap between the
 * `findMany` above and the `deleteMany` below is a real window — a new
 * attachment could be added to this same parent inside it — and scoping the
 * delete to the precise snapshot this function actually swept for R2
 * closes that window: a row that did not exist when `deleteObjects` ran is
 * never caught by a broader same-parent filter that would delete it anyway
 * without ever having deleted (or even known about) its object.
 *
 * A parent with nothing attached returns immediately after the read — no
 * pointless `DeleteObjects` call with zero keys (`r2.ts:168-171` already
 * guards that at its own layer, but there is also no reason to reach it),
 * and no `deleteMany` whose `where` clause could only ever match zero rows.
 */
export async function deleteAttachmentObjectsFor(
  db: AttachmentDb,
  input: { parentType: AttachmentParentType; parentId: string }
): Promise<void> {
  const rows = await db.attachment.findMany({
    where: { parentType: input.parentType, parentId: input.parentId },
    select: { id: true, fileKey: true },
  });
  if (rows.length === 0) return;

  await deleteObjects(rows.map((row) => row.fileKey));

  await db.attachment.deleteMany({
    where: { id: { in: rows.map((row) => row.id) } },
  });
}
