import { Prisma, type PrismaClient } from "@prisma/client";
import { ActionResult, ok, err } from "@/lib/action-result";
import { recordActivity } from "@/lib/activity";
import { commentSchema, extractMentionedUserIds, type Mentionable } from "@/lib/rich-text";
import { notify } from "@/lib/notification-service";

/** Same race class as checklist-service: the scope read succeeded, but the row
 * was gone by the time the transaction ran. */
function isRowGoneRace(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025";
}

/** The first line of every comment body, for the activity feed.
 *
 * The feed says "Dana commented on Build the landing section", not the comment
 * itself — but the meta carries a short excerpt so a later phase can render a
 * preview without re-reading the comment (which may by then be deleted). */
function excerpt(body: string, max = 80): string {
  const line = body.trim().split("\n")[0];
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** A comment knows its taskId; every activity row is scoped by *client*, and
 * an event logged with the wrong scope never reaches the client timeline.
 * Walks comment -> task -> project in one query, so a comment on a personal
 * task falls out as `clientId: null` with no special case. Mirrors
 * loadChecklistScope. Module-private. */
async function loadCommentScope(
  db: PrismaClient,
  commentId: string
): Promise<
  | { ok: false }
  | {
      ok: true;
      comment: {
        id: string;
        body: string;
        authorId: string;
        taskId: string;
        mentionedUserIds: string[];
      };
      taskTitle: string;
      clientId: string | null;
    }
> {
  const comment = await db.comment.findUnique({
    where: { id: commentId },
    select: {
      id: true,
      body: true,
      authorId: true,
      taskId: true,
      mentionedUserIds: true,
      task: { select: { title: true, project: { select: { clientId: true } } } },
    },
  });
  if (!comment) return { ok: false };
  return {
    ok: true,
    comment: {
      id: comment.id,
      body: comment.body,
      authorId: comment.authorId,
      taskId: comment.taskId,
      mentionedUserIds: comment.mentionedUserIds,
    },
    taskTitle: comment.task.title,
    clientId: comment.task.project?.clientId ?? null,
  };
}

export async function addComment(
  db: PrismaClient,
  input: { taskId: string; body: string; actorId: string; members: readonly Mentionable[] }
): Promise<ActionResult<{ id: string; notificationIds: string[] }>> {
  const parsed = commentSchema.safeParse({ body: input.body });
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Invalid input");

  const task = await db.task.findUnique({
    where: { id: input.taskId },
    select: { title: true, project: { select: { clientId: true } } },
  });
  if (!task) return err("Task not found");
  const clientId = task.project?.clientId ?? null;

  // Resolved here, not in the action, so every caller stores the same thing.
  const mentionedUserIds = extractMentionedUserIds(parsed.data.body, input.members);

  const created = await db.$transaction(async (tx) => {
    const comment = await tx.comment.create({
      data: {
        taskId: input.taskId,
        authorId: input.actorId,
        body: parsed.data.body,
        mentionedUserIds,
      },
    });
    await recordActivity(tx, {
      actorId: input.actorId,
      entityType: "COMMENT",
      entityId: comment.id,
      action: "comment.added",
      clientId,
      // `name` is the task, matching every other verb's "what was acted on".
      meta: { name: task.title, excerpt: excerpt(parsed.data.body), mentionedUserIds },
    });
    // The payoff for storing mentionedUserIds in 3c. Inside the transaction,
    // so a rolled-back comment cannot leave someone told they were mentioned
    // in a comment that does not exist.
    // Carried out so the action can push after the commit. Note the excerpt
    // stays in `meta` for the bell but never reaches a device: the push body
    // is built by `describeNotification`, which cannot read that key.
    const notificationIds = await notify(tx, {
      recipientIds: mentionedUserIds,
      actorId: input.actorId,
      type: "COMMENT_MENTION",
      entityType: "TASK",
      entityId: input.taskId,
      meta: { name: task.title, excerpt: excerpt(parsed.data.body) },
    });
    return { comment, notificationIds };
  });
  return ok({ id: created.comment.id, notificationIds: created.notificationIds });
}

/** Only the author may edit (spec 3c D3). Not even an admin: an admin editing
 * someone else's words would make the thread unciteable, which is exactly what
 * the "edited" marker exists to prevent. An admin who objects can delete. */
export async function updateComment(
  db: PrismaClient,
  input: {
    commentId: string;
    body: string;
    actorId: string;
    members: readonly Mentionable[];
  }
): Promise<ActionResult<{ notificationIds: string[] }>> {
  const parsed = commentSchema.safeParse({ body: input.body });
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Invalid input");

  const scope = await loadCommentScope(db, input.commentId);
  if (!scope.ok) return err("Comment not found");
  if (scope.comment.authorId !== input.actorId) return err("You can only edit your own comments");

  // No change, no write and no activity row — the same no-op rule as
  // setChecklistItemDone, and it keeps "edited" off a comment that was opened
  // and saved without being touched.
  if (scope.comment.body === parsed.data.body) return ok({ notificationIds: [] });

  const mentionedUserIds = extractMentionedUserIds(parsed.data.body, input.members);
  // Only people the edit *added*. Editing a typo in a comment that already
  // mentioned three people must not ping all three again — the notification is
  // for "you were mentioned", and they already were.
  const previouslyMentioned = new Set(scope.comment.mentionedUserIds);
  const newlyMentioned = mentionedUserIds.filter((id) => !previouslyMentioned.has(id));

  let notificationIds: string[] = [];
  try {
    await db.$transaction(async (tx) => {
      await tx.comment.update({
        where: { id: input.commentId },
        data: { body: parsed.data.body, mentionedUserIds, editedAt: new Date() },
      });
      notificationIds = await notify(tx, {
        recipientIds: newlyMentioned,
        actorId: input.actorId,
        type: "COMMENT_MENTION",
        entityType: "TASK",
        entityId: scope.comment.taskId,
        meta: { name: scope.taskTitle, excerpt: excerpt(parsed.data.body) },
      });
      await recordActivity(tx, {
        actorId: input.actorId,
        entityType: "COMMENT",
        entityId: input.commentId,
        action: "comment.edited",
        clientId: scope.clientId,
        meta: { name: scope.taskTitle, excerpt: excerpt(parsed.data.body) },
      });
    });
  } catch (e) {
    if (isRowGoneRace(e)) return err("Comment not found");
    throw e;
  }
  return ok({ notificationIds });
}

/** The author, or an admin (spec 3c D3). `isAdmin` is passed in rather than
 * read here, because this layer never touches the session — the same split
 * every other service uses. */
export async function removeComment(
  db: PrismaClient,
  input: { commentId: string; actorId: string; isAdmin: boolean }
): Promise<ActionResult> {
  const scope = await loadCommentScope(db, input.commentId);
  if (!scope.ok) return err("Comment not found");
  if (scope.comment.authorId !== input.actorId && !input.isAdmin) {
    return err("You can only delete your own comments");
  }

  // Captured before the delete — afterwards there is nothing to read, and the
  // activity row is the only remaining record that this comment existed.
  const body = scope.comment.body;

  try {
    await db.$transaction(async (tx) => {
      await tx.comment.delete({ where: { id: input.commentId } });
      await recordActivity(tx, {
        actorId: input.actorId,
        entityType: "COMMENT",
        entityId: input.commentId,
        action: "comment.deleted",
        clientId: scope.clientId,
        meta: { name: scope.taskTitle, excerpt: excerpt(body) },
      });
    });
  } catch (e) {
    if (isRowGoneRace(e)) return err("Comment not found");
    throw e;
  }
  return ok(undefined);
}
