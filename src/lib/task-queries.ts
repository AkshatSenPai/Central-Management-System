import { Prisma, type PrismaClient } from "@prisma/client";
import { clientInitials } from "@/lib/client";
import { buildSequences, groupIntoSequences, type Sequence } from "@/lib/sequences";
import {
  isTaskOverdue,
  MY_TASK_SCOPE_CLIENT,
  MY_TASK_SCOPE_PERSONAL,
  sortMyTasksBy,
  taskDueLabel,
  taskReference,
  taskRowSubtitle,
  type BlockerRef,
  type MyTaskSort,
  type TaskPriority,
  type TaskStatus,
  type TaskStatusFilter,
} from "@/lib/task";

/** A task at the other end of a dependency, in the shape both directions
 * render: the reference to name it, the title to recognise it, the status to
 * tell whether it still blocks. One definition so "Blocked by" and "Blocking"
 * cannot drift apart. */
export type DependencyTask = {
  id: string;
  reference: number;
  title: string;
  status: TaskStatus;
};

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
  /** Every blocker, including the DONE ones. The pure helpers filter — a row
   * that arrived pre-filtered could not tell "no dependencies" from "all
   * satisfied", and the second is worth showing on detail. */
  blockers: BlockerRef[];
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
  // Shared, so /my-tasks, /all-tasks and the project and client task lists
  // all get the chip from this one line.
  blockedBy: { select: { blocker: { select: { reference: true, status: true } } } },
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
  blockedBy: { blocker: { reference: number; status: TaskStatus } }[];
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
    blockers: t.blockedBy.map((d) => d.blocker),
  };
}

/** Tasks assigned to one member, open work only unless asked otherwise — the
 * same "not DONE unless ALL or an explicit status" rule as listProjects.
 * Named for the assignee rather than the viewer because /team/[memberId]
 * reads it for someone other than the person looking. Ordered by createdAt
 * ascending so the stable in-memory sort has a deterministic input; exactly
 * one db call, whatever the row count.
 *
 * `sort` is optional and defaults to the due-date order, so the two callers
 * with no sort axis of their own — the dashboard and /team/[memberId] — keep
 * the ordering they had before /my-tasks gained a picker. Sorting stays in
 * memory rather than moving to `orderBy` because the Project sort's
 * personal-last rule has no SQL expression here: "personal" is
 * `projectName === null`, and ordering by a nullable joined column puts nulls
 * wherever the collation feels like. */
export async function listAssignedTasks(
  db: PrismaClient,
  input: {
    userId: string;
    status?: TaskStatusFilter | null;
    sort?: MyTaskSort | null;
    scope?: string | null;
  }
): Promise<TaskListRow[]> {
  const where: Prisma.TaskWhereInput = { assignees: { some: { userId: input.userId } } };
  if (!input.status) where.status = { not: "DONE" };
  else if (input.status !== "ALL") where.status = input.status;

  // In the where clause, not in memory. Unlike the Project *sort*, whose
  // personal-last rule has no SQL expression, this one is exactly
  // `projectId IS NULL` and belongs in the query.
  if (input.scope === MY_TASK_SCOPE_PERSONAL) where.projectId = null;
  else if (input.scope === MY_TASK_SCOPE_CLIENT) where.projectId = { not: null };
  else if (input.scope) where.projectId = input.scope;

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
  return sortMyTasksBy(rows, input.sort ?? null);
}

/** Every task in the studio, for the admin All Tasks page.
 *
 * A separate function rather than `listAssignedTasks` with an optional
 * `userId`, for exactly the reason recorded on `listTasksInRange` below:
 * making that parameter optional turns /my-tasks and /team/[memberId] into
 * all-tasks views the moment a caller passes undefined, and no type catches
 * it. The two whole-studio readers are both explicit functions instead.
 *
 * **This applies no access control.** It returns everything, so its single
 * call site is responsible for the admin check — the same contract every
 * other query in this file has, and the reason that page's guard is the first
 * thing in it.
 *
 * Unlike `listAssignedTasks` this includes tasks with no assignee at all;
 * `groupTasksByAssignee` files those under its Unassigned group, and they are
 * the main thing an admin opens this page to find. */
export async function listAllTasks(
  db: PrismaClient,
  input: { status?: TaskStatusFilter | null; sort?: MyTaskSort | null } = {}
): Promise<TaskListRow[]> {
  const where: Prisma.TaskWhereInput = {};
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
  return sortMyTasksBy(rows, input.sort ?? null);
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
  /** What this task waits on. */
  blockers: DependencyTask[];
  /** What waits on this task — the same table read backwards. Present because
   * the person about to reopen or delete a task is exactly the person who
   * needs to know what depends on it. */
  blocking: DependencyTask[];
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
  blockedBy: {
    select: { blocker: { select: { id: true, reference: true, title: true, status: true } } },
  },
  blocking: {
    select: { blockedTask: { select: { id: true, reference: true, title: true, status: true } } },
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
    blockers: task.blockedBy.map((d) => d.blocker),
    blocking: task.blocking.map((d) => d.blockedTask),
  };
}

/** Options for the blocker picker: every task except this one and the ones
 * already blocking it, with the current project's tasks first so the common
 * case sits at the top of an unfiltered list. Dependencies may cross projects
 * (owner ruling) — the meeting, the payment and the campaign do not
 * necessarily share one.
 *
 * Tasks that would close a cycle are deliberately NOT filtered out. Deciding
 * that per candidate is a graph walk each, on every render of the page; they
 * are refused on submit instead, with a message naming the other end. */
export async function listBlockerCandidates(
  db: PrismaClient,
  input: { taskId: string; projectId: string | null; excludeIds: string[] }
): Promise<Array<{ value: string; label: string }>> {
  const rows = await db.task.findMany({
    where: { id: { notIn: [input.taskId, ...input.excludeIds] } },
    select: { id: true, reference: true, title: true, projectId: true },
    orderBy: { reference: "desc" },
  });

  const sameProject = input.projectId ? rows.filter((r) => r.projectId === input.projectId) : [];
  const sameProjectIds = new Set(sameProject.map((r) => r.id));
  const rest = rows.filter((r) => !sameProjectIds.has(r.id));

  return [...sameProject, ...rest].map((r) => ({
    value: r.id,
    label: `${taskReference(r.reference)} ${r.title}`,
  }));
}

/** The Sequences view's data: the viewer's work grouped into dependency
 * sequences, plus everything of theirs that is in none.
 *
 * **Reads every row of TaskDependency**, deliberately (spec §6). It is a
 * two-column table holding dozens of rows for a six-person studio, so reading
 * all of it is a few kilobytes and the grouping is trivially exact. The
 * alternative is either N round trips for N levels, or a recursive CTE Prisma
 * expresses only through $queryRaw. **At roughly a few thousand dependency
 * rows this stops being free** and should become that CTE, seeded from the
 * viewer's task ids — a change to this function alone, because the graph work
 * lives behind `buildSequences`.
 *
 * Takes NO status filter. A sequence with its completed links hidden is
 * unreadable: the Done task is precisely what says why the next one is ready.
 * The unsequenced remainder is the exception and takes the list's own default
 * of open-only — spec §8 for why that asymmetry is deliberate rather than an
 * oversight to tidy away. */
export async function listMySequences(
  db: PrismaClient,
  input: { userId: string }
): Promise<{ sequences: Sequence[]; unsequenced: TaskListRow[] }> {
  const [edges, myTasks] = await Promise.all([
    db.taskDependency.findMany({ select: { blockedTaskId: true, blockerTaskId: true } }),
    db.task.findMany({
      where: { assignees: { some: { userId: input.userId } } },
      select: { id: true },
    }),
  ]);

  const myTaskIds = myTasks.map((t) => t.id);
  // Grouped twice on purpose, and it is cheap: this pass answers "which task
  // ids must I SELECT", which has to be known before the tasks exist, and
  // buildSequences groups again because it must stay callable from a test with
  // no database. Sharing the result would mean threading group membership
  // through the pure boundary for no gain — it is set arithmetic over a few
  // dozen rows.
  const groups = groupIntoSequences(edges, myTaskIds);
  const groupedIds = [...new Set(groups.flat())];

  const tasks =
    groupedIds.length === 0
      ? []
      : await db.task.findMany({
          where: { id: { in: groupedIds } },
          select: {
            id: true,
            reference: true,
            title: true,
            status: true,
            assignees: { select: { user: { select: { id: true, name: true } } } },
          },
        });

  const sequences = buildSequences({
    edges,
    myTaskIds,
    tasks: tasks.map((t) => ({
      id: t.id,
      reference: t.reference,
      title: t.title,
      status: t.status,
      assignees: mapAssignees(t.assignees),
    })),
  });

  const sequencedIds = new Set(sequences.flatMap((s) => s.nodes.map((n) => n.task.id)));
  const unsequencedRows = await db.task.findMany({
    where: {
      assignees: { some: { userId: input.userId } },
      status: { not: "DONE" },
      id: { notIn: [...sequencedIds] },
    },
    orderBy: { createdAt: "asc" },
    select: taskRowSelect,
  });

  return {
    sequences,
    unsequenced: unsequencedRows.map((t) => toTaskListRow(t, taskDueLabel(t.dueDate))),
  };
}
