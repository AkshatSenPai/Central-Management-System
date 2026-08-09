import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { ActionResult, ok, err } from "@/lib/action-result";

/** Storing and removing the routes push is delivered over.
 *
 * Narrow db type, the same shape `NotificationDb` uses: these functions touch
 * exactly one delegate, and saying so stops them quietly growing a second
 * responsibility. */
export type PushSubscriptionDb = Pick<PrismaClient, "pushSubscription">;

/** The stored unique key. `node:crypto` directly, as `invites.ts` and
 * `password.ts` already do — no wrapper earns its keep for one call. */
export function hashEndpoint(endpoint: string): string {
  return createHash("sha256").update(endpoint).digest("hex");
}

/** A user-agent is a header, so it is attacker-controlled and unbounded.
 * Clamped because it is only ever a label on a device list — nothing parses
 * it, and a megabyte of it in the database serves nobody. */
const MAX_USER_AGENT = 255;

/** Stores a browser's subscription, or moves it.
 *
 * **The upsert is on `endpointHash` alone, and `userId` is part of the update
 * rather than the key.** That is the whole security property of this function.
 * A browser profile holds exactly one push subscription, so when a second
 * person signs in on a shared laptop, their `subscribe()` hands back the same
 * endpoint the first person is already stored under. Keying on
 * `(userId, endpointHash)` would insert a *second* row and leave the first
 * intact — and every mention meant for the new person would then also be
 * delivered to a device the previous person still has. Keying on the endpoint
 * alone moves the row: the device belongs to whoever subscribed last, which is
 * the only reading that is ever true.
 *
 * Both keys are required. A row missing either can never encrypt a payload, so
 * it would be a route that silently cannot deliver — worse than no row, since
 * the person would see the toggle on. */
export async function savePushSubscription(
  db: PushSubscriptionDb,
  input: {
    userId: string;
    endpoint: string;
    p256dh: string;
    auth: string;
    userAgent?: string | null;
  }
): Promise<ActionResult<{ id: string }>> {
  const endpoint = input.endpoint.trim();
  const p256dh = input.p256dh.trim();
  const auth = input.auth.trim();

  if (!endpoint || !p256dh || !auth) {
    return err("That subscription is incomplete — try turning notifications off and on again.");
  }

  const endpointHash = hashEndpoint(endpoint);
  const userAgent = input.userAgent?.slice(0, MAX_USER_AGENT) ?? null;

  const row = await db.pushSubscription.upsert({
    where: { endpointHash },
    create: { userId: input.userId, endpoint, endpointHash, p256dh, auth, userAgent },
    // `userId` is updated deliberately — see the note above. The keys are
    // refreshed too: a browser may re-issue them for the same endpoint, and a
    // stale pair encrypts to something the device cannot open.
    update: { userId: input.userId, endpoint, p256dh, auth, userAgent },
    select: { id: true },
  });

  return ok({ id: row.id });
}

/** Removes one device's subscription, scoped to its owner.
 *
 * The `userId` in the where clause **is** the authorisation check, the same
 * shape the notification actions use: there is no separate "is this yours"
 * read that could pass while the delete targets something else. A miss deletes
 * nothing and reports success, because the caller's intent — "this device
 * should not receive pushes" — is satisfied either way. */
export async function deletePushSubscription(
  db: PushSubscriptionDb,
  input: { userId: string; endpoint: string }
): Promise<ActionResult> {
  await db.pushSubscription.deleteMany({
    where: { endpointHash: hashEndpoint(input.endpoint), userId: input.userId },
  });
  return ok(undefined);
}

/** Deletes a row the push service has told us is dead. Called from the
 * fan-out, by id, on a row already in hand — never by endpoint, and never
 * scoped to a user, because at that point the row's own identity is the only
 * thing that matters. */
export async function deleteDeadSubscription(
  db: PushSubscriptionDb,
  id: string
): Promise<void> {
  // deleteMany rather than delete: a concurrent unsubscribe may have removed
  // it already, and P2025 inside `after()` is an unhandled rejection nobody
  // catches.
  await db.pushSubscription.deleteMany({ where: { id } });
}
