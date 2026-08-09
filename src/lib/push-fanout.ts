import type { PrismaClient } from "@prisma/client";
import { buildPushPayload } from "@/lib/push-payload";
import { isPushConfigured, sendPush } from "@/lib/push-sender";
import { deleteDeadSubscription } from "@/lib/push-subscription-service";

/** Turns notification ids into pushes on people's devices.
 *
 * **This is what `after()` calls, and it is the only caller of `sendPush`.**
 * It runs after the response has been sent and after the transaction that
 * wrote those notifications has committed, which is the entire reason the seam
 * exists — see the header of `push-sender.ts`.
 *
 * It takes ids rather than recipients on purpose: re-reading the rows means the
 * sentence on the phone is built from the same record the bell renders, so the
 * two can never drift, and it means this function never computes a recipient
 * set. The actor-drop and dedupe rules stay stated once, in `notify()`.
 *
 * **Nothing in here may throw.** Every path is caught. An exception after the
 * response is an unhandled rejection with nobody to catch it and no user to
 * show it to — and the mutation it followed has already committed. That
 * includes the database calls: a suspended Neon answering P1001 mid-fan-out
 * must not become a crash.
 */
export async function pushForNotifications(
  db: PrismaClient,
  notificationIds: readonly string[]
): Promise<void> {
  try {
    if (notificationIds.length === 0) return;
    // Checked before any query. With no VAPID keys there is nothing to do, and
    // reading rows to build payloads nobody can send is pure waste.
    if (!isPushConfigured()) return;

    const rows = await db.notification.findMany({
      where: { id: { in: [...notificationIds] } },
      select: {
        recipientId: true,
        type: true,
        entityType: true,
        entityId: true,
        meta: true,
        actor: { select: { name: true } },
      },
    });
    if (rows.length === 0) return;

    // One query for every device belonging to any recipient, rather than one
    // per person: a mention of six people is six recipients and possibly
    // fifteen devices, and this is running on a serverless invocation whose
    // clock is still ticking.
    const recipientIds = [...new Set(rows.map((r) => r.recipientId))];
    const subscriptions = await db.pushSubscription.findMany({
      where: { userId: { in: recipientIds } },
      select: { id: true, userId: true, endpoint: true, p256dh: true, auth: true },
    });
    if (subscriptions.length === 0) return;

    const byUser = new Map<string, typeof subscriptions>();
    for (const sub of subscriptions) {
      byUser.set(sub.userId, [...(byUser.get(sub.userId) ?? []), sub]);
    }

    // Every notification to every one of that person's devices. Somebody with
    // a laptop and a phone gets it on both, which is the point of a device
    // list rather than a per-person flag.
    const sends = rows.flatMap((row) => {
      const payload = buildPushPayload({
        type: row.type,
        entityType: row.entityType,
        entityId: row.entityId,
        actorName: row.actor?.name ?? null,
        meta: (row.meta ?? null) as Record<string, unknown> | null,
      });
      return (byUser.get(row.recipientId) ?? []).map((sub) => ({ sub, payload }));
    });

    // allSettled, not all: one dead device must not abandon the rest, and
    // there is no meaningful aggregate failure here — each send stands alone.
    const results = await Promise.allSettled(
      sends.map(async ({ sub, payload }) => {
        const outcome = await sendPush(sub, payload);
        // Deleted per-endpoint as each result settles rather than batched at
        // the end, so an invocation killed by a timeout still banks the
        // deletions it has already earned.
        if (!outcome.sent && outcome.reason === "gone") {
          await deleteDeadSubscription(db, sub.id);
          return "gone" as const;
        }
        return outcome.sent ? ("sent" as const) : ("failed" as const);
      })
    );

    // One aggregated line, never one per recipient. A six-person mention
    // failing would otherwise write six near-identical errors and bury
    // anything else in the log.
    const tally = { sent: 0, gone: 0, failed: 0 };
    for (const result of results) {
      if (result.status === "rejected") tally.failed++;
      else tally[result.value]++;
    }
    if (tally.gone > 0 || tally.failed > 0) {
      console.info(`push: ${tally.sent} sent, ${tally.gone} gone, ${tally.failed} failed`);
    }
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error(`push: fan-out failed — ${detail}`);
  }
}
