import type { PrismaClient } from "@prisma/client";
import type { JWT } from "next-auth/jwt";

/**
 * Re-verifies a JWT's role/active status against the DB. Called from
 * `src/auth.ts`'s `jwt` callback on every invocation (not just first
 * sign-in) so that revocation (deactivation, demotion, promotion) takes
 * effect on the next request instead of lagging up to the session's 7-day
 * maxAge.
 *
 * - Token without an `id` (shouldn't normally happen, but keeps this safe
 *   to call unconditionally): passed through unchanged.
 * - No matching user, or user is inactive: returns `null`, which next-auth
 *   treats as "invalidate this session" (see `callbacks.jwt`'s
 *   `Awaitable<JWT | null>` signature in
 *   `node_modules/@auth/core/index.d.ts`, and the null-handling branch in
 *   `node_modules/@auth/core/lib/actions/session.js`).
 * - Active user: returns the token with `role` refreshed from the DB.
 */
export async function refreshTokenFromDb(
  db: PrismaClient,
  token: JWT
): Promise<JWT | null> {
  if (!token.id) return token;

  const user = await db.user.findUnique({
    where: { id: token.id },
    select: { role: true, active: true },
  });
  if (!user || !user.active) return null;

  return { ...token, role: user.role };
}
