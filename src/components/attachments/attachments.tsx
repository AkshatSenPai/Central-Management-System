import type { AttachmentRow } from "@/lib/attachment-queries";
import { AttachmentList } from "@/components/attachments/attachment-list";
import { AttachmentUpload } from "@/components/attachments/attachment-upload";
import type { AttachmentScope } from "@/components/attachments/attachment-scope";

/** The one thing a page imports: the list, then the picker under it. Task 6
 * drops this on the task, project and client pages, so the arrangement is
 * decided once here rather than reassembled three times — the same job
 * `CommentThread` does for its own composer and thread.
 *
 * List above, picker below, matching `CommentThread`: what already exists is
 * the answer to "what is attached here?", and the control that adds to it
 * belongs after the thing it adds to. The list is newest-first, so a file
 * just uploaded appears immediately above the picker that uploaded it.
 *
 * No `"use client"` — this composer renders no interactivity of its own, and
 * both children carry their own directive. Leaving it a Server Component
 * means the `AttachmentRow[]` it is handed is serialised once, on the way to
 * `AttachmentList`, rather than this file becoming a client boundary that
 * pulls its props across as well. */
export function Attachments({
  attachments,
  scope,
  viewerId,
  viewerIsAdmin,
}: {
  attachments: AttachmentRow[];
  scope: AttachmentScope;
  viewerId: string;
  viewerIsAdmin: boolean;
}) {
  return (
    <div className="space-y-3">
      <AttachmentList
        attachments={attachments}
        scope={scope}
        viewerId={viewerId}
        viewerIsAdmin={viewerIsAdmin}
      />
      <AttachmentUpload scope={scope} />
    </div>
  );
}
