/** Centralized email normalization: trim surrounding whitespace, lowercase. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
