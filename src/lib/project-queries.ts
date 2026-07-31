import { Prisma, type PrismaClient } from "@prisma/client";
import { computeProgress, type ProgressCounts, type ProgressMode, type ProgressView } from "@/lib/progress";
import {
  milestoneStates,
  milestoneMetaLabel,
  milestoneStateDot,
  type MilestoneState,
} from "@/lib/milestones";
import {
  projectColorIndex,
  projectRowSubtitle,
  type ProjectHealth,
  type ProjectStatus,
  type StatusFilter,
} from "@/lib/project";

/**
 * THE Phase 3 swap point.
 *
 * A "unit" of progress is the finest-grained trackable work item a project
 * has. Through Phase 2 that was the milestone; as of Phase 3 it is the task
 * when a project has any, falling back to milestones when it doesn't — the
 * signature, its batching contract and every caller stay exactly as they
 * were.
 *
 * Takes an array of ids and returns a Map, so callers never issue one query
 * per row. Every requested id is present in the result, including projects
 * with no units at all, so no caller has to null-check.
 */
export async function getProjectProgressCounts(
  db: PrismaClient,
  projectIds: string[]
): Promise<Map<string, ProgressCounts>> {
  const counts = new Map<string, ProgressCounts>();
  if (projectIds.length === 0) return counts;

  // Invariant 1: every requested id is present, so no caller null-checks.
  for (const id of projectIds) counts.set(id, { completed: 0, total: 0 });

  // D1: tasks are the finest-grained unit when a project has any. One grouped
  // count, constant regardless of row count.
  const taskGroups = await db.task.groupBy({
    by: ["projectId", "status"],
    where: { projectId: { in: projectIds } },
    _count: { _all: true },
  });

  const taskCounts = new Map<string, ProgressCounts>();
  for (const g of taskGroups) {
    // Prisma types a nullable grouping key as string | null. The where clause
    // excludes personal tasks, but a stray null must never land in a project's
    // bucket — a mis-bucketed row is a wrong percentage with no error anywhere.
    if (g.projectId === null) continue;
    const entry = taskCounts.get(g.projectId) ?? { completed: 0, total: 0 };
    entry.total += g._count._all;
    if (g.status === "DONE") entry.completed += g._count._all; // D7: REVIEW is in flight
    taskCounts.set(g.projectId, entry);
  }

  // Unchanged from Phase 2, byte for byte.
  const milestones = await db.milestone.findMany({
    where: { projectId: { in: projectIds } },
    select: { projectId: true, completedAt: true },
  });

  const milestoneCounts = new Map<string, ProgressCounts>();
  for (const m of milestones) {
    const entry = milestoneCounts.get(m.projectId) ?? { completed: 0, total: 0 };
    entry.total += 1;
    if (m.completedAt !== null) entry.completed += 1;
    milestoneCounts.set(m.projectId, entry);
  }

  for (const id of projectIds) {
    const tasks = taskCounts.get(id);
    if (tasks && tasks.total > 0) {
      counts.set(id, tasks);
      continue;
    }
    const ms = milestoneCounts.get(id);
    if (ms) counts.set(id, ms);
    // else: the seeded { completed: 0, total: 0 } stands — invariant 2.
  }

  return counts;
}

export type ProjectListRow = {
  id: string;
  name: string;
  clientId: string;
  clientName: string;
  status: ProjectStatus;
  health: ProjectHealth;
  dueDate: Date | null;
  milestoneCount: number;
  progress: ProgressView;
  colorIndex: number;
  subtitle: string;
};

/** Exactly three queries, whatever the row count: one for the projects, two
 * batched calls (tasks, then milestones as fallback) for their progress
 * units. */
export async function listProjects(
  db: PrismaClient,
  input?: { clientId?: string; health?: ProjectHealth | null; status?: StatusFilter | null }
): Promise<ProjectListRow[]> {
  const where: Prisma.ProjectWhereInput = {};
  if (input?.clientId) where.clientId = input.clientId;
  if (input?.health) where.health = input.health;
  // No status given means the active-only default; "ALL" drops the constraint
  // so DONE projects stay reachable; anything else filters to that one status.
  if (!input?.status) where.status = { not: "DONE" };
  else if (input.status !== "ALL") where.status = input.status;

  const projects = await db.project.findMany({
    where,
    orderBy: [{ dueDate: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      clientId: true,
      status: true,
      health: true,
      dueDate: true,
      progressMode: true,
      manualProgress: true,
      client: { select: { name: true } },
      _count: { select: { milestones: true } },
    },
  });

  const counts = await getProjectProgressCounts(
    db,
    projects.map((p) => p.id)
  );

  return projects.map((p) => ({
    id: p.id,
    name: p.name,
    clientId: p.clientId,
    clientName: p.client.name,
    status: p.status as ProjectStatus,
    health: p.health as ProjectHealth,
    dueDate: p.dueDate,
    milestoneCount: p._count.milestones,
    progress: computeProgress(
      { progressMode: p.progressMode as ProgressMode, manualProgress: p.manualProgress },
      counts.get(p.id) ?? { completed: 0, total: 0 }
    ),
    colorIndex: projectColorIndex(p.id),
    subtitle: projectRowSubtitle({ milestoneCount: p._count.milestones, dueDate: p.dueDate }),
  }));
}

export type ProjectDetail = {
  id: string;
  name: string;
  description: string | null;
  clientId: string;
  clientName: string;
  status: ProjectStatus;
  health: ProjectHealth;
  startDate: Date | null;
  dueDate: Date | null;
  progress: ProgressView;
  progressMode: ProgressMode;
  manualProgress: number | null;
  colorIndex: number;
  milestones: Array<{
    id: string;
    title: string;
    order: number;
    dueDate: Date | null;
    completedAt: Date | null;
    state: MilestoneState;
    overdue: boolean;
    metaLabel: string;
    dot: "ok" | "strong" | "mute";
  }>;
};

export async function getProjectDetail(
  db: PrismaClient,
  projectId: string
): Promise<ProjectDetail | null> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    include: {
      client: { select: { name: true } },
      milestones: true,
    },
  });
  if (!project) return null;

  // Detail reads progress through the same provider as the lists, so Phase 3
  // moves every surface at once.
  const counts = await getProjectProgressCounts(db, [project.id]);

  const milestones = milestoneStates(project.milestones).map((m) => ({
    id: m.id,
    title: m.title,
    order: m.order,
    dueDate: m.dueDate,
    completedAt: m.completedAt,
    state: m.state,
    overdue: m.overdue,
    metaLabel: milestoneMetaLabel(m),
    dot: milestoneStateDot(m.state),
  }));

  return {
    id: project.id,
    name: project.name,
    description: project.description,
    clientId: project.clientId,
    clientName: project.client.name,
    status: project.status as ProjectStatus,
    health: project.health as ProjectHealth,
    startDate: project.startDate,
    dueDate: project.dueDate,
    progress: computeProgress(
      { progressMode: project.progressMode as ProgressMode, manualProgress: project.manualProgress },
      counts.get(project.id) ?? { completed: 0, total: 0 }
    ),
    progressMode: project.progressMode as ProgressMode,
    manualProgress: project.manualProgress,
    colorIndex: projectColorIndex(project.id),
    milestones,
  };
}
