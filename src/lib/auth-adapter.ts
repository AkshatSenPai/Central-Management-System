import type { Adapter, AdapterUser } from "next-auth/adapters";
import { normalizeEmail } from "@/lib/email";

/**
 * The adapter receives the raw OAuth profile email (mixed case, stray
 * whitespace) while the app stores normalized emails.
 * `allowDangerousEmailAccountLinking` links accounts via `getUserByEmail`, so
 * a raw "Jo@Example.com" would miss the stored "jo@example.com" row and skip
 * linking. Normalize at the adapter boundary; `createUser` is wrapped too so
 * any adapter-created user stays canonical.
 */
export function withNormalizedEmail(adapter: Adapter): Adapter {
  const { getUserByEmail, createUser } = adapter;
  return {
    ...adapter,
    getUserByEmail:
      getUserByEmail && ((email: string) => getUserByEmail(normalizeEmail(email))),
    createUser:
      createUser &&
      ((user: AdapterUser) => createUser({ ...user, email: normalizeEmail(user.email) })),
  };
}
