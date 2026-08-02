"use client";

import { useActionState, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/form-error";
import { Icon } from "@/components/ui/icon";
import { InitialsAvatar } from "@/components/ui/initials-avatar";
import { TextareaField } from "@/components/ui/field";
import { CommentBody } from "@/components/comments/comment-body";
import { relativeTime } from "@/lib/dates";
import type { Mentionable } from "@/lib/rich-text";
import type { CommentRow } from "@/lib/comment-queries";
import {
  addCommentAction,
  updateCommentAction,
  removeCommentAction,
} from "@/server/actions/comments";

type SaveState = { ok: true; data: unknown } | { ok: false; error: string };
type SaveAction = (prev: SaveState | null, formData: FormData) => Promise<SaveState>;

type Scope = { taskId: string; projectId: string | null; clientId: string | null };

/** The hidden fields every comment mutation needs to revalidate the right
 * paths. projectId and clientId are empty strings for a personal task, which
 * is exactly what the action checks for. */
function ScopeFields({ scope, commentId }: { scope: Scope; commentId?: string }) {
  return (
    <>
      <input type="hidden" name="taskId" value={scope.taskId} />
      <input type="hidden" name="projectId" value={scope.projectId ?? ""} />
      <input type="hidden" name="clientId" value={scope.clientId ?? ""} />
      {commentId ? <input type="hidden" name="commentId" value={commentId} /> : null}
    </>
  );
}

/** Inserts "@" into the composer and returns focus to it. Not a picker: with
 * fifteen colleagues, typing the next letter is faster than choosing from a
 * list, and a real autocomplete is a keyboard-navigation surface this phase
 * does not need. The hint under the box says what to do. */
function useMentionInsert(ref: React.RefObject<HTMLTextAreaElement | null>) {
  return () => {
    const el = ref.current;
    if (!el) return;
    const at = el.selectionStart ?? el.value.length;
    const needsSpace = at > 0 && !/\s/.test(el.value[at - 1] ?? "");
    const insert = `${needsSpace ? " " : ""}@`;
    el.setRangeText(insert, at, el.selectionEnd ?? at, "end");
    // React does not see setRangeText, so tell it — the textarea is
    // uncontrolled here, but any listener still deserves the event.
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.focus();
  };
}

/** No `members` prop: mentions are resolved on the server, against the live
 * active-member list, at the moment the comment is saved. The composer only
 * has to collect text. */
function CommentComposer({ scope }: { scope: Scope }) {
  const [attempt, setAttempt] = useState(0);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const insertMention = useMentionInsert(boxRef);

  const [state, formAction, pending] = useActionState<SaveState | null, FormData>(
    async (prev, formData) => {
      const result = await (addCommentAction as SaveAction)(prev, formData);
      // Success clears the box by remounting it; a failure keeps what was
      // typed, because losing a paragraph to a validation error is worse than
      // the error itself.
      if (result.ok) setAttempt((a) => a + 1);
      return result;
    },
    null
  );

  return (
    <form key={attempt} action={formAction} className="flex gap-2.5">
      <ScopeFields scope={scope} />
      <div className="min-w-0 flex-1">
        <TextareaField
          ref={boxRef}
          name="body"
          rows={2}
          required
          className="w-full"
          placeholder="Write a comment… use @ to mention"
          aria-label="Write a comment"
        />
        <div className="mt-2 flex items-center gap-2">
          <Button
            onClick={insertMention}
            aria-label="Mention someone"
            variant="ghost"
            size="none"
            className="p-1 text-[var(--text-3)] hover:bg-transparent hover:text-[var(--text)]"
          >
            <Icon name="alternate_email" size="sm" />
          </Button>
          {/* Said plainly, because it is not what people expect. §5.7 puts
              the notification centre in Phase 4. */}
          <span className="text-[11.5px] text-[var(--text-3)]">
            Mentions link to a profile — nobody is notified yet
          </span>
          <span className="flex-1" />
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? "Posting…" : "Comment"}
          </Button>
        </div>
        {state && !state.ok ? <FormError message={state.error} size="xs" className="mt-2" /> : null}
      </div>
    </form>
  );
}

function CommentItem({
  comment,
  scope,
  members,
  viewerId,
  viewerIsAdmin,
}: {
  comment: CommentRow;
  scope: Scope;
  members: Mentionable[];
  viewerId: string;
  viewerIsAdmin: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isAuthor = comment.authorId === viewerId;

  const [state, formAction, pending] = useActionState<SaveState | null, FormData>(
    async (prev, formData) => {
      const result = await (updateCommentAction as SaveAction)(prev, formData);
      if (result.ok) setEditing(false);
      return result;
    },
    null
  );

  async function remove(formData: FormData) {
    setError(null);
    const result = await removeCommentAction(formData);
    if (!result.ok) setError(result.error);
  }

  return (
    <div className="flex gap-2.5">
      <InitialsAvatar initials={comment.authorInitials} shape="circle" size={28} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-[12.5px] font-semibold text-[var(--text)]">
            {comment.authorName}
          </span>
          <span className="text-[11.5px] text-[var(--text-3)]">{relativeTime(comment.at)}</span>
          {/* The marker is the whole reason editing is allowed at all — a
              thread you can silently rewrite is not a record. */}
          {comment.edited ? (
            <span className="text-[11.5px] text-[var(--text-3)]">· edited</span>
          ) : null}
        </div>

        {editing ? (
          <form action={formAction} className="mt-1.5">
            <ScopeFields scope={scope} commentId={comment.id} />
            <TextareaField
              name="body"
              rows={3}
              required
              className="w-full"
              defaultValue={comment.body}
              aria-label="Edit comment"
            />
            <div className="mt-2 flex items-center gap-2">
              <Button type="submit" variant="primary" size="xs" disabled={pending}>
                {pending ? "Saving…" : "Save"}
              </Button>
              <Button size="xs" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
            {state && !state.ok ? (
              <FormError message={state.error} size="xs" className="mt-2" />
            ) : null}
          </form>
        ) : (
          <>
            <CommentBody body={comment.body} members={members} />
            {isAuthor || viewerIsAdmin ? (
              <div className="mt-1 flex items-center gap-1.5">
                {/* Only the author edits, even for an admin: an admin
                    rewriting someone else's words makes the thread
                    unciteable. An admin who objects can delete. */}
                {isAuthor ? (
                  <Button size="xs" onClick={() => setEditing(true)} className="gap-1.5">
                    <Icon name="edit" size="sm" />
                    Edit
                  </Button>
                ) : null}
                <form action={remove}>
                  <ScopeFields scope={scope} commentId={comment.id} />
                  <Button type="submit" size="xs" className="gap-1.5">
                    <Icon name="delete" size="sm" />
                    Delete
                  </Button>
                </form>
              </div>
            ) : null}
            {error ? <FormError message={error} size="xs" className="mt-1" /> : null}
          </>
        )}
      </div>
    </div>
  );
}

export function CommentThread({
  comments,
  scope,
  members,
  viewerId,
  viewerIsAdmin,
}: {
  comments: CommentRow[];
  scope: Scope;
  members: Mentionable[];
  viewerId: string;
  viewerIsAdmin: boolean;
}) {
  return (
    <div className="space-y-4">
      {comments.length > 0 ? (
        <div className="space-y-4">
          {comments.map((c) => (
            <CommentItem
              key={c.id}
              comment={c}
              scope={scope}
              members={members}
              viewerId={viewerId}
              viewerIsAdmin={viewerIsAdmin}
            />
          ))}
        </div>
      ) : (
        <p className="text-sm text-[var(--text-3)]">
          No comments yet. Say what changed, or what you need.
        </p>
      )}
      <CommentComposer scope={scope} />
    </div>
  );
}
