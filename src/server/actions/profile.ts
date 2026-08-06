"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { changeOwnPassword, profileSchema } from "@/lib/profile";
import { ActionResult, ok, err } from "@/lib/action-result";
import { requireUser, AuthError } from "@/server/guards";

export async function updateProfileAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = profileSchema.safeParse({
      name: formData.get("name"),
      title: formData.get("title"),
      phone: formData.get("phone"),
      avatarUrl: formData.get("avatarUrl"),
    });
    if (!parsed.success) {
      return err(parsed.error.issues[0]?.message ?? "Invalid input");
    }
    const { name, title, phone, avatarUrl } = parsed.data;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        name,
        title: title || null,
        phone: phone || null,
        avatarUrl: avatarUrl || null,
      },
    });
    revalidatePath("/settings/profile");
    return ok(undefined);
  } catch (e) {
    if (e instanceof AuthError) return err(e.message);
    throw e;
  }
}

/**
 * `requireUser()` supplies the id, and the form carries no user id at all —
 * so this action has no target to tamper with. That is the same property
 * `changeOwnPassword`'s signature enforces, stated once more at the door
 * where the untrusted `FormData` actually arrives.
 *
 * Nothing is revalidated. A password change alters no rendered data, and
 * re-rendering `/settings/profile` would only discard the success message
 * this returns.
 */
export async function changePasswordAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const user = await requireUser();
    return await changeOwnPassword(prisma, {
      userId: user.id,
      current: String(formData.get("currentPassword") ?? ""),
      next: String(formData.get("newPassword") ?? ""),
      confirm: String(formData.get("confirmPassword") ?? ""),
    });
  } catch (e) {
    if (e instanceof AuthError) return err(e.message);
    throw e;
  }
}
