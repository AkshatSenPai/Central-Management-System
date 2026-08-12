import { z } from "zod";
import { LONG_TEXT_MAX, LONG_TEXT_MESSAGE } from "@/lib/text-limits";
import type { BadgeKind } from "@/lib/badges";

export const CLIENT_STATUSES = ["ACTIVE", "PAUSED", "FORMER"] as const;
export type ClientStatus = (typeof CLIENT_STATUSES)[number];

export const CLIENT_STATUS_LABEL: Record<ClientStatus, string> = {
  ACTIVE: "Active",
  PAUSED: "Paused",
  FORMER: "Former",
};

export const CLIENT_STATUS_BADGE: Record<ClientStatus, BadgeKind> = {
  ACTIVE: "ok",
  PAUSED: "neutral",
  FORMER: "neutral",
};

export const clientSchema = z.object({
  name: z.string().trim().min(1, "Client name is required").max(120),
  status: z.enum(CLIENT_STATUSES),
  sector: z.string().trim().max(120).optional().or(z.literal("")),
  website: z
    .string()
    .trim()
    .url("Website must be an http(s) URL")
    .refine((v) => /^https?:\/\//i.test(v), "Website must be an http(s) URL")
    .optional()
    .or(z.literal("")),
  engagementType: z.string().trim().max(60).optional().or(z.literal("")),
  clientSince: z.string().trim().optional().or(z.literal("")),
  accountLeadId: z.string().trim().optional().or(z.literal("")),
  notes: z.string().trim().max(LONG_TEXT_MAX, LONG_TEXT_MESSAGE).optional().or(z.literal("")),
});

export type ClientInput = z.infer<typeof clientSchema>;

export const contactSchema = z.object({
  name: z.string().trim().min(1, "Contact name is required").max(120),
  email: z.string().trim().email("Enter a valid email address").optional().or(z.literal("")),
  phone: z.string().trim().max(30).optional().or(z.literal("")),
  role: z.string().trim().max(120).optional().or(z.literal("")),
});

export type ContactInput = z.infer<typeof contactSchema>;

/** First letter of the first two words, ignoring punctuation-only words like
 * the "&" in "Harlow & Fitch"; a single word falls back to its first two. */
export function clientInitials(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((w) => /[a-z0-9]/i.test(w));
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

export function clientListSummary(clients: { status: string }[]): string {
  const total = clients.length;
  const active = clients.filter((c) => c.status === "ACTIVE").length;
  return `${total} ${total === 1 ? "client" : "clients"} · ${active} active`;
}
