import type { NotificationType } from "@prisma/client";
import { describeNotification, notificationHref } from "@/lib/notifications";

/** What a push notification says, as a pure function — no Prisma, no network,
 * so every rule below unit-tests without either.
 *
 * **This text lands on a locked phone.** It sits on a lock screen on a train,
 * persists in the notification centre, and on Android is written to the system
 * log. That is the constraint the whole module is shaped around: this app holds
 * client names, comment threads, invoices and a credentials vault, and a
 * notification body is the least private surface any of it could reach. */

/** The 2 KB ceiling is deliberately conservative. RFC 8291 guarantees only
 * 4096 bytes of *ciphertext*, and encryption adds overhead, so 2 KB of
 * plaintext sits comfortably inside the floor every push service promises. */
export const MAX_PAYLOAD_BYTES = 2048;

/** Long enough to identify the thing, short enough that a phone renders it.
 * Matches the 80 used by the comment excerpt helper rather than inventing a
 * second truncation style. */
export const MAX_TITLE_CHARS = 80;

export type PushPayload = {
  title: string;
  body: string;
  /** In-app path the notification opens. Same value the bell row links to. */
  url: string;
  /** Collapses repeats about the same thing on one device, so ten comments on
   * one task replace each other instead of stacking ten deep. */
  tag: string;
};

/** The row shape this needs. Narrower than the Prisma model on purpose — see
 * `buildPushPayload` for why `meta` is not passed through wholesale. */
export type PushSourceRow = {
  type: NotificationType;
  entityType: string;
  entityId: string;
  actorName: string | null;
  meta: Record<string, unknown> | null;
};

export function truncateTitle(value: string, max: number = MAX_TITLE_CHARS): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

/** Builds the payload for one notification row.
 *
 * **The body is `describeNotification`, and that is a security decision as much
 * as a consistency one.** Consistency: the sentence on the phone is the exact
 * sentence in the bell, so the two can never drift. Security: that function
 * reads only `meta.name`, `meta.to`, `meta.when` and `meta.movedFrom` — **it
 * cannot reach `meta.excerpt`**. Reusing it therefore withholds the comment
 * body by construction rather than by a rule somebody has to remember. Do not
 * "improve" this by formatting the body here from `meta` directly; that would
 * quietly remove the guarantee.
 *
 * Specifically withheld, all of which live in `meta` on some row type:
 *   - `excerpt` — a colleague's free-typed prose about a client.
 *   - `mentionedUserIds` — a list of colleagues' ids, onto a device the studio
 *     does not control.
 * `data` carries the url and nothing else.
 *
 * The title is the app name rather than the subject: the sender is what a lock
 * screen shows in bold, and "Meridian Ops" is the useful thing there. The noun
 * belongs in the body, where `describeNotification` already puts it. */
export function buildPushPayload(row: PushSourceRow): PushPayload {
  // Truncated before the sentence is built, not after, so the ellipsis lands
  // inside the task title rather than eating the verb that follows it.
  const meta = row.meta
    ? { ...row.meta, ...(typeof row.meta.name === "string" ? { name: truncateTitle(row.meta.name) } : {}) }
    : row.meta;

  const payload: PushPayload = {
    title: "Meridian Ops",
    body: describeNotification({ type: row.type, actorName: row.actorName, meta }),
    url: notificationHref({ entityType: row.entityType, entityId: row.entityId, meta }),
    tag: `${row.entityType}:${row.entityId}`,
  };

  // Last-resort guard. Nothing should reach it — the title is already capped
  // and every other field is short — but a payload over the limit is rejected
  // by the push service outright, and a generic sentence that arrives beats a
  // precise one that does not.
  if (payloadBytes(payload) > MAX_PAYLOAD_BYTES) {
    return { ...payload, body: "You have a new notification" };
  }
  return payload;
}

export function payloadBytes(payload: PushPayload): number {
  return Buffer.byteLength(JSON.stringify(payload), "utf8");
}
