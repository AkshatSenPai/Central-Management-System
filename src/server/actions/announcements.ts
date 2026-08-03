"use server";

/**
 * Revalidation map — keep in sync with the calls below.
 *
 * | Mutation                  | revalidatePath calls        |
 * |---------------------------|-----------------------------|
 * | addAnnouncementAction      | `/announcements`, `/dashboard`, and `/` at layout scope |
 * | updateAnnouncementAction   | the same set                 |
 * | removeAnnouncementAction   | the same set                 |
 *
 * `/dashboard` because a pinned announcement shows there. The layout scope is
 * for the notification badge, which posting changes for everyone else.
 *
 * All three are requireUser: any member may post to the studio noticeboard
 * (spec 6.3). Author-or-admin is enforced in the service, not at the door,
 * because a member editing their *own* post is allowed.
 */

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { err, type ActionResult } from "@/lib/action-result";
import { requireUser, AuthError } from "@/server/guards";
import {
  addAnnouncement,
  updateAnnouncement,
  removeAnnouncement,
} from "@/lib/announcement-service";

function revalidate() {
  revalidatePath("/announcements");
  revalidatePath("/dashboard");
  revalidatePath("/", "layout");
}

export async function addAnnouncementAction(
  _prev: ActionResult<{ id: string }> | null,
  formData: FormData
): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireUser();
    // Everyone active — a studio noticeboard tells the studio. notify() drops
    // the actor, so the poster is not told about their own post.
    const members = await prisma.user.findMany({
      where: { active: true },
      select: { id: true },
    });
    const result = await addAnnouncement(prisma, {
      title: String(formData.get("title") ?? ""),
      body: String(formData.get("body") ?? ""),
      pinnedUntil: String(formData.get("pinnedUntil") ?? ""),
      actorId: user.id,
      recipientIds: members.map((m) => m.id),
    });
    revalidate();
    return result;
  } catch (e) {
    if (e instanceof AuthError) return err(e.message);
    throw e;
  }
}

export async function updateAnnouncementAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const result = await updateAnnouncement(prisma, {
      announcementId: String(formData.get("announcementId") ?? ""),
      title: String(formData.get("title") ?? ""),
      body: String(formData.get("body") ?? ""),
      pinnedUntil: String(formData.get("pinnedUntil") ?? ""),
      actorId: user.id,
      isAdmin: user.role === "ADMIN",
    });
    revalidate();
    return result;
  } catch (e) {
    if (e instanceof AuthError) return err(e.message);
    throw e;
  }
}

export async function removeAnnouncementAction(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const result = await removeAnnouncement(prisma, {
      announcementId: String(formData.get("announcementId") ?? ""),
      actorId: user.id,
      isAdmin: user.role === "ADMIN",
    });
    revalidate();
    return result;
  } catch (e) {
    if (e instanceof AuthError) return err(e.message);
    throw e;
  }
}
