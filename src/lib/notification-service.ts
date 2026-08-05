import { Prisma, type PrismaClient, type NotificationType } from "@prisma/client";

/** Narrow on purpose, exactly like `ActivityDb`: a `$transaction` tx satisfies
 * this, so a service can write notifications inside the same transaction as
 * the mutation that caused them. Widening it to PrismaClient would force every
 * caller to notify outside its transaction — and then a rolled-back assignment
 * would still have told somebody it happened. */
export type NotificationDb = Pick<PrismaClient, "notification">;

export type NotificationMeta = Record<string, unknown> | null;

/** What a notification can point at. A union rather than a free string, so
 * `notificationHref` stays exhaustive and a new kind cannot be added without
 * deciding where clicking it goes. */
export type NotificationEntity = "TASK" | "COMMENT" | "ANNOUNCEMENT" | "CALENDAR_EVENT";

/** Writes one row per recipient.
 *
 * Two rules are enforced here rather than at each of the call sites, because
 * there are several call sites and they will only grow:
 *
 * 1. **The actor is never notified.** Assigning yourself a task, or mentioning
 *    yourself, must not light up your own bell. Every caller would otherwise
 *    have to remember this, and the one that forgot would be the one nobody
 *    noticed.
 * 2. **Recipients are deduplicated.** Mentioning the same person twice in one
 *    comment is one notification, matching how `extractMentionedUserIds`
 *    already dedupes.
 *
 * A no-op when nothing is left after those two filters — `createMany` with an
 * empty array is a pointless round trip inside someone's transaction.
 */
export async function notify(
  db: NotificationDb,
  input: {
    recipientIds: readonly string[];
    /** Null only for system-generated notifications (TASK_DUE_SOON). */
    actorId: string | null;
    type: NotificationType;
    entityType: NotificationEntity;
    entityId: string;
    meta?: NotificationMeta;
  }
): Promise<void> {
  const recipients = [...new Set(input.recipientIds)].filter((id) => id !== input.actorId);
  if (recipients.length === 0) return;

  await db.notification.createMany({
    data: recipients.map((recipientId) => ({
      recipientId,
      actorId: input.actorId,
      type: input.type,
      entityType: input.entityType,
      entityId: input.entityId,
      meta: (input.meta ?? Prisma.DbNull) as Prisma.InputJsonValue | typeof Prisma.DbNull,
    })),
  });
}

/** Clears notifications pointing at an entity that no longer exists.
 *
 * `entityId` carries no foreign key — the same decision as
 * ActivityLog.entityId — so nothing cascades and this has to be called
 * explicitly when a task is removed. Unlike the activity log, which is an
 * audit trail and must survive its subject, a notification about a deleted
 * task is only a link to a 404. */
export async function clearNotificationsFor(
  db: NotificationDb,
  input: { entityType: NotificationEntity; entityId: string }
): Promise<void> {
  await db.notification.deleteMany({
    where: { entityType: input.entityType, entityId: input.entityId },
  });
}
