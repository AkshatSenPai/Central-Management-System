import type { PrismaClient } from "@prisma/client";
import { clientInitials } from "@/lib/client";
import {
  openTaskSummary,
  sortMyTasks,
  type TaskPriority,
  type TaskStatus,
  type TaskStatusFilter,
} from "@/lib/task";
import { listAssignedTasks, type TaskListRow } from "@/lib/task-queries";

export type TeamCardTask = {
  id: string;
  title: string;
  status: TaskStatus;
  projectId: string | null;
  projectName: string | null;
  clientId: string | null;
  clientName: string | null;
  dueDate: Date | null;
  priority: TaskPriority;
};

/** How many `otherOpen` rows a card shows before it stops listing and starts
 * counting. The badge always carries the true total, so this caps the list
 * without ever understating the load. */
export const TEAM_CARD_OTHER_OPEN_LIMIT = 3;

export type TeamCard = {
  id: string;
  name: string;
  initials: string;
  title: string | null;
  openTaskCount: number;
  openTaskLabel: string;
  inProgress: TeamCardTask[];
  /** Open work that is not in flight — TO_DO, REVIEW, and anything added to
   * the status enum later. Capped at TEAM_CARD_OTHER_OPEN_LIMIT. */
  otherOpen: TeamCardTask[];
  /** How many `otherOpen` rows the cap left off. Zero when nothing was cut. */
  otherOpenExtra: number;
};

/**
 * The `/team` grid's read model — "what is X working on right now?" in one
 * click. Three queries, constant regardless of team size, mirroring
 * getProjectProgressCounts' batching contract: every active member is
 * seeded with a zero-open, empty-In-Progress card BEFORE either fold runs,
 * so a member absent from both the group-by and the findMany results still
 * renders correctly and <MemberCard> never null-checks.
 */
export async function listTeamCards(db: PrismaClient): Promise<TeamCard[]> {
  const members = await db.user.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, title: true },
  });
  if (members.length === 0) return [];

  const ids = members.map((m) => m.id);

  // Invariant: every active member is present before either fold below runs,
  // so a member with no rows in either query still gets a correct card.
  const cards = new Map<string, TeamCard>();
  for (const m of members) {
    cards.set(m.id, {
      id: m.id,
      name: m.name,
      initials: clientInitials(m.name),
      title: m.title,
      openTaskCount: 0,
      openTaskLabel: openTaskSummary(0),
      inProgress: [],
      otherOpen: [],
      otherOpenExtra: 0,
    });
  }

  // Open-task counts: every non-DONE status counts as open (D7 — REVIEW is
  // in flight, not complete). One grouped query, constant regardless of team
  // size.
  const groups = await db.taskAssignee.groupBy({
    by: ["userId"],
    where: { userId: { in: ids }, task: { status: { not: "DONE" } } },
    _count: { _all: true },
  });
  for (const g of groups) {
    const card = cards.get(g.userId);
    if (!card) continue;
    card.openTaskCount = g._count._all;
    card.openTaskLabel = openTaskSummary(g._count._all);
  }

  // Open-task detail. This asks for every non-DONE task rather than only
  // IN_PROGRESS ones, and partitions in memory below.
  //
  // It used to ask for IN_PROGRESS alone, which made the card body identical
  // for a member with nothing assigned and a member with five unstarted
  // tasks: both rendered "Nothing in progress." That reads as "this person is
  // free" when the opposite is true, and it was the single most-reported
  // complaint about /team. Widening the *detail* rather than replacing it
  // keeps "what is X working on right now?" as the card's primary answer —
  // listing all open work instead would bury the two things someone is
  // actually doing under twenty things they are not.
  //
  // Still one query, still constant regardless of team size. It returns more
  // rows than before by exactly the number of open-but-not-started tasks the
  // team holds, which is the same order of magnitude the badge already counts.
  const openTasks = await db.taskAssignee.findMany({
    where: { userId: { in: ids }, task: { status: { not: "DONE" } } },
    select: {
      userId: true,
      task: {
        select: {
          id: true,
          title: true,
          status: true,
          dueDate: true,
          priority: true,
          project: { select: { id: true, name: true, client: { select: { id: true, name: true } } } },
        },
      },
    },
  });

  const byMember = new Map<string, TeamCardTask[]>();
  for (const row of openTasks) {
    if (!cards.has(row.userId)) continue;
    const list = byMember.get(row.userId) ?? [];
    list.push({
      id: row.task.id,
      title: row.task.title,
      status: row.task.status as TaskStatus,
      projectId: row.task.project?.id ?? null,
      projectName: row.task.project?.name ?? null,
      clientId: row.task.project?.client.id ?? null,
      clientName: row.task.project?.client.name ?? null,
      dueDate: row.task.dueDate,
      priority: row.task.priority as TaskPriority,
    });
    byMember.set(row.userId, list);
  }

  for (const [userId, tasks] of byMember) {
    const card = cards.get(userId);
    if (!card) continue;
    // Partitioned as "IN_PROGRESS versus everything else still open", never
    // as "IN_PROGRESS versus TO_DO". A status added to the enum later — the
    // ProjectStatus MAINTENANCE precedent — then lands in otherOpen and stays
    // on the card, instead of matching neither arm and disappearing from the
    // body while still counting in the badge.
    const sorted = sortMyTasks(tasks);
    card.inProgress = sorted.filter((t) => t.status === "IN_PROGRESS");
    const rest = sorted.filter((t) => t.status !== "IN_PROGRESS");
    card.otherOpen = rest.slice(0, TEAM_CARD_OTHER_OPEN_LIMIT);
    card.otherOpenExtra = rest.length - card.otherOpen.length;
  }

  return members.map((m) => cards.get(m.id)!);
}

export type MemberProfileProject = {
  id: string;
  name: string;
  clientId: string;
  clientName: string;
};

export type MemberProfile = {
  id: string;
  name: string;
  initials: string;
  title: string | null;
  active: boolean;
  tasks: TaskListRow[];
  projects: MemberProfileProject[];
};

/** One member's page: their assigned tasks under whatever filter the URL
 * carries, plus the projects they are active on.
 *
 * Three queries, constant regardless of row count. The project list is its
 * own query deliberately — folding it out of the filtered task rows would be
 * two, but then filtering the page to Done would empty it and the member
 * would appear active on nothing. "Projects they are active on" is a fact
 * about the member, not about the current view. */
export async function getMemberProfile(
  db: PrismaClient,
  userId: string,
  input: { status?: TaskStatusFilter | null } = {}
): Promise<MemberProfile | null> {
  const member = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, title: true, active: true },
  });
  if (!member) return null;

  const tasks = await listAssignedTasks(db, { userId, status: input.status });

  const projectRows = await db.task.findMany({
    where: { assignees: { some: { userId } }, status: { not: "DONE" } },
    select: {
      project: { select: { id: true, name: true, clientId: true, client: { select: { name: true } } } },
    },
  });

  const projects = new Map<string, MemberProfileProject>();
  for (const row of projectRows) {
    // A personal task has no project to contribute.
    if (!row.project) continue;
    if (projects.has(row.project.id)) continue;
    projects.set(row.project.id, {
      id: row.project.id,
      name: row.project.name,
      clientId: row.project.clientId,
      clientName: row.project.client.name,
    });
  }

  return {
    id: member.id,
    name: member.name,
    initials: clientInitials(member.name),
    title: member.title,
    active: member.active,
    tasks,
    projects: [...projects.values()],
  };
}
