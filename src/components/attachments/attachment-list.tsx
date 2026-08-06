"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/form-error";
import { Icon } from "@/components/ui/icon";
import { formatFileSize } from "@/lib/attachment";
import { relativeTime } from "@/lib/dates";
import type { AttachmentRow } from "@/lib/attachment-queries";
import { downloadAttachmentAction, removeAttachmentAction } from "@/server/actions/attachments";
import { ScopeFields, type AttachmentScope } from "@/components/attachments/attachment-scope";

/**
 * One file: its name, its size, who put it there, and the two things anyone
 * can do with it. §2's whole definition of an attachment — "a file is a
 * name, a size and a download" — is this row.
 *
 * **Download is a click, not a link.** There is no stable URL to put in an
 * `href`: §6:106 mints a presigned GET per click, valid five minutes, and
 * rendering one into the page at *render* time would mean every list ships a
 * live capability for every file on it, expiring while the page sits open,
 * whether or not anyone clicks. So the URL is fetched on the click that
 * needs it and used immediately.
 *
 * `window.location.href` rather than `window.open`: the URL arrives after an
 * `await`, and by then the user-gesture context a popup blocker looks for is
 * gone — `window.open` is blocked by default in that position in several
 * browsers. Assigning `location.href` is not, and it does not navigate away
 * either, because `presignGet` asks R2 for `Content-Disposition: attachment`
 * (see its comment): a response the browser saves rather than renders leaves
 * the current page exactly where it was.
 */
function AttachmentItem({
  attachment,
  scope,
  viewerId,
  viewerIsAdmin,
}: {
  attachment: AttachmentRow;
  scope: AttachmentScope;
  viewerId: string;
  viewerIsAdmin: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [removing, setRemoving] = useState(false);

  // The same uploader-or-admin line `removeAttachment` enforces in the
  // service. This is not the check — the service's is, and it runs whether
  // or not this button was ever rendered — it is only the reason not to
  // show a control whose single outcome would be a permission error.
  const canRemove = attachment.uploaderId === viewerId || viewerIsAdmin;

  async function download() {
    setError(null);
    setDownloading(true);
    try {
      const formData = new FormData();
      formData.set("attachmentId", attachment.id);
      const result = await downloadAttachmentAction(formData);
      if (!result.ok) setError(result.error);
      else window.location.href = result.data.url;
    } catch {
      setError("Something went wrong — try again");
    } finally {
      setDownloading(false);
    }
  }

  async function remove(formData: FormData) {
    setError(null);
    setRemoving(true);
    try {
      const result = await removeAttachmentAction(formData);
      if (!result.ok) setError(result.error);
    } catch {
      setError("Something went wrong — try again");
    } finally {
      setRemoving(false);
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-[var(--border)] py-2 last:border-b-0">
      <Icon name="attach_file" size="sm" className="flex-none text-[var(--text-3)]" />
      <div className="min-w-0 flex-1">
        {/* `break-all`, not `truncate`: the name is the only thing
            distinguishing two files, and three reports whose names differ
            after the cut would all render identically. Wrapping is uglier
            and readable; truncating is tidier and wrong. */}
        <p className="break-all text-[12.5px] font-medium text-[var(--text)]">
          {attachment.fileName}
        </p>
        <p className="text-[11.5px] text-[var(--text-3)]">
          {formatFileSize(attachment.size)} · {attachment.uploaderName} ·{" "}
          {relativeTime(attachment.at)}
        </p>
      </div>
      <div className="flex items-center gap-1.5">
        <Button
          size="xs"
          className="gap-1.5"
          disabled={downloading || removing}
          onClick={download}
        >
          <Icon name="download" size="sm" />
          {downloading ? "Opening…" : "Download"}
        </Button>
        {canRemove ? (
          <form action={remove}>
            <ScopeFields scope={scope} attachmentId={attachment.id} />
            <Button type="submit" size="xs" className="gap-1.5" disabled={downloading || removing}>
              <Icon name="delete" size="sm" />
              {removing ? "Removing…" : "Remove"}
            </Button>
          </form>
        ) : null}
      </div>
      {error ? <FormError message={error} size="xs" className="basis-full" /> : null}
    </li>
  );
}

/** A parent's files, newest first — the order `listAttachments` already
 * returns them in, preserved rather than re-sorted here, so the one decision
 * about ordering lives with the query that can act on it. */
export function AttachmentList({
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
  if (attachments.length === 0) {
    return <p className="text-sm text-[var(--text-3)]">No files attached yet.</p>;
  }

  return (
    <ul>
      {attachments.map((attachment) => (
        <AttachmentItem
          key={attachment.id}
          attachment={attachment}
          scope={scope}
          viewerId={viewerId}
          viewerIsAdmin={viewerIsAdmin}
        />
      ))}
    </ul>
  );
}
