import { auth } from "@/auth";

export class AuthError extends Error {}

export async function requireUser() {
  const session = await auth();
  if (!session?.user?.id) throw new AuthError("Not signed in");
  return session.user;
}

export async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== "ADMIN") throw new AuthError("Admin access required");
  return user;
}
