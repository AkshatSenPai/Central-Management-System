import webpush from "web-push";
import type { PushPayload } from "@/lib/push-payload";

/** The one place this app sends a push notification, and the twin of
 * `email-sender.ts` — same contract, same reasons, deliberately.
 *
 * **Nothing here may be called from inside a database transaction.** `notify()`
 * writes bell rows inside the caller's transaction on purpose, so a rolled-back
 * comment cannot tell somebody they were mentioned. A network call in that
 * position holds a Postgres connection open on a third party's latency, and a
 * push already delivered to a phone cannot be recalled. Services therefore
 * return the notification ids they wrote, and the Server Action hands them to
 * the fan-out through `after()` once the write is durable.
 *
 * **This is the only file in the repo that imports `web-push`**, the same
 * containment `email-sender.ts` gives Resend. The package is Node-only and
 * will not run on edge; keeping it behind one module is what stops that
 * spreading. Unlike Resend — one endpoint, a bearer token — Web Push needs
 * VAPID JWT signing and RFC 8291 payload encryption per recipient, which is
 * real cryptography and worth a library. Same judgement as `@aws-sdk` for R2.
 */

const TTL_SECONDS = 86400;

export type PushOutcome =
  | { sent: true }
  | { sent: false; reason: "not-configured" | "gone" | "rejected" | "unreachable"; detail?: string };

/** All three variables are required, so a half-configured environment skips
 * cleanly rather than failing at the push service. */
function config(): { publicKey: string; privateKey: string; subject: string } | null {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return null;
  return { publicKey, privateKey, subject };
}

export function isPushConfigured(): boolean {
  return config() !== null;
}

/** Status codes that mean the subscription is permanently dead.
 *
 * 404 and 410 are the push service saying it has never heard of this endpoint
 * or has retired it. 403 means the VAPID keys no longer match the ones the
 * subscription was created with — which happens after a key rotation, and is
 * equally unrecoverable for that row.
 *
 * Every other status is transient by definition: 429 is rate limiting, 5xx is
 * the service having a bad day, a thrown error is the network. None of those
 * may ever delete a row. Getting this backwards deletes everybody's
 * subscriptions during one push-service outage, and they would each have to
 * re-enable by hand. */
const GONE = new Set([403, 404, 410]);

export function isGoneStatus(status: number): boolean {
  return GONE.has(status);
}

/** Sends one payload to one device, and **never throws**.
 *
 * Every failure path returns an outcome instead. This runs inside `after()`,
 * where an exception has nobody to catch it, no user to show it to, and the
 * mutation that caused it has already committed. Somebody really was assigned
 * that task; failing to buzz their phone must not become an error that anyone
 * could mistake for the assignment failing.
 *
 * The `gone` outcome is the caller's cue to delete the row — the decision is
 * made here because only here knows what the status meant, but the delete
 * happens in the fan-out, which is what holds the database handle. */
export async function sendPush(
  subscription: { endpoint: string; p256dh: string; auth: string },
  payload: PushPayload
): Promise<PushOutcome> {
  const settings = config();
  if (!settings) {
    console.info(`push: not configured (VAPID keys), skipping "${payload.tag}"`);
    return { sent: false, reason: "not-configured" };
  }

  // Configured lazily, never at module scope. Module-scope configuration is
  // the R2 trap this repo already records: any test importing the module
  // throws on import when the env vars are absent, and vitest runs with none.
  webpush.setVapidDetails(settings.subject, settings.publicKey, settings.privateKey);

  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      JSON.stringify(payload),
      {
        // Explicit, because web-push otherwise defaults to four weeks. "You
        // were mentioned" arriving three weeks late is worse than never
        // arriving at all.
        TTL: TTL_SECONDS,
        // Same value as the payload tag, so messages queued for a phone that
        // is switched off also collapse to the most recent one rather than
        // arriving as a burst when it wakes.
        headers: { Topic: payload.tag },
      }
    );
    return { sent: true };
  } catch (e) {
    const status = (e as { statusCode?: number })?.statusCode;
    if (typeof status === "number" && isGoneStatus(status)) {
      return { sent: false, reason: "gone", detail: `status ${status}` };
    }
    if (typeof status === "number") {
      return { sent: false, reason: "rejected", detail: `status ${status}` };
    }
    const detail = e instanceof Error ? e.message : String(e);
    return { sent: false, reason: "unreachable", detail };
  }
}
