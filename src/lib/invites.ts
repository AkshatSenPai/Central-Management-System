import { randomBytes } from "crypto";

export const INVITE_TTL_DAYS = 7;

export function generateInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

export type InviteStatus = "valid" | "expired" | "used";

export function inviteStatus(
  invite: { expiresAt: Date; acceptedAt: Date | null },
  now: Date = new Date()
): InviteStatus {
  if (invite.acceptedAt) return "used";
  if (invite.expiresAt.getTime() <= now.getTime()) return "expired";
  return "valid";
}

export function inviteExpiry(from: Date = new Date()): Date {
  return new Date(from.getTime() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
}
