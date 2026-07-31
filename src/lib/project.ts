import { z } from "zod";
import type { BadgeKind } from "@/lib/badges";
import { shortDate } from "@/lib/dates";

export const PROJECT_STATUSES = ["PLANNING", "IN_PROGRESS", "ON_HOLD", "DONE"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  PLANNING: "Planning",
  IN_PROGRESS: "In Progress",
  ON_HOLD: "On Hold",
  DONE: "Done",
};

export const PROJECT_HEALTHS = ["ON_TRACK", "AT_RISK", "BLOCKED"] as const;
export type ProjectHealth = (typeof PROJECT_HEALTHS)[number];

export const PROJECT_HEALTH_LABEL: Record<ProjectHealth, string> = {
  ON_TRACK: "On Track",
  AT_RISK: "At Risk",
  BLOCKED: "Blocked",
};

/** The badge carries health; the progress bar never does. */
export const PROJECT_HEALTH_BADGE: Record<ProjectHealth, BadgeKind> = {
  ON_TRACK: "ok",
  AT_RISK: "warn",
  BLOCKED: "bad",
};

export const projectSchema = z
  .object({
    name: z.string().trim().min(1, "Project name is required").max(120),
    description: z.string().trim().max(4000).optional().or(z.literal("")),
    status: z.enum(PROJECT_STATUSES),
    health: z.enum(PROJECT_HEALTHS),
    startDate: z.string().trim().optional().or(z.literal("")),
    dueDate: z.string().trim().optional().or(z.literal("")),
  })
  // Both values are "YYYY-MM-DD", so a string compare is a date compare.
  .refine((v) => !v.startDate || !v.dueDate || v.dueDate >= v.startDate, {
    error: "Due date cannot be before the start date",
    path: ["dueDate"],
  });

export type ProjectInput = z.infer<typeof projectSchema>;

export const milestoneSchema = z.object({
  title: z.string().trim().min(1, "Milestone title is required").max(200),
  dueDate: z.string().trim().optional().or(z.literal("")),
});

export type MilestoneInput = z.infer<typeof milestoneSchema>;

export function isProjectActive(status: ProjectStatus): boolean {
  return status !== "DONE";
}

const PROJECT_COLORS = 6;

/** Deterministic id -> swatch, so a project keeps its colour across renders,
 * sessions and machines. No randomness, no clock. */
export function projectColorIndex(projectId: string): 1 | 2 | 3 | 4 | 5 | 6 {
  let sum = 0;
  for (let i = 0; i < projectId.length; i++) {
    sum += projectId.charCodeAt(i);
  }
  return ((sum % PROJECT_COLORS) + 1) as 1 | 2 | 3 | 4 | 5 | 6;
}

export function projectListSummary(rows: { status: string; clientId: string }[]): string {
  if (rows.length === 0) return "No projects yet";
  const active = rows.filter((r) => r.status !== "DONE");
  const clients = new Set(active.map((r) => r.clientId)).size;
  const projectWord = active.length === 1 ? "project" : "projects";
  const clientWord = clients === 1 ? "client" : "clients";
  return `${active.length} active ${projectWord} across ${clients} ${clientWord}`;
}

/** The filtered-view counterpart to `projectListSummary`. Once a status
 * filter is on, the "N active projects across M clients" phrasing would lie —
 * a Done-only view is not "0 active projects" — so the header falls back to a
 * bare count. Extracted rather than inlined at the call site so the
 * pluralisation is tested in one place, the way every other summary string
 * in this module is. */
export function projectCountLabel(count: number): string {
  return `${count} ${count === 1 ? "project" : "projects"}`;
}

/** In Phase 2 the trackable unit is the milestone, so the row says
 * "milestones" — the basis change is visible in the release that makes it. */
export function projectRowSubtitle(input: { milestoneCount: number; dueDate: Date | null }): string {
  const count =
    input.milestoneCount === 0
      ? "No milestones"
      : `${input.milestoneCount} ${input.milestoneCount === 1 ? "milestone" : "milestones"}`;
  return input.dueDate ? `${count} · due ${shortDate(input.dueDate)}` : count;
}

/** The list default is "active only", so DONE is opt-in. `null` means that
 * default; "ALL" is the explicit escape hatch that makes completed work
 * reachable again. */
export type StatusFilter = ProjectStatus | "ALL";

export function parseStatusFilter(raw: string | string[] | undefined): StatusFilter | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;
  if (value === "ALL") return "ALL";
  return (PROJECT_STATUSES as readonly string[]).includes(value) ? (value as ProjectStatus) : null;
}

export function parseHealthFilter(raw: string | string[] | undefined): ProjectHealth | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;
  return (PROJECT_HEALTHS as readonly string[]).includes(value) ? (value as ProjectHealth) : null;
}
