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
 *
 * **Returns the ids of the rows it wrote, which is the handle push needs.**
 * It deliberately returns ids rather than recipient ids: the fan-out re-reads
 * these exact rows, so the sentence pushed to a phone is built from the same
 * record the bell renders and the two cannot drift. It also means push never
 * computes a recipient set of its own, so the actor-drop and dedupe rules above
 * stay stated exactly once, here.
 *
 * **No push logic lives in this function**, and none may. It runs inside the
 * caller's transaction — that is the whole point of it — and a network call in
 * that position holds a connection open on a third party's latency and can
 * deliver a notification about a write that then rolls back. The Server Action
 * hands these ids to `pushForNotifications` through `after()` once the commit
 * is durable.
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
): Promise<string[]> {
  const recipients = [...new Set(input.recipientIds)].filter((id) => id !== input.actorId);
  if (recipients.length === 0) return [];

  const created = await db.notification.createManyAndReturn({
    data: recipients.map((recipientId) => ({
      recipientId,
      actorId: input.actorId,
      type: input.type,
      entityType: input.entityType,
      entityId: input.entityId,
      meta: (input.meta ?? Prisma.DbNull) as Prisma.InputJsonValue | typeof Prisma.DbNull,
    })),
    select: { id: true },
  });
  return created.map((row) => row.id);
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
