"use server";

/**
 * Revalidation map — keep in sync with the calls below.
 *
 * | Mutation       | revalidatePath calls                        |
 * |----------------|---------------------------------------------|
 * | punchInAction  | `/` at layout scope, `/team`, `/dashboard`  |
 * | punchOutAction | the same set                                |
 *
 * **Layout scope is not optional here.** The punch control lives in the
 * topbar, which is rendered by the app layout — and a page-scoped
 * `revalidatePath` does not re-render a layout, so the button would keep
 * saying "Punch in" after a successful punch. It also clears the client router
 * cache, which is what stops a prefetched `/team` payload showing a stale dot.
 * Same reasoning as `announcements.ts`.
 *
 * Both are `requireUser` and take no arguments at all: each acts on the
 * caller's own session, and the service scopes its `where` to the actor. There
 * is deliberately no way to express "punch out Dana".
 */

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { err, type ActionResult } from "@/lib/action-result";
import { requireUser, AuthError } from "@/server/guards";
import { punchIn, punchOut } from "@/lib/attendance-service";

function revalidate() {
  revalidatePath("/", "layout");
  revalidatePath("/team");
  revalidatePath("/dashboard");
}

export async function punchInAction(): Promise<ActionResult<{ startedAt: Date }>> {
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
