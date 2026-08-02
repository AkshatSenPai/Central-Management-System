import { z } from "zod";
import type { BadgeKind } from "@/lib/badges";
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
