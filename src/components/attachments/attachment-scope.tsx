import type { AttachmentParentType } from "@/lib/attachment";

/** Which parent a file list belongs to, plus the two ids its mutations need
 * to revalidate the *activity timeline* — not the list itself.
 *
 * `parentType` and `parentId` identify the attachment's owner and are what
 * the service writes. `projectId` and `clientId` exist only so
 * `revalidate()` in `src/server/actions/attachments.ts` can reach the client
 * detail page, which renders the `attachment.added` / `attachment.removed`
 * activity rows. Both are `null` for a personal task — the same shape
 * `CommentThread`'s own `Scope` uses, and the same empty string the action
 * checks for once `ScopeFields` renders it.
 *
 * For a PROJECT parent, `parentId` and `projectId` are the same id; for a
 * CLIENT parent, so are `parentId` and `clientId`. That redundancy is
 * deliberate rather than a shape to be clever about: the action dedupes
 * paths through a `Set`, and a scope whose fields mean the same thing on
 * every page is one a caller cannot fill in wrongly. */
export type AttachmentScope = {
  parentType: AttachmentParentType;
  parentId: string;
  projectId: string | null;
  clientId: string | null;
};

/** The hidden fields every attachment mutation posts back. Same shape and
 * same reasoning as `comment-thread.tsx`'s own `ScopeFields`: the values are
 * already on the page that rendered the list, so re-deriving them in the
 * action would be a second lookup for something the caller already knows.
 *
 * These are hidden inputs, which gate 3 exempts explicitly — see its comment
 * in `scripts/gates.mjs`: "60 hidden inputs carry every
 * taskId/projectId/clientId in the app. They have no styling and are not a
 * design concern." */
export function ScopeFields({
  scope,
  attachmentId,
}: {
  scope: AttachmentScope;
  attachmentId?: string;
}) {
  return (
    <>
      <input type="hidden" name="parentType" value={scope.parentType} />
      <input type="hidden" name="parentId" value={scope.parentId} />
      <input type="hidden" name="projectId" value={scope.projectId ?? ""} />
      <input type="hidden" name="clientId" value={scope.clientId ?? ""} />
      {attachmentId ? <input type="hidden" name="attachmentId" value={attachmentId} /> : null}
    </>
  );
}

/** The same four fields as a `FormData`, for the two paths that never render
 * a form: the upload control, which builds its metadata payload in
 * JavaScript because the file it is describing was chosen through an
 * `onChange`, and nothing about a presign request is a form submission. One
 * function so the field *names* live in one place — a typo'd `"parentId"`
 * here and a correct one in `ScopeFields` would be two payloads that
 * disagree about what they are attaching to, and only one of them would
 * fail. */
export function scopeFormData(scope: AttachmentScope): FormData {
  const formData = new FormData();
  formData.set("parentType", scope.parentType);
  formData.set("parentId", scope.parentId);
  formData.set("projectId", scope.projectId ?? "");
  formData.set("clientId", scope.clientId ?? "");
  return formData;
}
