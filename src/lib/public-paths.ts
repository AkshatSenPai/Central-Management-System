// Edge-safe: no imports beyond plain TS. Used by `src/auth.config.ts`'s
// `authorized()` callback, which must stay Prisma/argon2-free for the edge
// runtime — see AGENTS.md and the callers of this module.

const INVITE_PATH = /^\/invite\/[^/]+$/;

/**
 * Exact-match public-route check. Only `/login` and `/invite/<token>`
 * (a single path segment) are public; everything else — including anything
 * that merely starts with those strings, like `/login-help` or
 * `/invited-users` — is protected.
 */
export function isPublicPath(pathname: string): boolean {
  if (pathname === "/login") return true;
  return INVITE_PATH.test(pathname);
}
