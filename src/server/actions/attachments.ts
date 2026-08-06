"use server";

/**
 * Revalidation map — keep in sync with the calls below.
 *
 * | Mutation                 | revalidatePath calls                                                            |
 * |--------------------------|---------------------------------------------------------------------------------|
 * | requestUploadAction      | none — it writes nothing                                                        |
 * | confirmUploadAction      | the parent's own page; plus `/projects/{projectId}` and `/clients/{clientId}`   |
 * | removeAttachmentAction   | the same set                                                                    |
 * | downloadAttachmentAction | none — it reads                                                                 |
 *
 * The two that revalidate nothing are not oversights. `requestUploadAction`
 * mints a presigned PUT and deliberately writes no row (spec §6:108's
 * two-step write) — there is no change for a page to show yet, and the row
 * appears one action later. `downloadAttachmentAction` signs a GET; nothing
 * about the database moves.
 *
 * The parent's own page is derived from `parentType`, not sent: for a TASK
 * parent, `parentId` *is* the task id, so `/tasks/{parentId}` needs no
 * separate field and cannot disagree with the one the mutation actually
 * used. `projectId` and `clientId` are sent, and are the same fan-out
 * comments.ts performs for the same reason: both writes record a
 * client-scoped `ActivityLog` row (`attachment.added` / `attachment.removed`)
 * and the client-detail timeline is the only reader of those rows. A
 * personal task sends both as empty strings, which is exactly what the
 * `if` skips. Paths go through a `Set` first because a PROJECT parent would
 * otherwise revalidate `/projects/{id}` twice — harmless, but the dedupe
 * costs nothing and keeps the map above honest.
 *
 * Every action here is `requireUser()`. There is no `requireAdmin` anywhere
 * in this file: removal is uploader-or-admin, and that check lives in the
 * service as an `isAdmin` argument rather than a guard at the door, for the
 * reason comments.ts:16-18 already gives — a member removing their *own*
 * upload is allowed, so the check cannot be at the door. Reading is not
 * gated beyond the session at all (§7), matching the list every viewer can
 * already see.
 *
 * Every scalar FormData read is `String(formData.get("x") ?? "")`, the
 * convention the other action files hold to. `sizeBytes` is the one field
 * that is not a string at its destination, and its parse is guarded — see
 * `parseSizeBytes` below.
 */

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { err, ok, type ActionResult } from "@/lib/action-result";
import { AuthError, requireUser } from "@/server/guards";
import {
  ATTACHMENT_PARENT_TYPES,
  normaliseContentType,
  type AttachmentParentType,
} from "@/lib/attachment";
import {
  requestUpload,
  confirmUpload,
  removeAttachment,
  getAttachmentDownloadUrl,
} from "@/lib/attachment-service";

/** `parentType` arrives as a bare string from `FormData` and is used to
 * pick a Prisma enum value, a revalidation path and an error message. This
 * version of Next is explicit that the shape has to be checked here rather
 * than trusted — `node_modules/next/dist/docs/01-app/02-guides/
 * server-actions.md`, Security: "A Server Action runs as a POST request
 * against the page that invokes it … Treat every action as an untrusted
 * entry point. … Validate inputs. Treat `FormData`, query parameters, and
 * headers as untrusted."
 *
 * Checked against `ATTACHMENT_PARENT_TYPES` — the same array `attachment.ts`
 * derives `AttachmentParentType` from — rather than a second literal list
 * written out here, so adding a fourth parent type later cannot leave this
 * function silently rejecting it. */
function parseParentType(raw: string): AttachmentParentType | null {
  return (ATTACHMENT_PARENT_TYPES as readonly string[]).includes(raw)
    ? (raw as AttachmentParentType)
    : null;
}

const UNKNOWN_PARENT_TYPE = "That is not something a file can be attached to";

/** `Number("")` is 0 and `Number("banana")` is `NaN`, so this parse cannot
 * fail loudly on its own — it fails into a number `validateUpload` then has
 * to catch. It does (`attachment.ts` rejects both a non-finite size and a
 * non-positive one, and has tests for each), so this returns the parsed
 * value rather than pre-judging it: one place decides what a valid size is,
 * and it is the pure layer with the 25 MB constant in it, not this file. */
function parseSizeBytes(formData: FormData): number {
  return Number(formData.get("sizeBytes") ?? "");
}

function revalidate(
  parentType: AttachmentParentType,
  parentId: string,
  projectId: string,
  clientId: string
) {
  const paths = new Set<string>();
  if (parentType === "TASK") paths.add(`/tasks/${parentId}`);
  if (parentType === "PROJECT") paths.add(`/projects/${parentId}`);
  if (parentType === "CLIENT") paths.add(`/clients/${parentId}`);
  if (projectId) paths.add(`/projects/${projectId}`);
  if (clientId) paths.add(`/clients/${clientId}`);
  for (const path of paths) revalidatePath(path);
}

/**
 * Step one of the two-step write: no row is written here, only a URL minted.
 *
 * Returns the `contentType` it signed, and the upload control PUTs with
 * *that* value rather than the one it sent. `presignPut` signs over
 * `content-type` (`r2.ts` passes `signableHeaders` precisely so it does), so
 * the header the browser sends has to match the signed one byte for byte or
 * R2 rejects the upload with a signature error naming neither side. Echoing
 * the server's own answer back is what makes that impossible to get wrong:
 * `normaliseContentType` runs once, here, and the browser never applies the
 * rule at all. See that function's comment in `attachment.ts` for the two
 * inputs it rewrites and why neither is an error.
 */
export async function requestUploadAction(
  formData: FormData
): Promise<ActionResult<{ uploadUrl: string; fileKey: string; contentType: string }>> {
  try {
    const user = await requireUser();
    const parentType = parseParentType(String(formData.get("parentType") ?? ""));
    if (!parentType) return err(UNKNOWN_PARENT_TYPE);

    const contentType = normaliseContentType(String(formData.get("contentType") ?? ""));
    const result = await requestUpload(prisma, {
      parentType,
      parentId: String(formData.get("parentId") ?? ""),
      fileName: String(formData.get("fileName") ?? ""),
      contentType,
      sizeBytes: parseSizeBytes(formData),
      actorId: user.id,
    });
    if (!result.ok) return result;
    return ok({ ...result.data, contentType });
  } catch (e) {
    if (e instanceof AuthError) return err(e.message);
    throw e;
  }
}

/**
 * Step two: the browser's PUT has already succeeded by the time this runs,
 * so the object exists and the row can be written. `fileKey` comes back from
 * `requestUploadAction` and is echoed here rather than rebuilt — rebuilding
 * it would mean re-minting the random segment, producing a key naming an
 * object that was never uploaded.
 *
 * That does mean this action accepts a caller-supplied key, which the
 * download path deliberately does not. The asymmetry is the point: a key
 * here can only ever be *written into a row the caller is also creating*,
 * and `Attachment.fileKey` is `@unique`, so the worst a forged one achieves
 * is a row of the caller's own whose download 404s. A key on the *read* side
 * would sign a URL for an arbitrary object. Different capability, different
 * answer.
 */
export async function confirmUploadAction(
  formData: FormData
): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireUser();
    const parentType = parseParentType(String(formData.get("parentType") ?? ""));
    if (!parentType) return err(UNKNOWN_PARENT_TYPE);

    const parentId = String(formData.get("parentId") ?? "");
    const result = await confirmUpload(prisma, {
      parentType,
      parentId,
      fileKey: String(formData.get("fileKey") ?? ""),
      fileName: String(formData.get("fileName") ?? ""),
      contentType: normaliseContentType(String(formData.get("contentType") ?? "")),
      sizeBytes: parseSizeBytes(formData),
      actorId: user.id,
    });
    revalidate(
      parentType,
      parentId,
      String(formData.get("projectId") ?? ""),
      String(formData.get("clientId") ?? "")
    );
    return result;
  } catch (e) {
    if (e instanceof AuthError) return err(e.message);
    throw e;
  }
}

export async function removeAttachmentAction(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parentType = parseParentType(String(formData.get("parentType") ?? ""));
    if (!parentType) return err(UNKNOWN_PARENT_TYPE);

    const result = await removeAttachment(prisma, {
      attachmentId: String(formData.get("attachmentId") ?? ""),
      actorId: user.id,
      isAdmin: user.role === "ADMIN",
    });
    revalidate(
      parentType,
      String(formData.get("parentId") ?? ""),
      String(formData.get("projectId") ?? ""),
      String(formData.get("clientId") ?? "")
    );
    return result;
  } catch (e) {
    if (e instanceof AuthError) return err(e.message);
    throw e;
  }
}

/**
 * One click, one 5-minute URL (§6:106). Takes the attachment's **id** and
 * lets the service read the key — never a key from the caller. See
 * `getAttachmentDownloadUrl`'s comment, and `attachment-queries.ts`'s, for
 * why the key is not on the row shape the browser holds in the first place.
 *
 * No `revalidatePath`: nothing changed, and this action's response carries
 * only its return value, so the page it was called from is not re-rendered
 * (`server-actions.md`: "An action that does none of the above carries only
 * its return value, and the current route is not re-rendered"). A download
 * that quietly re-rendered the page under the user would be a surprise, not
 * a feature.
 */
export async function downloadAttachmentAction(
  formData: FormData
): Promise<ActionResult<{ url: string }>> {
  try {
    await requireUser();
    return await getAttachmentDownloadUrl(prisma, {
      attachmentId: String(formData.get("attachmentId") ?? ""),
    });
  } catch (e) {
    if (e instanceof AuthError) return err(e.message);
    throw e;
  }
}
