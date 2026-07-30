import type { PrismaClient } from "@prisma/client";
import { verifyPassword } from "@/lib/password";

export type AuthorizedUser = {
  id: string;
  email: string;
  name: string;
  role: "ADMIN" | "MEMBER";
};

export async function authorizeUser(
  db: PrismaClient,
  email: string,
  password: string
): Promise<AuthorizedUser | null> {
  const user = await db.user.findUnique({
    where: { email: email.toLowerCase().trim() },
  });
  if (!user || !user.active || !user.passwordHash) return null;
  const valid = await verifyPassword(user.passwordHash, password);
  if (!valid) return null;
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}
