"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { createInviteRecord } from "@/lib/invite-service";
import { inviteLinkBase } from "@/lib/invites";
import { ActionResult, ok, err } from "@/lib/action-result";
import { requireAdmin, AuthError } from "@/server/guards";

export async function createInviteAction(
  _prev: ActionResult<{ inviteUrl: string }> | null,
  formData: FormData
): Promise<ActionResult<{ inviteUrl: string }>> {
  try {
    const admin = await requireAdmin();
    const email = String(formData.get("email") ?? "").trim();
    const role = formData.get("role") === "ADMIN" ? "ADMIN" : "MEMBER";
    if (!email) return err("Email is required");

    const base = inviteLinkBase({
      appUrl: process.env.NEXT_PUBLIC_APP_URL,
      nodeEnv: process.env.NODE_ENV,
    });
    if (!base) {
      console.error("createInviteAction: NEXT_PUBLIC_APP_URL is not set in production");
      return err("The server is missing NEXT_PUBLIC_APP_URL — invite links can't be generated.");
    }

    const result = await createInviteRecord(prisma, {
      email,
      role,
      createdById: admin.id,
    });
    if (!result.ok) return result as ActionResult<{ inviteUrl: string }>;

    revalidatePath("/settings/members");
    return ok({ inviteUrl: `${base}/invite/${result.data.token}` });
  } catch (e) {
    if (e instanceof AuthError) return err(e.message);
    throw e;
  }
}
