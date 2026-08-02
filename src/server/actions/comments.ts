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
import { prisma } from "@/lib/prisma";
import { err, type ActionResult } from "@/lib/action-result";
import { requireUser, AuthError } from "@/server/guards";
import { addComment, updateComment, removeComment } from "@/lib/comment-service";

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
  _prev: ActionResult<{ id: string }> | null,
  formData: FormData
): Promise<ActionResult<{ id: string }>> {
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
    return result;
  } catch (e) {
    if (e instanceof AuthError) return err(e.message);
    throw e;
  }
}

export async function updateCommentAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
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
