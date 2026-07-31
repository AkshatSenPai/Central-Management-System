import { describe, it, expect } from "vitest";
import {
  TASK_STATUS_LABEL,
  TASK_STATUS_BADGE,
  TASK_PRIORITY_LABEL,
  TASK_PRIORITY_BADGE,
  taskSchema,
  checklistItemSchema,
  isTaskOpen,
  isTaskOverdue,
  nextTaskOrder,
  taskListSummary,
  taskRowSubtitle,
  taskDueLabel,
  openTaskSummary,
  capAssignees,
  compareMyTasks,
  sortMyTasks,
  parseTaskStatusFilter,
  mergeAssigneeMembers,
  type TaskSortable,
} from "@/lib/task";

const NOON = "T12:00:00.000Z";
const now = new Date(`2026-07-30${NOON}`);

const validTask = {
  title: "Ship the deck",
  description: "Slide deck for the client kickoff.",
  projectId: "p1",
  milestoneId: "m1",
  priority: "MEDIUM",
  dueDate: "2026-08-14",
};

describe("taskSchema", () => {
  it("rejects a blank title", () => {
    const parsed = taskSchema.safeParse({ ...validTask, title: "   " });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toBe("Task title is required");
  });

  it("trims the title", () => {
    const parsed = taskSchema.safeParse({ ...validTask, title: "  Ship the deck " });
    expect(parsed.data?.title).toBe("Ship the deck");
  });

  it("rejects a title over 200 characters", () => {
    const parsed = taskSchema.safeParse({ ...validTask, title: "a".repeat(201) });
    expect(parsed.success).toBe(false);
  });

  it("accepts an empty description, due date, project and milestone", () => {
    const parsed = taskSchema.safeParse({
      ...validTask,
      description: "",
      dueDate: "",
      projectId: "",
      milestoneId: "",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects an unknown priority", () => {
    const parsed = taskSchema.safeParse({ ...validTask, priority: "CRITICAL" });
    expect(parsed.success).toBe(false);
  });
});

describe("checklistItemSchema", () => {
  it("rejects a blank title", () => {
    const parsed = checklistItemSchema.safeParse({ title: "   " });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toBe("Checklist item title is required");
  });

  it("trims the title", () => {
    const parsed = checklistItemSchema.safeParse({ title: "  Send invoice  " });
    expect(parsed.data?.title).toBe("Send invoice");
  });
});

describe("task vocabulary", () => {
  it("labels statuses To Do, In Progress, Review and Done", () => {
    expect(TASK_STATUS_LABEL).toEqual({
      TO_DO: "To Do",
      IN_PROGRESS: "In Progress",
      REVIEW: "Review",
      DONE: "Done",
    });
  });

  it("maps TO_DO, IN_PROGRESS, REVIEW and DONE to the neutral, strong, warn and ok badge kinds", () => {
    expect(TASK_STATUS_BADGE).toEqual({
      TO_DO: "neutral",
      IN_PROGRESS: "strong",
      REVIEW: "warn",
      DONE: "ok",
    });
  });

  it("labels priorities Low, Medium, High and Urgent", () => {
    expect(TASK_PRIORITY_LABEL).toEqual({
      LOW: "Low",
      MEDIUM: "Medium",
      HIGH: "High",
      URGENT: "Urgent",
    });
  });

  it("maps priorities to neutral, neutral, warn and bad", () => {
    expect(TASK_PRIORITY_BADGE).toEqual({
      LOW: "neutral",
      MEDIUM: "neutral",
      HIGH: "warn",
      URGENT: "bad",
    });
  });
});

describe("isTaskOpen", () => {
  it("is false only for DONE and true for the other three, including REVIEW", () => {
    expect(isTaskOpen("DONE")).toBe(false);
    expect(isTaskOpen("TO_DO")).toBe(true);
    expect(isTaskOpen("IN_PROGRESS")).toBe(true);
    expect(isTaskOpen("REVIEW")).toBe(true);
  });
});

describe("isTaskOverdue", () => {
  it("is false when there is no due date", () => {
    expect(isTaskOverdue({ dueDate: null, status: "TO_DO" }, now)).toBe(false);
  });

  it("is true for a past due date on an open task", () => {
    expect(isTaskOverdue({ dueDate: new Date(`2026-07-01${NOON}`), status: "TO_DO" }, now)).toBe(true);
  });

  it("is false for a past due date on a DONE task", () => {
    expect(isTaskOverdue({ dueDate: new Date(`2026-07-01${NOON}`), status: "DONE" }, now)).toBe(false);
  });
});

describe("nextTaskOrder", () => {
  it("is 0 for an empty list", () => {
    expect(nextTaskOrder([])).toBe(0);
  });

  it("is one more than the highest order, never the count", () => {
    expect(nextTaskOrder([{ order: 0 }, { order: 5 }, { order: 2 }])).toBe(6);
  });
});

describe("taskListSummary", () => {
  it('reads "5 tasks · 2 done"', () => {
    const rows = [
      { status: "DONE" },
      { status: "DONE" },
      { status: "TO_DO" },
      { status: "IN_PROGRESS" },
      { status: "REVIEW" },
    ];
    expect(taskListSummary(rows)).toBe("5 tasks · 2 done");
  });

  it('reads "1 task · 0 done"', () => {
    expect(taskListSummary([{ status: "TO_DO" }])).toBe("1 task · 0 done");
  });

  it('reads "No tasks yet" for an empty list', () => {
    expect(taskListSummary([])).toBe("No tasks yet");
  });

  it("is unchanged when not filtered", () => {
    const rows = [
      { status: "DONE" },
      { status: "DONE" },
      { status: "TO_DO" },
      { status: "IN_PROGRESS" },
      { status: "REVIEW" },
    ];
    expect(taskListSummary(rows)).toBe("5 tasks · 2 done");
    expect(taskListSummary(rows, { filtered: false })).toBe("5 tasks · 2 done");
  });

  it('reads a bare count when filtered: "5 tasks", "1 task" and "No tasks"', () => {
    const rows = [
      { status: "DONE" },
      { status: "DONE" },
      { status: "TO_DO" },
      { status: "IN_PROGRESS" },
      { status: "REVIEW" },
    ];
    expect(taskListSummary(rows, { filtered: true })).toBe("5 tasks");
    expect(taskListSummary([{ status: "TO_DO" }], { filtered: true })).toBe("1 task");
    expect(taskListSummary([], { filtered: true })).toBe("No tasks");
  });
});

describe("taskRowSubtitle", () => {
  it('reads "Harlow & Fitch · Brand Guidelines v3 · due 14 Aug"', () => {
    expect(
      taskRowSubtitle({
        clientName: "Harlow & Fitch",
        projectName: "Brand Guidelines v3",
        dueDate: new Date(`2026-08-14${NOON}`),
      })
    ).toBe("Harlow & Fitch · Brand Guidelines v3 · due 14 Aug");
  });

  it("drops the due clause when there is no due date", () => {
    expect(
      taskRowSubtitle({ clientName: "Harlow & Fitch", projectName: "Brand Guidelines v3", dueDate: null })
    ).toBe("Harlow & Fitch · Brand Guidelines v3");
  });

  it('reads "Personal · due 14 Aug" for a task with no project or client', () => {
    expect(
      taskRowSubtitle({ clientName: null, projectName: null, dueDate: new Date(`2026-08-14${NOON}`) })
    ).toBe("Personal · due 14 Aug");
  });

  it('reads "Personal" for an undated personal task', () => {
    expect(taskRowSubtitle({ clientName: null, projectName: null, dueDate: null })).toBe("Personal");
  });
});

describe("taskDueLabel", () => {
  it('reads "due 14 Aug"', () => {
    expect(taskDueLabel(new Date(`2026-08-14${NOON}`))).toBe("due 14 Aug");
  });

  it("returns an empty string for no due date", () => {
    expect(taskDueLabel(null)).toBe("");
  });
});

describe("openTaskSummary", () => {
  it('reads "3 open tasks", "1 open task" and "No open tasks"', () => {
    expect(openTaskSummary(3)).toBe("3 open tasks");
    expect(openTaskSummary(1)).toBe("1 open task");
    expect(openTaskSummary(0)).toBe("No open tasks");
  });
});

function sortable(overrides: Partial<TaskSortable>): TaskSortable {
  return { dueDate: null, priority: "MEDIUM", ...overrides };
}

describe("compareMyTasks", () => {
  it("puts an earlier due date before a later one", () => {
    const a = sortable({ dueDate: new Date(`2026-08-01${NOON}`) });
    const b = sortable({ dueDate: new Date(`2026-08-10${NOON}`) });
    expect(compareMyTasks(a, b)).toBeLessThan(0);
  });

  it("puts every undated task after every dated task", () => {
    const a = sortable({ dueDate: null, priority: "URGENT" });
    const b = sortable({ dueDate: new Date(`2026-08-10${NOON}`), priority: "LOW" });
    expect(compareMyTasks(a, b)).toBeGreaterThan(0);
    expect(compareMyTasks(b, a)).toBeLessThan(0);
  });

  it("orders URGENT, HIGH, MEDIUM then LOW when the due dates are equal", () => {
    const due = new Date(`2026-08-01${NOON}`);
    const urgent = sortable({ dueDate: due, priority: "URGENT" });
    const high = sortable({ dueDate: due, priority: "HIGH" });
    const medium = sortable({ dueDate: due, priority: "MEDIUM" });
    const low = sortable({ dueDate: due, priority: "LOW" });
    expect(compareMyTasks(urgent, high)).toBeLessThan(0);
    expect(compareMyTasks(high, medium)).toBeLessThan(0);
    expect(compareMyTasks(medium, low)).toBeLessThan(0);
  });

  it("orders two undated tasks by priority", () => {
    const urgent = sortable({ dueDate: null, priority: "URGENT" });
    const low = sortable({ dueDate: null, priority: "LOW" });
    expect(compareMyTasks(urgent, low)).toBeLessThan(0);
    expect(compareMyTasks(low, urgent)).toBeGreaterThan(0);
  });

  it("treats the due date as dominant over priority", () => {
    const lowDueToday = sortable({ dueDate: new Date(`2026-07-30${NOON}`), priority: "LOW" });
    const urgentDueNextWeek = sortable({ dueDate: new Date(`2026-08-06${NOON}`), priority: "URGENT" });
    expect(compareMyTasks(lowDueToday, urgentDueNextWeek)).toBeLessThan(0);
  });

  it("returns 0 for an equal due date and priority", () => {
    const due = new Date(`2026-08-01${NOON}`);
    const a = sortable({ dueDate: due, priority: "HIGH" });
    const b = sortable({ dueDate: due, priority: "HIGH" });
    expect(compareMyTasks(a, b)).toBe(0);
  });
});

describe("sortMyTasks", () => {
  it("sorts a mixed six-task fixture into the exact expected id order", () => {
    const rows = [
      { id: "t1", dueDate: null, priority: "URGENT" as const },
      { id: "t2", dueDate: new Date(`2026-08-10${NOON}`), priority: "LOW" as const },
      { id: "t3", dueDate: new Date(`2026-08-01${NOON}`), priority: "HIGH" as const },
      { id: "t4", dueDate: new Date(`2026-08-01${NOON}`), priority: "URGENT" as const },
      { id: "t5", dueDate: null, priority: "LOW" as const },
      { id: "t6", dueDate: new Date(`2026-08-05${NOON}`), priority: "MEDIUM" as const },
    ];
    expect(sortMyTasks(rows).map((r) => r.id)).toEqual(["t4", "t3", "t6", "t2", "t1", "t5"]);
  });

  it("keeps input order for two tasks with the same due date and priority, proving stability", () => {
    const due = new Date(`2026-08-01${NOON}`);
    const rows = [
      { id: "a", dueDate: due, priority: "HIGH" as const },
      { id: "b", dueDate: due, priority: "HIGH" as const },
    ];
    expect(sortMyTasks(rows).map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("does not mutate the input array", () => {
    const rows = [
      { id: "later", dueDate: new Date(`2026-08-10${NOON}`), priority: "LOW" as const },
      { id: "earlier", dueDate: new Date(`2026-08-01${NOON}`), priority: "LOW" as const },
    ];
    const sorted = sortMyTasks(rows);
    expect(sorted.map((r) => r.id)).toEqual(["earlier", "later"]);
    expect(rows.map((r) => r.id)).toEqual(["later", "earlier"]);
  });
});

describe("capAssignees", () => {
  it("shows all of two and reports no overflow", () => {
    expect(capAssignees(["a", "b"])).toEqual({ shown: ["a", "b"], extra: 0 });
  });

  it("shows three and reports no overflow", () => {
    expect(capAssignees(["a", "b", "c"])).toEqual({ shown: ["a", "b", "c"], extra: 0 });
  });

  it("shows three of five and reports an overflow of two", () => {
    expect(capAssignees(["a", "b", "c", "d", "e"])).toEqual({ shown: ["a", "b", "c"], extra: 2 });
  });

  it("returns an empty list and no overflow for nobody", () => {
    expect(capAssignees([])).toEqual({ shown: [], extra: 0 });
  });
});

describe("mergeAssigneeMembers", () => {
  const active = [
    { id: "u1", name: "Alice", active: true },
    { id: "u2", name: "Bob", active: true },
  ];

  it("keeps an inactive current assignee in the list, flagged not active so their box still renders checked", () => {
    const result = mergeAssigneeMembers(active, [{ id: "u3", name: "Cara" }]);
    expect(result).toEqual([
      { id: "u1", name: "Alice", active: true },
      { id: "u2", name: "Bob", active: true },
      { id: "u3", name: "Cara", active: false },
    ]);
  });

  it("does not duplicate a member who is both active and currently assigned", () => {
    const result = mergeAssigneeMembers(active, [{ id: "u1", name: "Alice" }]);
    expect(result).toEqual(active);
  });

  it("returns the active list unchanged when no assignee is inactive", () => {
    const result = mergeAssigneeMembers(active, [
      { id: "u1", name: "Alice" },
      { id: "u2", name: "Bob" },
    ]);
    expect(result).toEqual(active);
  });

  it("preserves the active order first, then appends deactivated assignees in their given order", () => {
    const result = mergeAssigneeMembers(active, [
      { id: "u4", name: "Dana" },
      { id: "u3", name: "Cara" },
    ]);
    expect(result.map((m) => m.id)).toEqual(["u1", "u2", "u4", "u3"]);
  });

  it("returns an empty list for no active members and no assignees", () => {
    expect(mergeAssigneeMembers([], [])).toEqual([]);
  });
});

describe("parseTaskStatusFilter", () => {
  it('maps "IN_PROGRESS" to IN_PROGRESS', () => {
    expect(parseTaskStatusFilter("IN_PROGRESS")).toBe("IN_PROGRESS");
  });

  it('maps "ALL" to "ALL"', () => {
    expect(parseTaskStatusFilter("ALL")).toBe("ALL");
  });

  it("maps undefined to null", () => {
    expect(parseTaskStatusFilter(undefined)).toBeNull();
  });

  it("maps an unrecognised value to null rather than throwing", () => {
    expect(() => parseTaskStatusFilter("BLOCKED")).not.toThrow();
    expect(parseTaskStatusFilter("BLOCKED")).toBeNull();
  });

  it("takes the first entry of an array-valued searchParam", () => {
    expect(parseTaskStatusFilter(["DONE", "TO_DO"])).toBe("DONE");
  });
});
