"use server";

/**
 * Revalidation map — keep in sync with the calls below.
 *
 * | Mutation                   | revalidatePath calls |
 * |----------------------------|----------------------|
 * | markNotificationReadAction | `/`, layout scope    |
 * | markAllNotificationsReadAction | `/`, layout scope |
 *
 * Both revalidate the layout rather than a page, because the unread badge
 * lives in the topbar and the topbar is in the layout — revalidating the
 * current page alone would leave the badge showing a count that is no longer
 * true until the next full navigation.
 *
 * Both are requireUser, and both scope their write by `recipientId: user.id`.
 * That is the authorisation: a notification id is a cuid, but guessing one
 * must still not let anyone mark somebody else's bell as read. The where
 * clause is the check — there is no separate ownership lookup to forget.
 */

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { err, ok, type ActionResult } from "@/lib/action-result";
import { requireUser, AuthError } from "@/server/guards";

export async function markNotificationReadAction(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireUser();
    await prisma.notification.updateMany({
      // Scoped by recipient as well as id — see the note above.
      where: { id: String(formData.get("notificationId") ?? ""), recipientId: user.id },
      data: { readAt: new Date() },
    });
    revalidatePath("/", "layout");
    return ok(undefined);
  } catch (e) {
    if (e instanceof AuthError) return err(e.message);
    throw e;
  }
}

export async function markAllNotificationsReadAction(): Promise<ActionResult> {
  try {
    const user = await requireUser();
    // `readAt: null` in the where means an already-read notification keeps its
    // original timestamp rather than being restamped to now.
    await prisma.notification.updateMany({
      where: { recipientId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
    revalidatePath("/", "layout");
    return ok(undefined);
  } catch (e) {
    if (e instanceof AuthError) return err(e.message);
    throw e;
  }
}
