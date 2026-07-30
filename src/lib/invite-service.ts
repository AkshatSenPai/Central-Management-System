import { Prisma, type PrismaClient } from "@prisma/client";
import { generateInviteToken, inviteExpiry, inviteStatus } from "@/lib/invites";
import { ActionResult, ok, err } from "@/lib/action-result";
import { hashPassword } from "@/lib/password";

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

export async function redeemInvite(
  db: PrismaClient,
  input: { token: string; name: string; password: string }
): Promise<ActionResult> {
  const invite = await db.invite.findUnique({ where: { token: input.token } });
  if (!invite) return err("Invalid invite link");

  const status = inviteStatus(invite);
  if (status === "used") return err("This invite has already been used");
  if (status === "expired") return err("This invite has expired");

  const name = input.name.trim();
  if (!name) return err("Name is required");
  if (input.password.length < 8) return err("Password must be at least 8 characters");

  const existing = await db.user.findUnique({ where: { email: invite.email } });
  if (existing) return err("A member with this email already exists");

  const passwordHash = await hashPassword(input.password);
  try {
    await db.$transaction([
      db.user.create({
        data: { email: invite.email, name, passwordHash, role: invite.role },
      }),
      db.invite.update({
        where: { id: invite.id },
        data: { acceptedAt: new Date() },
      }),
    ]);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return err("A member with this email already exists");
    }
    throw e;
  }
  return ok(undefined);
}
