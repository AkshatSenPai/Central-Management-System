"use server";

/**
 * Revalidation map — keep in sync with the calls below.
 *
 * | Mutation                  | revalidatePath calls |
 * |---------------------------|----------------------|
 * | subscribeToPushAction     | none                 |
 * | unsubscribeFromPushAction | none                 |
 *
 * "None" is deliberate rather than an omission, which is why the table is here
 * at all. Nothing server-rendered displays a subscription: the settings toggle
 * reads `Notification.permission` and `getSubscription()` from the browser,
 * because those are the only sources that can be right. A toggle rendered from
 * the database would show "on" for somebody who revoked permission in their
 * browser settings — exactly the case that most needs surfacing.
 *
 * Both are `requireUser`, and neither takes a user id: each acts on the
 * caller's own devices, and the service scopes every `where` to the actor.
 */

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { err, type ActionResult } from "@/lib/action-result";
import { requireUser, AuthError } from "@/server/guards";
import { deletePushSubscription, savePushSubscription } from "@/lib/push-subscription-service";

/** Parsed at the boundary rather than trusted. These three strings come from
 * the browser and go straight into an outbound crypto operation, so a
 * malformed one fails deep inside the push library with an opaque message
 * rather than here with a sentence. */
const subscriptionSchema = z.object({
  endpoint: z.string().trim().url().max(2000),
  p256dh: z.string().trim().min(1).max(500),
  auth: z.string().trim().min(1).max(500),
  userAgent: z.string().trim().max(500).optional(),
});

export async function subscribeToPushAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireUser();
    const parsed = subscriptionSchema.safeParse(input);
    if (!parsed.success) {
      return err("That subscription looked wrong — try turning notifications off and on again.");
    }
    return await savePushSubscription(prisma, { userId: user.id, ...parsed.data });
  } catch (e) {
    if (e instanceof AuthError) return err(e.message);
    throw e;
  }
}

export async function unsubscribeFromPushAction(endpoint: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = z.string().trim().url().max(2000).safeParse(endpoint);
    // Nothing to remove and nothing to report: the caller's intent — this
    // device should stop receiving pushes — is already satisfied.
    if (!parsed.success) return { ok: true, data: undefined };
    return await deletePushSubscription(prisma, { userId: user.id, endpoint: parsed.data });
  } catch (e) {
    if (e instanceof AuthError) return err(e.message);
    throw e;
  }
}
