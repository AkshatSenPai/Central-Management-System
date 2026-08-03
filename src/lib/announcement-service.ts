import { Prisma, type PrismaClient } from "@prisma/client";
import { ActionResult, ok, err } from "@/lib/action-result";
import { recordActivity } from "@/lib/activity";
import { notify } from "@/lib/notification-service";
import { announcementSchema } from "@/lib/announcement";
import { parseDateInput } from "@/lib/dates";

function isRowGoneRace(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025";
}

/** Any member may post (spec 6.3) — this is a studio noticeboard, not a
 * management channel. Editing and deleting are the author's, or an admin's,
 * matching the comment rules in 3c D3. */
export async function addAnnouncement(
  db: PrismaClient,
  input: {
    title: string;
    body: string;
    pinnedUntil: string;
    actorId: string;
    /** Everyone active, so the whole studio is told. Passed in rather than
     * queried here, because this layer never decides who the members are. */
    recipientIds: readonly string[];
  }
): Promise<ActionResult<{ id: string }>> {
  const parsed = announcementSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Invalid input");

  const created = await db.$transaction(async (tx) => {
    const announcement = await tx.announcement.create({
      data: {
        authorId: input.actorId,
        title: parsed.data.title,
        body: parsed.data.body,
        pinnedUntil: parseDateInput(input.pinnedUntil ?? ""),
      },
    });
    await recordActivity(tx, {
      actorId: input.actorId,
      entityType: "ANNOUNCEMENT",
      entityId: announcement.id,
      action: "announcement.posted",
      // No client scope: an announcement is studio-wide, so it belongs to no
      // client timeline. Null is the honest value, not a missing one.
      clientId: null,
      meta: { name: announcement.title },
    });
    // notify() drops the actor, so posting does not notify the poster.
    await notify(tx, {
      recipientIds: input.recipientIds,
      actorId: input.actorId,
      type: "ANNOUNCEMENT_POSTED",
      entityType: "ANNOUNCEMENT",
      entityId: announcement.id,
      meta: { name: announcement.title },
    });
    return announcement;
  });
  return ok({ id: created.id });
}

export async function updateAnnouncement(
  db: PrismaClient,
  input: {
    announcementId: string;
    title: string;
    body: string;
    pinnedUntil: string;
    actorId: string;
    isAdmin: boolean;
  }
): Promise<ActionResult> {
  const parsed = announcementSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Invalid input");

  const existing = await db.announcement.findUnique({
    where: { id: input.announcementId },
    select: { authorId: true },
  });
  if (!existing) return err("Announcement not found");
  if (existing.authorId !== input.actorId && !input.isAdmin) {
    return err("You can only edit your own announcements");
  }

  try {
    await db.$transaction(async (tx) => {
      await tx.announcement.update({
        where: { id: input.announcementId },
        data: {
          title: parsed.data.title,
          body: parsed.data.body,
          pinnedUntil: parseDateInput(input.pinnedUntil ?? ""),
        },
      });
      await recordActivity(tx, {
        actorId: input.actorId,
        entityType: "ANNOUNCEMENT",
        entityId: input.announcementId,
        action: "announcement.updated",
        clientId: null,
        meta: { name: parsed.data.title },
      });
    });
  } catch (e) {
    if (isRowGoneRace(e)) return err("Announcement not found");
    throw e;
  }
  return ok(undefined);
}

export async function removeAnnouncement(
  db: PrismaClient,
  input: { announcementId: string; actorId: string; isAdmin: boolean }
): Promise<ActionResult> {
  const existing = await db.announcement.findUnique({
    where: { id: input.announcementId },
    select: { authorId: true, title: true },
  });
  if (!existing) return err("Announcement not found");
  if (existing.authorId !== input.actorId && !input.isAdmin) {
    return err("You can only delete your own announcements");
  }

  try {
    await db.$transaction(async (tx) => {
      await tx.announcement.delete({ where: { id: input.announcementId } });
      // Notifications pointing at it would be links to a 404 — the same
      // reason removeTask clears its own.
      await tx.notification.deleteMany({
        where: { entityType: "ANNOUNCEMENT", entityId: input.announcementId },
      });
      await recordActivity(tx, {
        actorId: input.actorId,
        entityType: "ANNOUNCEMENT",
        entityId: input.announcementId,
        action: "announcement.removed",
        clientId: null,
        meta: { name: existing.title },
      });
    });
  } catch (e) {
    if (isRowGoneRace(e)) return err("Announcement not found");
    throw e;
  }
  return ok(undefined);
}
