"use server";

/**
 * Revalidation map — keep in sync with the calls below.
 *
 * | Mutation                | revalidatePath calls                        |
 * |-------------------------|---------------------------------------------|
 * | punchInAction           | `/` at layout scope, `/team`, `/dashboard`  |
 * | punchOutAction          | the same set                                |
 * | correctSessionAction    | the same set                                |
 * | discardSessionAction    | the same set                                |
 *
 * **Layout scope is not optional here.** The punch control lives in the
 * topbar, which is rendered by the app layout — and a page-scoped
 * `revalidatePath` does not re-render a layout, so the button would keep
 * saying "Punch in" after a successful punch. It also clears the client router
 * cache, which is what stops a prefetched `/team` payload showing a stale dot.
 * Same reasoning as `announcements.ts`.
 *
 * All four are `requireUser` and take no member id: every one of them acts on
 * the caller's own session, and the service scopes each `where` to the actor.
 * There is deliberately no way to express "punch out Dana".
 */

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { err, type ActionResult } from "@/lib/action-result";
import { requireUser, AuthError } from "@/server/guards";
import {
  punchIn,
  punchOut,
  correctSession,
  discardSession,
} from "@/lib/attendance-service";

function revalidate() {
  revalidatePath("/", "layout");
  revalidatePath("/team");
  revalidatePath("/dashboard");
}

export async function punchInAction(): Promise<
  ActionResult<{ startedAt: Date } | { needsResolution: { id: string; startedAt: Date } }>
> {
  try {
    const user = await requireUser();
    const result = await punchIn(prisma, { actorId: user.id });
    revalidate();
    return result;
  } catch (e) {
    if (e instanceof AuthError) return err(e.message);
    throw e;
  }
}

export async function punchOutAction(): Promise<ActionResult<{ wasAlreadyClosed: boolean }>> {
  try {
    const user = await requireUser();
    const result = await punchOut(prisma, { actorId: user.id });
    revalidate();
    return result;
  } catch (e) {
    if (e instanceof AuthError) return err(e.message);
    throw e;
  }
}

export async function correctSessionAction(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const result = await correctSession(prisma, {
      sessionId: String(formData.get("sessionId") ?? ""),
      // Two separate inputs, combined by `appDateTime` so "23:40" means 23:40
      // in the office regardless of the corrector's device timezone.
      date: String(formData.get("date") ?? ""),
      time: String(formData.get("time") ?? ""),
      actorId: user.id,
    });
    revalidate();
    return result;
  } catch (e) {
    if (e instanceof AuthError) return err(e.message);
    throw e;
  }
}

export async function discardSessionAction(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const result = await discardSession(prisma, {
      sessionId: String(formData.get("sessionId") ?? ""),
      actorId: user.id,
    });
    revalidate();
    return result;
  } catch (e) {
    if (e instanceof AuthError) return err(e.message);
    throw e;
  }
}
