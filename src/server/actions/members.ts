"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { resetMemberPassword, setMemberActive, setMemberRole } from "@/lib/member-service";
import { ActionResult, err, ok } from "@/lib/action-result";
import { requireAdmin, AuthError } from "@/server/guards";

export async function toggleMemberActiveAction(
  formData: FormData
): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    const result = await setMemberActive(prisma, {
      targetId: String(formData.get("userId") ?? ""),
      active: formData.get("active") === "true",
      actorId: admin.id,
    });
    revalidatePath("/settings/members");
    return result;
  } catch (e) {
    if (e instanceof AuthError) return err(e.message);
    throw e;
  }
}

export async function setMemberRoleAction(
  formData: FormData
): Promise<ActionResult> {
  try {
    await requireAdmin();
    const result = await setMemberRole(prisma, {
      targetId: String(formData.get("userId") ?? ""),
      role: formData.get("role") === "ADMIN" ? "ADMIN" : "MEMBER",
    });
    revalidatePath("/settings/members");
    return result;
  } catch (e) {
    if (e instanceof AuthError) return err(e.message);
    throw e;
  }
}

/**
 * `requireAdmin()` at the door. Unlike the role and active toggles there is
 * no member-does-it-to-themselves case to accommodate here, because that
 * path is `changePasswordAction` in `profile.ts` — which is exactly why
 * `resetMemberPassword` refuses when target and actor match rather than
 * quietly allowing an admin to skip the current-password check.
 *
 * The temporary password lives in this return value and nowhere else, so
 * the order of the last two statements matters: the result is captured
 * first, `revalidatePath` runs only on success, and the plaintext is passed
 * through untouched. Revalidating before capturing would risk a re-render
 * dropping the one copy of a password nobody can look up again.
 */
export async function resetMemberPasswordAction(
  formData: FormData
): Promise<ActionResult<{ temporaryPassword: string }>> {
  try {
    const admin = await requireAdmin();
    const result = await resetMemberPassword(prisma, {
      targetId: String(formData.get("userId") ?? ""),
      actorId: admin.id,
    });
    if (!result.ok) return result;
    revalidatePath("/settings/members");
    return ok(result.data);
  } catch (e) {
    if (e instanceof AuthError) return err(e.message);
    throw e;
  }
}
