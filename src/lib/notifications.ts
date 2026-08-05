import type { NotificationType } from "@prisma/client";
import type { IconName } from "@/lib/icons";
import { parseDateInput } from "@/lib/dates";

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
    case "ANNOUNCEMENT_POSTED":
      return "campaign";
    case "EVENT_SCHEDULED":
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
    case "ANNOUNCEMENT_POSTED":
      return `${who} posted ${what}`;
    // Not the shared `what` above: its fallback is "a task", a lie here — an
    // EVENT_SCHEDULED row missing meta.name would read "Priya scheduled a
    // task", leaking the wrong noun into the surface §13 locks hardest.
    // Local const, not a per-type default map: that hoist is worth doing the
    // moment a third type needs a noun of its own, not at two.
    case "EVENT_SCHEDULED": {
      const eventWhat = metaString(n.meta, "name") ?? "an event";
      const when = metaString(n.meta, "when") ?? "";
      return metaString(n.meta, "movedFrom")
        ? `${who} moved ${eventWhat} to ${when}`
        : `${who} scheduled ${eventWhat} — ${when}`;
    }
    default:
      return `${who} updated ${what}`;
  }
}

/** Where the row goes when clicked. Task and comment notifications both land
 * on the task, because a comment has no page of its own — the thread lives on
 * the task it belongs to. */
export function notificationHref(n: {
  entityType: string;
  entityId: string;
  meta?: Record<string, unknown> | null;
}): string {
  switch (n.entityType) {
    case "TASK":
      return `/tasks/${n.entityId}`;
    // The board, not a per-announcement page — there is no such page, and the
    // board is where the thing you were told about is.
    case "ANNOUNCEMENT":
      return "/announcements";
    // The day the event is on, not an event page — there isn't one (§9).
    // `meta.date` is frozen at write time, so an old notification always
    // lands on the day it announced rather than wherever the event moved to
    // since. Validated with parseDateInput rather than interpolated
    // straight through: only a hand-edited row can fail that check, and the
    // fallback is what keeps such a row from building a link that looks
    // right and 404s.
    case "CALENDAR_EVENT": {
      const date = metaString(n.meta ?? null, "date");
      return date && parseDateInput(date) ? `/calendar?view=day&date=${date}` : "/calendar";
    }
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
