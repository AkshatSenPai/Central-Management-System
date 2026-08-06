import { randomBytes } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";

export function hashPassword(plain: string): Promise<string> {
  return hash(plain);
}

export async function verifyPassword(passwordHash: string, plain: string): Promise<boolean> {
  try {
    return await verify(passwordHash, plain);
  } catch {
    return false;
  }
}

/** `redeemInvite` (`invite-service.ts`) already enforces 8 when an account is
 * created. Exported so every path that sets a password reads the same
 * number: a password accepted here that signup would have rejected is a rule
 * disagreeing with itself, and the disagreement would only ever be noticed
 * by the person it locked out. */
export const MIN_PASSWORD_LENGTH = 8;

/** No `0`/`O`, no `1`/`l`/`I`. A temporary password is read aloud on a call
 * or typed on a phone keyboard, and those are exactly the characters that
 * turn a working password into a support conversation. */
const SAFE_ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const TEMPORARY_PASSWORD_LENGTH = 12;

/** Every rule about what a new password may be, in one place, so the
 * self-service change and the admin reset cannot drift apart.
 *
 * Returns an error message or `null` — the same `string | null` contract
 * `validateUpload` (`attachment.ts`) uses, so a caller writes
 * `if (error) return err(error)` and nothing else.
 *
 * `current` is optional on purpose. The admin-reset path has no current
 * password to compare against; it is minting one for somebody else. Passing
 * it enables the identical-to-current check and nothing more.
 *
 * Length is checked before the confirmation match, deliberately: someone who
 * typed a too-short password into both boxes has one problem, and being told
 * about the mismatch first would send them to fix the wrong thing. */
export function validatePasswordChange(input: {
  next: string;
  confirm: string;
  current?: string;
}): string | null {
  if (input.next.length < MIN_PASSWORD_LENGTH) {
    return `New password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (input.next !== input.confirm) return "New password and confirmation do not match";
  if (input.current !== undefined && input.next === input.current) {
    return "New password must be different from the current one";
  }
  return null;
}

/** `randomBytes`, never `Math.random` — this value is a credential, and
 * `Math.random` is seeded predictably enough that two resets in the same
 * process could be derivable from one another.
 *
 * The modulo bias across a 55-character alphabet is negligible at this
 * length, and the password is meant to live for minutes: rejection sampling
 * would be ceremony against a threat that does not exist here. */
export function generateTemporaryPassword(): string {
  const bytes = randomBytes(TEMPORARY_PASSWORD_LENGTH);
  let out = "";
  for (let i = 0; i < TEMPORARY_PASSWORD_LENGTH; i++) {
    out += SAFE_ALPHABET[bytes[i] % SAFE_ALPHABET.length];
  }
  return out;
}
