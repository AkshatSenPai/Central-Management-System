import type { PrismaClient } from "@prisma/client";
import { clientInitials } from "@/lib/client";
import type { AttachmentParentType } from "@/lib/attachment";

/** A parent's file list — the one read query attachments need. Lives here
 * rather than in `attachment.ts` for the same reason `CalendarEventRow` sits
 * in `calendar-event-queries.ts` rather than `calendar-event.ts`
 * (`calendar-event-queries.ts:4-9`): this is the query's output shape, not a
 * pure rule, so `attachment.ts` stays free of the Prisma import that would
 * otherwise be its only reader.
 *
 * **`fileKey` is deliberately not here** — reversed in Task 5, having been
 * carried through in Task 4 on the assumption the download button would mint
 * a presigned GET from a key the browser held. It does not: this shape is
 * rendered by a client component, so every field on it is serialised into
 * the RSC payload and handed to the browser, and `downloadAttachmentAction`
 * takes an `attachmentId` and re-reads the key server-side instead. Three
 * reasons, in the order they matter:
 *
 * 1. **A client-supplied key is a client-supplied capability.** An action
 *    that signs whatever key it is given signs *any* key in the bucket, for
 *    anyone who can POST to it. That is not an escalation today — every
 *    object in this bucket is an attachment and §7's authorisation model is
 *    `requireUser()`, studio-wide — but it stops being true the first time
 *    anything else is stored there, and nothing about that future change
 *    would flag this action as the thing that needs revisiting.
 * 2. **It is what this version of Next explicitly prescribes.**
 *    `node_modules/next/dist/docs/01-app/02-guides/server-actions.md`, under
 *    Security: "a client legitimately tells the server *which* item to act
 *    on, but it should not supply the row's contents … Send a reference
 *    (typically an ID) plus the user's change, and re-read the rest from a
 *    trusted source." The same page's "Constrain return values … shape them
 *    to what the UI renders, not raw database records" is the other half.
 * 3. **Nothing renders it.** The list shows a name, a size and an uploader.
 *    A field that exists only to be posted back to the server it came from
 *    is the internal storage layout, published to every browser, for free.
 *
 * The cost is one primary-key lookup per download click, on a row the
 * clicker is about to wait on a presign and an R2 round trip for anyway. */
export type AttachmentRow = {
  id: string;
  fileName: string;
  contentType: string;
  size: number;
  uploaderId: string;
  uploaderName: string;
  uploaderInitials: string;
  at: Date;
};

const attachmentRowSelect = {
  id: true,
  fileName: true,
  contentType: true,
  size: true,
  uploadedById: true,
  createdAt: true,
  uploadedBy: { select: { name: true } },
} as const;

type AttachmentRowSource = {
  id: string;
  fileName: string;
  contentType: string;
  size: number;
  uploadedById: string;
  createdAt: Date;
  uploadedBy: { name: string };
};

/** Same helper `mapAttendees` (`calendar-event-queries.ts:70`) and
 * `listTaskComments` (`comment-queries.ts:41`) use for their own person
 * fields — one `clientInitials` call site's worth of behaviour, not a third
 * one that could drift from the other two. */
function toAttachmentRow(a: AttachmentRowSource): AttachmentRow {
  return {
    id: a.id,
    fileName: a.fileName,
    contentType: a.contentType,
    size: a.size,
    uploaderId: a.uploadedById,
    uploaderName: a.uploadedBy.name,
    uploaderInitials: clientInitials(a.uploadedBy.name),
    at: a.createdAt,
  };
}

/** A parent's attachments, newest first. Unlike `listTaskComments` — a
 * conversation, which reads downwards oldest-first (`comment-queries.ts:14`)
 * — a file list has no reading order to preserve; it is closer in shape to
 * `listRecentActivity`/`listClientActivity` (`activity.ts:283`, `:301`),
 * both `{ at: "desc" }`, and the newest upload is the one someone just added
 * and is most likely looking for. */
export async function listAttachments(
  db: PrismaClient,
  input: { parentType: AttachmentParentType; parentId: string }
): Promise<AttachmentRow[]> {
  const rows = await db.attachment.findMany({
    where: { parentType: input.parentType, parentId: input.parentId },
    orderBy: { createdAt: "desc" },
    select: attachmentRowSelect,
  });

  return rows.map(toAttachmentRow);
}
