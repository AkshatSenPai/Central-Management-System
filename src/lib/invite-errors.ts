/** User-facing errors `redeemInvite` can produce. `acceptInviteAction` round-trips
 * them through the public invite page's `?error=` query param, so the page must
 * only render values from this set — anything else in the param is
 * attacker-chosen text on a public URL (a phishing surface, even React-escaped). */
export const REDEEM_ERRORS = {
  invalidLink: "Invalid invite link",
  used: "This invite has already been used",
  expired: "This invite has expired",
  nameRequired: "Name is required",
  passwordTooShort: "Password must be at least 8 characters",
  emailTaken: "A member with this email already exists",
} as const;

const KNOWN = new Set<string>(Object.values(REDEEM_ERRORS));

/** Map an untrusted `?error=` value to a renderable message, or null if unknown. */
export function knownRedeemError(error: string | undefined): string | null {
  return error !== undefined && KNOWN.has(error) ? error : null;
}
