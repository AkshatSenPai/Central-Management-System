import { z } from "zod";
import type { BadgeKind } from "@/lib/badges";
import { clientInitials } from "@/lib/client";
import { shortDate, isOverdue } from "@/lib/dates";

export const TASK_STATUSES = ["TO_DO", "IN_PROGRESS", "REVIEW", "DONE"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  TO_DO: "To Do",
  IN_PROGRESS: "In Progress",
  REVIEW: "Review",
  DONE: "Done",
};

export const TASK_STATUS_BADGE: Record<TaskStatus, BadgeKind> = {
  TO_DO: "neutral",
  IN_PROGRESS: "strong",
  REVIEW: "warn",
  DONE: "ok",
};

export const TASK_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_PRIORITY_LABEL: Record<TaskPriority, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  URGENT: "Urgent",
};

export const TASK_PRIORITY_BADGE: Record<TaskPriority, BadgeKind> = {
  LOW: "neutral",
  MEDIUM: "neutral",
  HIGH: "warn",
  URGENT: "bad",
};

/** Meridian. One studio, one prefix — this is not configurable, because a
 * second prefix would mean deciding what a task's prefix is derived from
 * (client? project?) and then living with references that change when a task
 * moves between them. A reference must be stable for life. */
export const TASK_REFERENCE_PREFIX = "MER";

/** 8 -> "MER-008". Padded to three digits so references line up in a column;
 * past 999 it simply grows, because truncating would break uniqueness. */
export function taskReference(reference: number): string {
  return `${TASK_REFERENCE_PREFIX}-${String(reference).padStart(3, "0")}`;
}

/** Lower ranks first — URGENT sorts ahead of LOW when due dates tie. */
export const TASK_PRIORITY_RANK: Record<TaskPriority, number> = {
  URGENT: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

/** No `status` field on purpose (R15) — this schema backs both create and
 * edit, and `updateTask` never writes status: once a task exists, its status
 * moves only through `setTaskStatus`. Creation is the exception, so
 * `createTaskAction` parses status off FormData separately against
 * `TASK_STATUSES` and `<TaskForm>` renders a status select in create mode
 * only. */
export const taskSchema = z.object({
  title: z.string().trim().min(1, "Task title is required").max(200),
  description: z.string().trim().max(4000).optional().or(z.literal("")),
  projectId: z.string().trim().optional().or(z.literal("")),
  milestoneId: z.string().trim().optional().or(z.literal("")),
  priority: z.enum(TASK_PRIORITIES),
  dueDate: z.string().trim().optional().or(z.literal("")),
});

export type TaskInput = z.infer<typeof taskSchema>;

export const checklistItemSchema = z.object({
  title: z.string().trim().min(1, "Checklist item title is required").max(200),
});

export type ChecklistItemInput = z.infer<typeof checklistItemSchema>;

/** REVIEW is in flight, not complete (D7) — only DONE is closed. */
export function isTaskOpen(status: TaskStatus): boolean {
  return status !== "DONE";
}

export function isTaskOverdue(t: { dueDate: Date | null; status: TaskStatus }, now?: Date): boolean {
  return isTaskOpen(t.status) && isOverdue(t.dueDate, now);
}

/** Server-assigned: max + 1, never a count, so deleting a middle task cannot
 * make the next one collide. Mirrors nextMilestoneOrder.
 *
 * `order` is written but currently read by nothing. Phase 3a expected 3b's
 * kanban to give it meaning; 3b moves cards between columns only, so no
 * ranking consumes it yet. Reserved deliberately — do not go looking for the
 * sort that reads it, and do not delete it. */
export function nextTaskOrder(existing: { order: number }[]): number {
  if (existing.length === 0) return 0;
  return Math.max(...existing.map((t) => t.order)) + 1;
}

/** Default phrasing ("5 tasks · 2 done") describes an unfiltered list, where
 * "done" is a meaningful fraction of the whole. Once a status filter is on,
 * every row already matches that status, so a "done" count would either be
 * redundant (viewing Done) or a lie (viewing anything else) — `filtered: true`
 * drops to a bare count instead. */
export function taskListSummary(rows: { status: string }[], options?: { filtered?: boolean }): string {
  const taskWord = rows.length === 1 ? "task" : "tasks";
  if (options?.filtered) {
    return rows.length === 0 ? "No tasks" : `${rows.length} ${taskWord}`;
  }
  if (rows.length === 0) return "No tasks yet";
  const done = rows.filter((r) => r.status === "DONE").length;
  return `${rows.length} ${taskWord} · ${done} done`;
}

export function taskRowSubtitle(input: {
  clientName: string | null;
  projectName: string | null;
  dueDate: Date | null;
}): string {
  const base =
    input.clientName && input.projectName ? `${input.clientName} · ${input.projectName}` : "Personal";
  return input.dueDate ? `${base} · due ${shortDate(input.dueDate)}` : base;
}

export function taskDueLabel(dueDate: Date | null): string {
  return dueDate ? `due ${shortDate(dueDate)}` : "";
}

export function openTaskSummary(count: number): string {
  if (count === 0) return "No open tasks";
  return `${count} open ${count === 1 ? "task" : "tasks"}`;
}

/** Caps a list for display, reporting how many were left off rather than
 * silently dropping them. */
export function capAssignees<T>(list: T[], max = 3): { shown: T[]; extra: number } {
  if (list.length <= max) return { shown: list, extra: 0 };
  return { shown: list.slice(0, max), extra: list.length - max };
}

/** The members an assignee picker may check: every active member, in the
 * order given, followed by any of the task's current assignees who are not
 * active — appended, never merged into the active ordering, each flagged
 * `active: false`. That appended remainder is what keeps a deactivated
 * current assignee's box rendered and checked, so a save that only touches
 * unrelated fields (which never resubmits the picker's own set — see
 * setTaskAssignees) can never be read as having dropped them. A current
 * assignee who is also active is never duplicated. */
export function mergeAssigneeMembers(
  activeMembers: Array<{ id: string; name: string; active: boolean }>,
  assignees: Array<{ id: string; name: string }>
): Array<{ id: string; name: string; active: boolean }> {
  const activeIds = new Set(activeMembers.map((m) => m.id));
  const deactivated = assignees
    .filter((a) => !activeIds.has(a.id))
    .map((a) => ({ id: a.id, name: a.name, active: false }));
  return [...activeMembers, ...deactivated];
}

export type TaskSortable = { dueDate: Date | null; priority: TaskPriority };

/** My Tasks order: a dated task always precedes an undated one; two dated
 * tasks compare by timestamp ascending; ties and two undated tasks fall
 * through to TASK_PRIORITY_RANK; a full tie returns 0 so Array.prototype.sort's
 * stability preserves the query's order. */
export function compareMyTasks(a: TaskSortable, b: TaskSortable): number {
  if (a.dueDate && b.dueDate) {
    const diff = a.dueDate.getTime() - b.dueDate.getTime();
    if (diff !== 0) return diff;
  } else if (a.dueDate && !b.dueDate) {
    return -1;
  } else if (!a.dueDate && b.dueDate) {
    return 1;
  }
  return TASK_PRIORITY_RANK[a.priority] - TASK_PRIORITY_RANK[b.priority];
}

export function sortMyTasks<T extends TaskSortable>(rows: T[]): T[] {
  return [...rows].sort(compareMyTasks);
}

/** What the Project sort needs on top of TaskSortable. A task with no
 * `projectName` is personal — the same test `taskRowSubtitle` uses to print
 * "Personal" — so this is the whole of the personal-versus-project axis. */
export type TaskGroupable = TaskSortable & {
  clientName: string | null;
  projectName: string | null;
};

export const MY_TASK_SORTS = ["DUE_DATE", "PRIORITY", "PROJECT"] as const;
export type MyTaskSort = (typeof MY_TASK_SORTS)[number];

export const MY_TASK_SORT_LABEL: Record<MyTaskSort, string> = {
  DUE_DATE: "Due date",
  PRIORITY: "Priority",
  PROJECT: "Project",
};

/** Highest priority first, then the due-date order as the tiebreak.
 *
 * Delegating the tiebreak to `compareMyTasks` rather than comparing dates
 * again here is what keeps the two sorts from drifting: there is exactly one
 * definition of "dated before undated, then earliest first". */
export function compareMyTasksByPriority(a: TaskSortable, b: TaskSortable): number {
  const rank = TASK_PRIORITY_RANK[a.priority] - TASK_PRIORITY_RANK[b.priority];
  return rank !== 0 ? rank : compareMyTasks(a, b);
}

/** Client, then project, then the due-date order — with personal work last.
 *
 * Personal tasks sort to the end rather than the start deliberately: this
 * page is scanned top-down, and client work is what the studio is accountable
 * for. Grouping them at all is the point of the sort, so which end they land
 * on is a presentation call, not a correctness one — it is recorded here so
 * it is not re-litigated as a bug.
 *
 * A personal task never compares its names: both are null, so falling through
 * to the name comparison would be a no-op that only obscures the intent. */
export function compareMyTasksByProject(a: TaskGroupable, b: TaskGroupable): number {
  const aPersonal = a.projectName === null;
  const bPersonal = b.projectName === null;
  if (aPersonal !== bPersonal) return aPersonal ? 1 : -1;

  if (!aPersonal) {
    const byClient = (a.clientName ?? "").localeCompare(b.clientName ?? "");
    if (byClient !== 0) return byClient;
    const byProject = (a.projectName ?? "").localeCompare(b.projectName ?? "");
    if (byProject !== 0) return byProject;
  }

  return compareMyTasks(a, b);
}

/** The one entry point the pages use. `null` means the default, matching how
 * `parseTaskStatusFilter` treats an absent param — so a bare /my-tasks URL
 * and ?sort=DUE_DATE produce the same list, and neither has to be special-
 * cased at the call site.
 *
 * `sortMyTasks` is left alone rather than absorbed into this: /team calls it
 * for the member cards and has no sort axis of its own, so giving it an
 * optional parameter it never passes would only invite someone to add one. */
export function sortMyTasksBy<T extends TaskGroupable>(rows: T[], sort: MyTaskSort | null): T[] {
  switch (sort) {
    case "PRIORITY":
      return [...rows].sort(compareMyTasksByPriority);
    case "PROJECT":
      return [...rows].sort(compareMyTasksByProject);
    default:
      return sortMyTasks(rows);
  }
}

export function parseMyTaskSort(raw: string | string[] | undefined): MyTaskSort | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;
  return (MY_TASK_SORTS as readonly string[]).includes(value) ? (value as MyTaskSort) : null;
}

/** One member's section on the admin All Tasks page. `id` is null for the
 * single synthetic group holding work nobody is assigned to. */
export type AssigneeGroup<T> = {
  id: string | null;
  name: string;
  initials: string;
  tasks: T[];
};

export const UNASSIGNED_GROUP_NAME = "Unassigned";

type Assignable = { assignees: Array<{ id: string; name: string }> };

/** Files every task under each of its assignees, for the admin view of who is
 * carrying what.
 *
 * Four rules, three of which exist because the obvious implementation drops
 * work silently — and on the one page whose entire purpose is that nothing is
 * being dropped:
 *
 * 1. **Every active member gets a group, even an empty one.** Same invariant
 *    as `listTeamCards`: "nobody has anything for Dana" is a fact an admin
 *    wants stated, not inferred from an absence.
 * 2. **A task with several assignees appears under each of them.** It is
 *    genuinely on both their plates, and picking one arbitrarily would tell
 *    the other person's section a lie. Row counts therefore sum to more than
 *    the task count, which is correct rather than double-counting.
 * 3. **Work assigned to a deactivated member keeps a group**, appended after
 *    the active ones and named from the task's own assignee record — the same
 *    rule `mergeAssigneeMembers` applies to the assignee picker. Stranded work
 *    is exactly what this page exists to surface; dropping it would hide the
 *    problem at the moment someone is deactivated.
 * 4. **Unassigned work gets a trailing group**, present only when it is
 *    non-empty. Nobody's section would otherwise contain it, and unassigned
 *    work is the first thing an admin scanning this page is looking for.
 */
export function groupTasksByAssignee<T extends Assignable>(
  rows: T[],
  members: ReadonlyArray<{ id: string; name: string }>
): AssigneeGroup<T>[] {
  const groups = new Map<string, AssigneeGroup<T>>();
  for (const m of members) {
    groups.set(m.id, { id: m.id, name: m.name, initials: clientInitials(m.name), tasks: [] });
  }

  const unassigned: T[] = [];
  for (const row of rows) {
    if (row.assignees.length === 0) {
      unassigned.push(row);
      continue;
    }
    for (const a of row.assignees) {
      let group = groups.get(a.id);
      if (!group) {
        // A deactivated assignee: absent from `members`, appended here in
        // first-encounter order, which follows the row order the caller sorted.
        group = { id: a.id, name: a.name, initials: clientInitials(a.name), tasks: [] };
        groups.set(a.id, group);
      }
      group.tasks.push(row);
    }
  }

  const result = [...groups.values()];
  if (unassigned.length > 0) {
    result.push({ id: null, name: UNASSIGNED_GROUP_NAME, initials: "—", tasks: unassigned });
  }
  return result;
}

/** The list default is "open only", so DONE is opt-in. `null` means that
 * default; "ALL" is the explicit escape hatch that makes completed work
 * reachable again. */
export type TaskStatusFilter = TaskStatus | "ALL";

export function parseTaskStatusFilter(raw: string | string[] | undefined): TaskStatusFilter | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;
  if (value === "ALL") return "ALL";
  return (TASK_STATUSES as readonly string[]).includes(value) ? (value as TaskStatus) : null;
}

/** The board's read shape. Every status is seeded before any row is filed,
 * so a column is always present and always a valid drop target — the board
 * never null-checks and an empty column is an empty array, never undefined.
 * Rows keep the order they arrived in, which is what carries
 * listProjectTasks' [status, order, createdAt] sort through untouched. */
export function groupTasksByStatus<T extends { status: TaskStatus }>(
  rows: T[]
): Record<TaskStatus, T[]> {
  const grouped = {} as Record<TaskStatus, T[]>;
  for (const status of TASK_STATUSES) grouped[status] = [];
  for (const row of rows) grouped[row.status].push(row);
  return grouped;
}

/** A blocker as every surface needs it: the reference to name it by, and the
 * status that decides whether it still blocks. */
export type BlockerRef = { reference: number; status: TaskStatus };

/** Blockedness is DERIVED, never stored. This is the whole definition, and it
 * is deliberately one line: a stored flag would have to be updated on every
 * status change of every blocker and would drift the first time one of those
 * writes was missed. Deriving it is also what makes reopening a blocker
 * re-block its dependents with no writes at all. */
export function isTaskBlocked(blockers: { status: TaskStatus }[]): boolean {
  return blockers.some((b) => b.status !== "DONE");
}

/** Only these block, so only these are ever described. A DONE blocker is
 * history, not a constraint, and must not appear in a chip or a count. */
export function unfinishedBlockers<T extends { status: TaskStatus }>(blockers: T[]): T[] {
  return blockers.filter((b) => b.status !== "DONE");
}

/** While blocked, a task may move TO `TO_DO` and nowhere else; an admin may
 * move it anywhere. Parking and reopening stay legal because they are the two
 * moves someone makes precisely BECAUSE they have discovered they are
 * blocked — refusing those would be perverse. */
export function blockedTransitionRefused(input: {
  blocked: boolean;
  to: TaskStatus;
  isAdmin: boolean;
}): boolean {
  if (!input.blocked) return false;
  if (input.isAdmin) return false;
  return input.to !== "TO_DO";
}

/** "Blocked by MER-018", "Blocked by MER-018 +2", or null when nothing
 * unfinished blocks it.
 *
 * **Never a bare "Blocked".** `ProjectHealth.BLOCKED` already owns that word
 * as a manual field on the project form, and the two render on the same
 * screen — the project detail page shows the health badge above the task
 * list. The preposition is what keeps them distinguishable, and it costs
 * nothing because the reference is the useful part anyway. */
export function blockedChipLabel(blockers: BlockerRef[]): string | null {
  const open = unfinishedBlockers(blockers);
  if (open.length === 0) return null;
  const lead = `Blocked by ${taskReference(open[0].reference)}`;
  return open.length === 1 ? lead : `${lead} +${open.length - 1}`;
}

/** The refusal a member sees. Names the leading blocker and the way past it;
 * the detail page lists them all, so a toast naming every reference would be
 * a wall nobody reads.
 *
 * Only called when a move was actually refused, which is only when at least
 * one blocker is unfinished — so `open[0]` always exists. */
export function blockedRefusalMessage(blockers: BlockerRef[]): string {
  const open = unfinishedBlockers(blockers);
  const lead = taskReference(open[0].reference);
  if (open.length === 1) {
    return `Blocked by ${lead}. Finish it first, or ask an admin to override.`;
  }
  return `Blocked by ${lead} and ${open.length - 1} more. Finish them first, or ask an admin to override.`;
}
