import { z } from "zod";
import type { BadgeKind } from "@/lib/badges";

/** Pure feedback rules — no Prisma, no session, so they unit-test without a
 * database. Same split as `announcement.ts`, which this feature is the mirror
 * image of: admin-to-team broadcast there, team-to-admin queue here. */

export const FEEDBACK_KINDS = ["SUGGESTION", "PROBLEM", "PRAISE"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

export const FEEDBACK_KIND_LABEL: Record<FeedbackKind, string> = {
  SUGGESTION: "Suggestion",
  PROBLEM: "Problem",
  PRAISE: "Praise",
};

export const FEEDBACK_KIND_BADGE: Record<FeedbackKind, BadgeKind> = {
  SUGGESTION: "neutral",
  PROBLEM: "bad",
  PRAISE: "ok",
};

export const FEEDBACK_STATUSES = ["NEW", "ACKNOWLEDGED", "PLANNED", "DONE", "DECLINED"] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export const FEEDBACK_STATUS_LABEL: Record<FeedbackStatus, string> = {
  NEW: "New",
  ACKNOWLEDGED: "Acknowledged",
  PLANNED: "Planned",
  DONE: "Done",
  DECLINED: "Declined",
};

export const FEEDBACK_STATUS_BADGE: Record<FeedbackStatus, BadgeKind> = {
  NEW: "strong",
  ACKNOWLEDGED: "neutral",
  PLANNED: "warn",
  DONE: "ok",
  DECLINED: "neutral",
};

/** Still owed an answer. DECLINED counts as closed: it is a decision, and the
 * whole reason that status exists is so disagreeing with a suggestion does not
 * mean leaving it NEW forever. */
export function isFeedbackOpen(status: FeedbackStatus): boolean {
  return status === "NEW" || status === "ACKNOWLEDGED" || status === "PLANNED";
}

export const feedbackSchema = z.object({
  kind: z.enum(FEEDBACK_KINDS),
  body: z
    .string()
    .trim()
    .min(1, "Write something first")
    .max(4000, "Keep it under 4000 characters"),
});

export type FeedbackInput = z.infer<typeof feedbackSchema>;

/** Untriaged first, then progressively more settled, newest first inside each
 * band. The point is that NEW is impossible to miss: an admin opening this
 * page should see everything nobody has answered yet without scrolling or
 * filtering, because a queue that hides its backlog is how a feedback box
 * becomes a graveyard. */
const STATUS_RANK: Record<FeedbackStatus, number> = {
  NEW: 0,
  ACKNOWLEDGED: 1,
  PLANNED: 2,
  DONE: 3,
  DECLINED: 4,
};

export type FeedbackSortable = { status: FeedbackStatus; createdAt: Date };

export function compareFeedback(a: FeedbackSortable, b: FeedbackSortable): number {
  const rank = STATUS_RANK[a.status] - STATUS_RANK[b.status];
  if (rank !== 0) return rank;
  return b.createdAt.getTime() - a.createdAt.getTime();
}

export function sortFeedback<T extends FeedbackSortable>(rows: T[]): T[] {
  return [...rows].sort(compareFeedback);
}

/** `null` means the default view, matching `parseTaskStatusFilter`'s contract
 * so the two filters behave identically. "ALL" is the explicit escape hatch. */
export type FeedbackStatusFilter = FeedbackStatus | "ALL";

export function parseFeedbackStatusFilter(
  raw: string | string[] | undefined
): FeedbackStatusFilter | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;
  if (value === "ALL") return "ALL";
  return (FEEDBACK_STATUSES as readonly string[]).includes(value)
    ? (value as FeedbackStatus)
    : null;
}

export function parseFeedbackKind(raw: string | undefined | null): FeedbackKind | null {
  if (!raw) return null;
  return (FEEDBACK_KINDS as readonly string[]).includes(raw) ? (raw as FeedbackKind) : null;
}

/** "7 items · 3 open", or the empty-state sentence. */
export function feedbackSummary(total: number, open: number): string {
  if (total === 0) return "Nothing submitted yet";
  const word = total === 1 ? "item" : "items";
  return open > 0 ? `${total} ${word} · ${open} open` : `${total} ${word}`;
}
