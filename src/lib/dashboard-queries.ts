import type { PrismaClient } from "@prisma/client";
import { listAssignedTasks, type TaskListRow } from "@/lib/task-queries";
import { listRecentActivity, type ActivityEntry } from "@/lib/activity";
import { projectColorIndex } from "@/lib/project";
import { addDays, startOfUtcDay } from "@/lib/dashboard";
import { isPinned } from "@/lib/announcement";

export type InProgressRow = {
  id: string;
  title: string;
  projectName: string | null;
  colorIndex: number;
  checklistDone: number;
  checklistTotal: number;
};

export type PinnedAnnouncement = {
  id: string;
  title: string;
  authorName: string;
  at: Date;
};

export type DashboardData = {
  openTasks: TaskListRow[];
  inProgress: InProgressRow[];
  completedThisWeek: number;
  activity: ActivityEntry[];
  /** At most one. The design shows a single banner, and a stack of them
   * would be a second announcements page on the dashboard. */
  pinned: PinnedAnnouncement | null;
};

/** Counts tasks this member moved to Done in the last seven days.
 *
 * Read off the activity log rather than the Task table because Task has no
 * completedAt column: `updatedAt` moves for any edit, so a DONE task whose
 * title was fixed on Tuesday would count as completed on Tuesday. The log
 * records the actual transition — `task.status_changed` with `to: "DONE"` —
 * which is the event being counted.
 *
 * It counts transitions, not distinct tasks, so reopening and re-closing the
 * same task within the week counts twice. That is the honest reading of "what
 * did I finish this week" and matches what the activity feed shows.
 */
async function countCompletedSince(
  db: PrismaClient,
  userId: string,
  since: Date
): Promise<number> {
  return db.activityLog.count({
    where: {
      actorId: userId,
      action: "task.status_changed",
      at: { gte: since },
      meta: { path: ["to"], equals: "DONE" },
    },
  });
}

/** In-progress work with its checklist progress.
 *
 * A separate query from listAssignedTasks rather than an extra select on it:
 * the checklist counts are needed for at most a handful of IN_PROGRESS rows,
 * and adding them to the shared row select would pull every checklist item
 * for every task on /my-tasks and /team/[id] as well.
 */
async function listInProgress(db: PrismaClient, userId: string): Promise<InProgressRow[]> {
  const rows = await db.task.findMany({
    where: { assignees: { some: { userId } }, status: "IN_PROGRESS" },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      projectId: true,
      project: { select: { name: true } },
      checklist: { select: { done: true } },
    },
  });

  return rows.map((t) => ({
    id: t.id,
    title: t.title,
    projectName: t.project?.name ?? null,
    // Personal tasks have no project, so no project colour. Index 1 keeps the
    // bar present and the row heights uniform rather than punching a hole in
    // the list for tasks that happen to belong to nobody's project.
    colorIndex: t.projectId ? projectColorIndex(t.projectId) : 1,
    checklistDone: t.checklist.filter((c) => c.done).length,
    checklistTotal: t.checklist.length,
  }));
}

/** Everything the dashboard renders, in four parallel queries.
 *
 * Parallel because none of them depends on another's result; serially this
 * would be four round trips to Neon on the app's landing screen.
 */
export async function getDashboard(
  db: PrismaClient,
  userId: string,
  now: Date = new Date()
): Promise<DashboardData> {
  const weekAgo = addDays(startOfUtcDay(now), -7);

  const [openTasks, inProgress, completedThisWeek, activity, pinnedRows] = await Promise.all([
    listAssignedTasks(db, { userId }),
    listInProgress(db, userId),
    countCompletedSince(db, userId, weekAgo),
    listRecentActivity(db, { limit: 6 }),
    // Filtered in memory rather than by SQL date comparison, so "pinned until
    // the 5th" means the whole of the 5th — the same day-granular rule the
    // board uses. A gt(now) clause would drop it at midnight.
    db.announcement.findMany({
      where: { pinnedUntil: { not: null } },
      orderBy: { pinnedUntil: "asc" },
      take: 5,
      select: { id: true, title: true, createdAt: true, pinnedUntil: true, author: { select: { name: true } } },
    }),
  ]);

  const live = pinnedRows.find((a) => isPinned(a.pinnedUntil, now));
  const pinned: PinnedAnnouncement | null = live
    ? { id: live.id, title: live.title, authorName: live.author.name, at: live.createdAt }
    : null;

  return { openTasks, inProgress, completedThisWeek, activity, pinned };
}
