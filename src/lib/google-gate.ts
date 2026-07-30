import type { PrismaClient } from "@prisma/client";
import { normalizeEmail } from "@/lib/email";

/**
 * Invite-only gate for Google sign-in: only an email that already belongs
 * to an existing, active member may sign in with Google. Extracted from
 * `src/auth.ts`'s `signIn` callback so it can be unit-tested without a real
 * NextAuth/Prisma runtime.
 */
export async function googleSignInAllowed(
  db: PrismaClient,
  email: string | null | undefined
): Promise<boolean> {
  if (!email) return false;
  const existing = await db.user.findUnique({
    where: { email: normalizeEmail(email) },
  });
  return !!existing && existing.active;
}
