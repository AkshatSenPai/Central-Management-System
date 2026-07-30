import { isOverdue, shortDate } from "@/lib/dates";
import type { ProgressCounts } from "@/lib/progress";

/** The three display states are always derived, never stored. `order` is
 * stored but inert in Phase 2 — nothing reorders milestones. */
export type MilestoneState = "completed" | "in_progress" | "not_started";

export type MilestoneLike = {
  order: number;
  createdAt: Date;
  dueDate: Date | null;
  completedAt: Date | null;
};

export function sortMilestones<T extends { order: number; createdAt: Date }>(ms: T[]): T[] {
  return [...ms].sort((a, b) =>
    a.order !== b.order ? a.order - b.order : a.createdAt.getTime() - b.createdAt.getTime()
  );
}

/** Sorted first, then walked: anything with a completedAt is completed; the
 * first incomplete one is in_progress; every later incomplete one is
 * not_started. A milestone finished out of order still reads completed. */
export function milestoneStates<T extends MilestoneLike>(
  ms: T[],
  now?: Date
): Array<T & { state: MilestoneState; overdue: boolean }> {
  let foundInProgress = false;
  return sortMilestones(ms).map((m) => {
    let state: MilestoneState;
    if (m.completedAt !== null) {
      state = "completed";
    } else if (!foundInProgress) {
      foundInProgress = true;
      state = "in_progress";
    } else {
      state = "not_started";
    }
    return { ...m, state, overdue: m.completedAt === null && isOverdue(m.dueDate, now) };
  });
}

export function milestoneMetaLabel(m: {
  state: MilestoneState;
  dueDate: Date | null;
  completedAt: Date | null;
}): string {
  if (m.state === "completed") {
    return m.completedAt ? `Completed ${shortDate(m.completedAt)}` : "Completed";
  }
  const label = m.state === "in_progress" ? "In progress" : "Not started";
  return m.dueDate ? `${label} · due ${shortDate(m.dueDate)}` : label;
}

export function milestoneStateDot(state: MilestoneState): "ok" | "strong" | "mute" {
  if (state === "completed") return "ok";
  if (state === "in_progress") return "strong";
  return "mute";
}

export function milestoneCounts(ms: { completedAt: Date | null }[]): ProgressCounts {
  return {
    completed: ms.filter((m) => m.completedAt !== null).length,
    total: ms.length,
  };
}

/** Server-assigned: max + 1, never a count, so deleting a middle milestone
 * cannot make the next one collide. */
export function nextMilestoneOrder(existing: { order: number }[]): number {
  if (existing.length === 0) return 0;
  return Math.max(...existing.map((m) => m.order)) + 1;
}
