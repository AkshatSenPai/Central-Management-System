import type { NotificationType } from "@prisma/client";
import type { IconName } from "@/lib/icons";

/** Pure rendering for the notification panel — no Prisma, no session, so it
 * unit-tests without a database. Mirrors `describeActivity`, including its
 * most important property: it must stay **total**. A type this file does not
 * recognise renders a plain sentence rather than throwing, because a
 * notification that crashes the panel takes every other notification with it. */

export type NotificationView = {
  id: string;
  type: NotificationType;
  actorName: string | null;
  entityType: string;
  entityId: string;
  meta: Record<string, unknown> | null;
  readAt: Date | null;
  createdAt: Date;
};

function metaString(meta: NotificationView["meta"], key: string): string | null {
  const value = meta?.[key];
  return typeof value === "string" ? value : null;
}

/** "AT_RISK" -> "At Risk". Duplicated from activity.ts rather than shared:
 * that copy is module-private there, and exporting it to save six lines would
 * couple the notification vocabulary to the activity vocabulary, which are
 * free to diverge. */
function humanizeEnum(value: string | null): string {
  if (!value) return "";
  return value
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

/** The glyph beside each row, echoing what happened. */
export function notificationIcon(type: NotificationType): IconName {
  switch (type) {
    case "TASK_ASSIGNED":
      return "check_circle";
    case "COMMENT_MENTION":
      return "alternate_email";
    case "TASK_STATUS_CHANGED":
      return "layers";
    case "TASK_DUE_SOON":
      return "event";
    default:
      return "check_circle";
  }
}

/** One sentence, in the same voice as the activity feed: who did what to
 * which thing. The subject is always "you", because this is the only surface
 * in the app that is about the reader rather than about the studio. */
export function describeNotification(n: {
  type: NotificationType;
  actorName: string | null;
  meta: Record<string, unknown> | null;
}): string {
  const who = n.actorName ?? "Someone";
  const what = metaString(n.meta, "name") ?? "a task";

  switch (n.type) {
    case "TASK_ASSIGNED":
      return `${who} assigned you ${what}`;
    case "COMMENT_MENTION":
      return `${who} mentioned you on ${what}`;
    case "TASK_STATUS_CHANGED":
      return `${who} moved ${what} to ${humanizeEnum(metaString(n.meta, "to"))}`;
    // No actor: a deadline arriving is not something anybody did.
    case "TASK_DUE_SOON":
      return `${what} is due soon`;
    default:
      return `${who} updated ${what}`;
  }
}

/** Where the row goes when clicked. Task and comment notifications both land
 * on the task, because a comment has no page of its own — the thread lives on
 * the task it belongs to. */
export function notificationHref(n: { entityType: string; entityId: string }): string {
  switch (n.entityType) {
    case "TASK":
      return `/tasks/${n.entityId}`;
    default:
      return "/dashboard";
  }
}

/** The badge. Capped, because a three-digit number does not fit a 16px circle
 * and "99+" says the same thing: too many to count. */
export function unreadBadge(count: number): string | null {
  if (count <= 0) return null;
  return count > 99 ? "99+" : String(count);
}
