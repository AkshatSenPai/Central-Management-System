"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { createInviteRecord } from "@/lib/invite-service";
import { inviteLinkBase, INVITE_TTL_DAYS } from "@/lib/invites";
import { sendEmail } from "@/lib/email-sender";
import { inviteEmail } from "@/lib/email-templates";
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
    const inviteUrl = `${base}/invite/${result.data.token}`;

    // The email goes out through `after()`, which is the whole seam: it runs
    // once the response has been sent, so the admin is not left watching a
    // spinner while Resend answers, and — the load-bearing part — it is
    // necessarily *after* createInviteRecord's transaction committed. Sending
    // from inside a service would put a network call in a transaction, and an
    // email about an invite that then rolled back cannot be recalled.
    //
    // `sendEmail` never throws and no-ops without the two env vars, so an
    // unconfigured or failing mailer cannot turn a successful invite into an
    // error. The link is returned and shown on screen either way, which is
    // exactly how invites worked before this existed — the email is an
    // upgrade to that fallback, not a replacement for it.
    after(async () => {
      // The inviter's name is looked up here rather than before the return,
      // because `GuardedUser` carries only an id and a role — and doing it
      // inside `after()` means the query lands after the response, so it costs
      // the admin's request nothing.
      const inviter = await prisma.user.findUnique({
        where: { id: admin.id },
        select: { name: true },
      });
      await sendEmail({
        to: email,
        ...inviteEmail({
          inviteUrl,
          inviterName: inviter?.name ?? "A colleague",
          expiresInDays: INVITE_TTL_DAYS,
        }),
      });
    });

    return ok({ inviteUrl });
  } catch (e) {
    if (e instanceof AuthError) return err(e.message);
    throw e;
  }
}
