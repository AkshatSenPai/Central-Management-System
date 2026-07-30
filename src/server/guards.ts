import { auth } from "@/auth";
import { AuthError, assertUser, assertAdmin } from "@/lib/auth-guards";

export { AuthError };

export async function requireUser() {
  const session = await auth();
  return assertUser(session);
}

export async function requireAdmin() {
  const session = await auth();
  return assertAdmin(session);
}
