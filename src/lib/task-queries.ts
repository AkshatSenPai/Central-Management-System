import { Prisma, type PrismaClient } from "@prisma/client";
import { clientInitials } from "@/lib/client";
import {
  isTaskOverdue,
  sortMyTasks,
  taskDueLabel,
  taskRowSubtitle,
  type TaskPriority,
  type TaskStatus,
  type TaskStatusFilter,
} from "@/lib/task";

export type TaskListRow = {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: Date | null;
  overdue: boolean;
  projectId: string | null;
  projectName: string | null;
  clientId: string | null;
  clientName: string | null;
  subtitle: string;
  assignees: Array<{ id: string; name: string; initials: string }>;
};

/** The shape every list query selects, whatever its where/orderBy — shared so
 * listAssignedTasks and listProjectTasks read (and map) identically, and diverge
 * only in the where clause, ordering and subtitle they build on top. */
const taskRowSelect = {
  id: true,
  title: true,
  status: true,
  priority: true,
  dueDate: true,
  projectId: true,
  project: { select: { name: true, clientId: true, client: { select: { name: true } } } },
  assignees: { select: { user: { select: { id: true, name: true } } } },
} as const;

/** Status and priority are the enum unions, not plain strings — Prisma
 * already returns them that way, and widening them here was what forced a
 * cast at every read site. Phase 3b's kanban builds directly on these rows. */
type TaskRowSource = {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: Date | null;
  projectId: string | null;
  project: { name: string; clientId: string; client: { name: string } } | null;
  assignees: { user: { id: string; name: string } }[];
};

function mapAssignees(rows: { user: { id: string; name: string } }[]) {
  return rows.map((a) => ({ id: a.user.id, name: a.user.name, initials: clientInitials(a.user.name) }));
}

function toTaskListRow(t: TaskRowSource, subtitle: string): TaskListRow {
  return {
    id: t.id,
    title: t.title,
    status: t.status,
    priority: t.priority,
    dueDate: t.dueDate,
    overdue: isTaskOverdue({ dueDate: t.dueDate, status: t.status }),
    projectId: t.projectId,
    projectName: t.project?.name ?? null,
    clientId: t.project?.clientId ?? null,
    clientName: t.project?.client.name ?? null,
    subtitle,
    assignees: mapAssignees(t.assignees),
  };
}

/** Tasks assigned to one member, open work only unless asked otherwise — the
 * same "not DONE unless ALL or an explicit status" rule as listProjects.
 * Named for the assignee rather than the viewer because /team/[memberId]
 * reads it for someone other than the person looking. Ordered by createdAt
 * ascending so sortMyTasks' stable in-memory sort has a deterministic input;
 * exactly one db call, whatever the row count. */
export async function listAssignedTasks(
  db: PrismaClient,
  input: { userId: string; status?: TaskStatusFilter | null }
): Promise<TaskListRow[]> {
  const where: Prisma.TaskWhereInput = { assignees: { some: { userId: input.userId } } };
  if (!input.status) where.status = { not: "DONE" };
  else if (input.status !== "ALL") where.status = input.status;

  const tasks = await db.task.findMany({
    where,
    orderBy: { createdAt: "asc" },
    select: taskRowSelect,
  });

  const rows = tasks.map((t) =>
    toTaskListRow(
      t,
      taskRowSubtitle({
        clientName: t.project?.client.name ?? null,
        projectName: t.project?.name ?? null,
        dueDate: t.dueDate,
      })
    )
  );
  return sortMyTasks(rows);
}

/** Tasks due inside a half-open window, for the calendar.
 *
 * A third caller of `taskRowSelect` / `toTaskListRow`, not a widening of
 * `listAssignedTasks` — making that function's `userId` optional would turn
 * /my-tasks and /team/[memberId] into all-tasks views the moment a caller
 * passed undefined, which no type would catch.
 *
 * Two consequences of the range clause, both intended:
 *
 * - **Undated tasks never appear.** Any `gte`/`lt` on a nullable column
 *   excludes nulls, and a task with no due date has no cell to sit in.
 *   /my-tasks remains where undated work is found.
 * - **The window is half-open**, matching `bucketMyTasks` and `weekStats`, so
 *   a task due exactly on a boundary lands in one cell rather than two.
 *
 * Status follows the same rule as `listProjects` and `listAssignedTasks`: no
 * status given means open work only; "ALL" drops the constraint so completed
 * work stays visible; anything else filters to that one status.
 */
export async function listTasksInRange(
  db: PrismaClient,
  input: {
    from: Date;
    to: Date;
    userId?: string | null;
    projectId?: string | null;
    status?: TaskStatusFilter | null;
  }
): Promise<TaskListRow[]> {
  const where: Prisma.TaskWhereInput = { dueDate: { gte: input.from, lt: input.to } };
  if (!input.status) where.status = { not: "DONE" };
  else if (input.status !== "ALL") where.status = input.status;
  if (input.userId) where.assignees = { some: { userId: input.userId } };
  if (input.projectId) where.projectId = input.projectId;

  const tasks = await db.task.findMany({
    where,
    // By due date, then priority, so a cell with several tasks leads with the
    // most urgent rather than the most recently created.
    orderBy: [{ dueDate: "asc" }, { priority: "asc" }, { createdAt: "asc" }],
    select: taskRowSelect,
  });

  return tasks.map((t) =>
    toTaskListRow(
      t,
      taskRowSubtitle({
        clientName: t.project?.client.name ?? null,
        projectName: t.project?.name ?? null,
        dueDate: t.dueDate,
      })
    )
  );
}

/** A project's task board: every status stays visible so completed work is
 * never hidden, ordered so DONE lands last by the enum's own declaration
 * order rather than any completedAt timestamp. The subtitle is the due
 * clause alone — the project and client are already this page's own context,
 * so repeating "Personal" or their names here would be noise. */
export async function listProjectTasks(db: PrismaClient, projectId: string): Promise<TaskListRow[]> {
  const tasks = await db.task.findMany({
    where: { projectId },
    orderBy: [{ status: "asc" }, { order: "asc" }, { createdAt: "asc" }],
    select: taskRowSelect,
  });

  return tasks.map((t) => toTaskListRow(t, taskDueLabel(t.dueDate)));
}

export type TaskDetail = {
  id: string;
  reference: number;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: Date | null;
  overdue: boolean;
  projectId: string | null;
  projectName: string | null;
  clientId: string | null;
  clientName: string | null;
  milestoneId: string | null;
  milestoneTitle: string | null;
  creator: { id: string; name: string };
  assignees: Array<{ id: string; name: string; initials: string }>;
  checklist: Array<{ id: string; title: string; done: boolean; order: number }>;
  checklistDone: number;
  checklistTotal: number;
};

const taskDetailSelect = {
  id: true,
  reference: true,
  title: true,
  description: true,
  status: true,
  priority: true,
  dueDate: true,
  projectId: true,
  milestoneId: true,
  project: { select: { name: true, clientId: true, client: { select: { name: true } } } },
  milestone: { select: { title: true } },
  creator: { select: { id: true, name: true } },
  assignees: { select: { user: { select: { id: true, name: true } } } },
  checklist: {
    // Deliberately not `as const` at the object level: that would make this
    // array a readonly tuple, which Prisma's OrderBy input (a mutable array)
    // rejects. Only the sort directions need pinning to their literal type.
    orderBy: [{ order: "asc" as const }, { createdAt: "asc" as const }],
    select: { id: true, title: true, done: true, order: true },
  },
};

/** One query — project, client, milestone, creator, assignees and the
 * checklist all ride the same findUnique via nested select, so the task
 * detail page never issues a call per section. */
export async function getTaskDetail(db: PrismaClient, taskId: string): Promise<TaskDetail | null> {
  const task = await db.task.findUnique({
    where: { id: taskId },
    select: taskDetailSelect,
  });
  if (!task) return null;

  return {
    id: task.id,
    reference: task.reference,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    dueDate: task.dueDate,
    overdue: isTaskOverdue({ dueDate: task.dueDate, status: task.status }),
    projectId: task.projectId,
    projectName: task.project?.name ?? null,
    clientId: task.project?.clientId ?? null,
    clientName: task.project?.client.name ?? null,
    milestoneId: task.milestoneId,
    milestoneTitle: task.milestone?.title ?? null,
    creator: { id: task.creator.id, name: task.creator.name },
    assignees: mapAssignees(task.assignees),
    checklist: task.checklist,
    checklistDone: task.checklist.filter((c) => c.done).length,
    checklistTotal: task.checklist.length,
  };
}
