"use server";

/**
 * Revalidation map — keep in sync with the calls below.
 *
 * | Mutation              | revalidatePath calls                                                        |
 * |-----------------------|-----------------------------------------------------------------------------|
 * | addCommentAction      | `/tasks/{taskId}`; when projectId: `/projects/{projectId}`; when clientId: `/clients/{clientId}` |
 * | updateCommentAction   | the same set                                                                 |
 * | removeCommentAction   | the same set                                                                 |
 *
 * Every comment mutation reaches the client path for the same reason the
 * checklist ones do: each writes a client-scoped ActivityLog row, and the
 * client-detail timeline is the only reader of those rows.
 *
 * Every action here is requireUser. Deletion's admin branch is an argument to
 * the service (`isAdmin`), not a `requireAdmin` guard — a member deleting
 * their *own* comment is allowed, so the check cannot be at the door.
 */

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { pushForNotifications } from "@/lib/push-fanout";
import { err, type ActionResult } from "@/lib/action-result";
import { requireUser, AuthError } from "@/server/guards";
import { addComment, updateComment, removeComment } from "@/lib/comment-service";

/** Hands the notification ids to the push fan-out once the response is sent.
 *
 * See the twin in `tasks.ts`. `after()` is the seam: it runs after the
 * transaction that wrote those rows has committed, so a mention push can never
 * describe a comment that was rolled back — which is the same guarantee
 * `notify()` gives the bell, extended to the phone. */
function pushAfterCommit(notificationIds: string[]): void {
  if (notificationIds.length === 0) return;
  after(() => pushForNotifications(prisma, notificationIds));
}

/** The member list mentions resolve against. Active only: mentioning someone
 * who has left should stay literal text rather than linking to a profile
 * nobody can act on. */
async function mentionableMembers() {
  return prisma.user.findMany({
    where: { active: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

function revalidate(taskId: string, projectId: string, clientId: string) {
  revalidatePath(`/tasks/${taskId}`);
  if (projectId) revalidatePath(`/projects/${projectId}`);
  if (clientId) revalidatePath(`/clients/${clientId}`);
}

export async function addCommentAction(
  _prev: ActionResult<{ id: string; notificationIds: string[] }> | null,
  formData: FormData
): Promise<ActionResult<{ id: string; notificationIds: string[] }>> {
  try {
    const user = await requireUser();
    const taskId = String(formData.get("taskId") ?? "");
    const result = await addComment(prisma, {
      taskId,
      body: String(formData.get("body") ?? ""),
      actorId: user.id,
      members: await mentionableMembers(),
    });
    revalidate(
      taskId,
      String(formData.get("projectId") ?? ""),
      String(formData.get("clientId") ?? "")
    );
    // ok branch only — pushing before checking would announce a mention in a
    // comment that was never written.
    if (result.ok) pushAfterCommit(result.data.notificationIds);
    return result;
  } catch (e) {
    if (e instanceof AuthError) return err(e.message);
    throw e;
  }
}

export async function updateCommentAction(
  _prev: ActionResult<{ notificationIds: string[] }> | null,
  formData: FormData
): Promise<ActionResult<{ notificationIds: string[] }>> {
  try {
    const user = await requireUser();
    const result = await updateComment(prisma, {
      commentId: String(formData.get("commentId") ?? ""),
      body: String(formData.get("body") ?? ""),
      actorId: user.id,
      members: await mentionableMembers(),
    });
    revalidate(
      String(formData.get("taskId") ?? ""),
      String(formData.get("projectId") ?? ""),
      String(formData.get("clientId") ?? "")
    );
    // Only people the edit newly mentioned; updateComment already filtered.
    if (result.ok) pushAfterCommit(result.data.notificationIds);
    return result;
  } catch (e) {
    if (e instanceof AuthError) return err(e.message);
    throw e;
  }
}

export async function removeCommentAction(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const result = await removeComment(prisma, {
      commentId: String(formData.get("commentId") ?? ""),
      actorId: user.id,
      isAdmin: user.role === "ADMIN",
    });
    revalidate(
      String(formData.get("taskId") ?? ""),
      String(formData.get("projectId") ?? ""),
      String(formData.get("clientId") ?? "")
    );
    return result;
  } catch (e) {
    if (e instanceof AuthError) return err(e.message);
    throw e;
  }
}
