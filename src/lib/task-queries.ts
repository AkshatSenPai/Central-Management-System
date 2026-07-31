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
 * listMyTasks and listProjectTasks read (and map) identically, and diverge
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

/** My Tasks: scoped to the viewer's own assignments, open work only unless
 * asked otherwise — the same "not DONE unless ALL or an explicit status"
 * rule as listProjects. Ordered by createdAt ascending so sortMyTasks' stable
 * in-memory sort has a deterministic input to work from; exactly one db call,
 * whatever the row count. */
export async function listMyTasks(
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
