"use server";

/**
 * Revalidation map — keep in sync with the calls below.
 *
 * | Mutation                  | revalidatePath calls |
 * |---------------------------|----------------------|
 * | addFeedbackAction         | `/feedback`          |
 * | setFeedbackStatusAction   | `/feedback`          |
 * | removeFeedbackAction      | `/feedback`          |
 *
 * One path only, unlike announcements. Feedback appears on no dashboard tile
 * and writes nothing to the notification bell, so there is no layout-scoped
 * badge to refresh — see the note on `addFeedback` for why the bell is
 * deliberately left out of this feature.
 *
 * All three are `requireUser`: any member may submit, and any member may
 * delete their own. Admin-only triage is enforced inside `setFeedbackStatus`
 * rather than at the door, so the rule lives with the data it protects and
 * cannot be bypassed by a second call site.
 */

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { err, type ActionResult } from "@/lib/action-result";
import { requireUser, AuthError } from "@/server/guards";
import { addFeedback, setFeedbackStatus, removeFeedback } from "@/lib/feedback-service";
import { parseFeedbackStatusFilter } from "@/lib/feedback";

function revalidate() {
  revalidatePath("/feedback");
}

export async function addFeedbackAction(
  _prev: ActionResult<{ id: string }> | null,
  formData: FormData
): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireUser();
    const result = await addFeedback(prisma, {
      kind: String(formData.get("kind") ?? ""),
      body: String(formData.get("body") ?? ""),
      actorId: user.id,
    });
    revalidate();
    return result;
  } catch (e) {
    if (e instanceof AuthError) return err(e.message);
    throw e;
  }
}

export async function setFeedbackStatusAction(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireUser();
    // Parsed against the enum rather than cast. FormData is a string from the
    // client, and writing an unvalidated one straight into an enum column
    // fails at the database with an opaque error instead of a sentence.
    const status = parseFeedbackStatusFilter(String(formData.get("status") ?? ""));
    if (!status || status === "ALL") return err("Pick a status");

    const result = await setFeedbackStatus(prisma, {
      feedbackId: String(formData.get("feedbackId") ?? ""),
      status,
      actorId: user.id,
      isAdmin: user.role === "ADMIN",
    });
    revalidate();
    return result;
  } catch (e) {
    if (e instanceof AuthError) return err(e.message);
    throw e;
  }
}

export async function removeFeedbackAction(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const result = await removeFeedback(prisma, {
      feedbackId: String(formData.get("feedbackId") ?? ""),
      actorId: user.id,
      isAdmin: user.role === "ADMIN",
    });
    revalidate();
    return result;
  } catch (e) {
    if (e instanceof AuthError) return err(e.message);
    throw e;
  }
}
