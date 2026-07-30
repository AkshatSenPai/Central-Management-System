"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { setMemberActive, setMemberRole } from "@/lib/member-service";
import { ActionResult, err } from "@/lib/action-result";
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
