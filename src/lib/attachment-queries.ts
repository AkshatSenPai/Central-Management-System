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
 * `fileKey` is carried through, not just `id` — the download button (Task 5)
 * mints a presigned GET from the key, not from the row id, and there is
 * nothing else here that would let it recover the key later. */
export type AttachmentRow = {
  id: string;
  fileKey: string;
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
  fileKey: true,
  fileName: true,
  contentType: true,
  size: true,
  uploadedById: true,
  createdAt: true,
  uploadedBy: { select: { name: true } },
} as const;

type AttachmentRowSource = {
  id: string;
  fileKey: string;
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
    fileKey: a.fileKey,
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
