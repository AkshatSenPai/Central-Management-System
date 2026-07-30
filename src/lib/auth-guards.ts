// Pure, dependency-free auth assertions. Deliberately does NOT import
// `@/auth` (or anything from `next-auth`'s Node runtime helpers) so it can
// be unit-tested directly — `src/auth.ts`'s `NextAuth(...)` call pulls in
// `next/headers`/`next/server`, which aren't resolvable outside a real
// Next.js runtime (e.g. under Vitest). `src/server/guards.ts` wraps these
// with the real `auth()` call for actual request handling.

export class AuthError extends Error {}

export type SessionLike =
  | { user?: { id?: string; role?: "ADMIN" | "MEMBER" } }
  | null
  | undefined;

export type GuardedUser = { id: string; role?: "ADMIN" | "MEMBER" };

export function assertUser(session: SessionLike): GuardedUser {
  if (!session?.user?.id) throw new AuthError("Not signed in");
  return session.user as GuardedUser;
}

export function assertAdmin(session: SessionLike): GuardedUser {
  const user = assertUser(session);
  if (user.role !== "ADMIN") throw new AuthError("Admin access required");
  return user;
}
