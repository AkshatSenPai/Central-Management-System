import type { PrismaClient } from "@prisma/client";
import { generateInviteToken, inviteExpiry } from "@/lib/invites";
import { ActionResult, ok, err } from "@/lib/action-result";

export async function createInviteRecord(
  db: PrismaClient,
  input: { email: string; role: "ADMIN" | "MEMBER"; createdById: string }
): Promise<ActionResult<{ token: string }>> {
  const email = input.email.toLowerCase().trim();
  const existingUser = await db.user.findUnique({ where: { email } });
  if (existingUser) return err("A member with this email already exists");

  const pending = await db.invite.findFirst({
    where: { email, acceptedAt: null, expiresAt: { gt: new Date() } },
  });
  if (pending) return err("A pending invite for this email already exists");

  const token = generateInviteToken();
  await db.invite.create({
    data: {
      email,
      role: input.role,
      token,
      expiresAt: inviteExpiry(),
      createdById: input.createdById,
    },
  });
  return ok({ token });
}
