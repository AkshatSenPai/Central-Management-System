import type { PrismaClient } from "@prisma/client";
import { clientInitials } from "@/lib/client";
import type { NotificationView } from "@/lib/notifications";

export type NotificationRow = NotificationView & {
  actorInitials: string | null;
};

/** The panel's list: mine, newest first, read and unread together.
 *
 * Read ones are kept in the list rather than hidden, so the panel still has
 * something in it the second time you open it — a notification centre that
 * empties itself on read is a notification centre nobody trusts to check.
 */
export async function listNotifications(
  db: PrismaClient,
  input: { userId: string; limit?: number }
): Promise<NotificationRow[]> {
  const rows = await db.notification.findMany({
    where: { recipientId: input.userId },
    orderBy: { createdAt: "desc" },
    take: input.limit ?? 12,
    select: {
      id: true,
      type: true,
      entityType: true,
      entityId: true,
      meta: true,
      readAt: true,
      createdAt: true,
      actor: { select: { name: true } },
    },
  });

  return rows.map((n) => ({
    id: n.id,
    type: n.type,
    actorName: n.actor?.name ?? null,
    actorInitials: n.actor ? clientInitials(n.actor.name) : null,
    entityType: n.entityType,
    entityId: n.entityId,
    meta:
      n.meta !== null && typeof n.meta === "object" && !Array.isArray(n.meta)
        ? (n.meta as Record<string, unknown>)
        : null,
    readAt: n.readAt,
    createdAt: n.createdAt,
  }));
}

/** The badge. A count, not a list — the layout renders on every page, and
 * pulling twelve rows to length them would be a waste on every navigation. */
export async function countUnreadNotifications(
  db: PrismaClient,
  userId: string
): Promise<number> {
  return db.notification.count({ where: { recipientId: userId, readAt: null } });
}
