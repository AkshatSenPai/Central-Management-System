"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { redeemInvite } from "@/lib/invite-service";

export async function acceptInviteAction(token: string, formData: FormData) {
  const result = await redeemInvite(prisma, {
    token,
    name: String(formData.get("name") ?? ""),
    password: String(formData.get("password") ?? ""),
  });
  if (!result.ok) {
    redirect(`/invite/${token}?error=${encodeURIComponent(result.error)}`);
  }
  redirect("/login?welcome=1");
}
