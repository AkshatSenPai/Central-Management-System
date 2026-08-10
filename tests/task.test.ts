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
  compareMyTasksByPriority,
  compareMyTasksByProject,
  sortMyTasksBy,
  parseMyTaskSort,
  parseMyTaskScope,
  MY_TASK_SORTS,
  MY_TASK_SORT_LABEL,
  parseTaskStatusFilter,
  mergeAssigneeMembers,
  groupTasksByStatus,
  groupTasksByAssignee,
  UNASSIGNED_GROUP_NAME,
  taskReference,
  isTaskBlocked,
  unfinishedBlockers,
  blockedChipLabel,
  blockedRefusalMessage,
  blockedMoveNeedsPermission,
  blockedOverridePrompt,
  TASK_REFERENCE_PREFIX,
  type TaskPriority,
  type TaskSortable,
  type TaskStatus,
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

  // The empty-string case above and this one are not the same case, and the
  // difference is a trap for any form shorter than <TaskForm>. Every optional
  // field is `.optional().or(z.literal(""))`, which takes undefined or "" and
  // never null — but formData.get() returns null for a field the form simply
  // omitted. So a caller that leaves these out entirely fails the whole parse
  // with a bare "Invalid input" that names no field and reads like a status
  // problem. <QuickAdd> submits all four as empty hidden inputs for exactly
  // this reason; if that ever looks like dead markup, this test is why.
  it("rejects a null description, due date, project or milestone — omitted is not empty", () => {
    for (const field of ["description", "dueDate", "projectId", "milestoneId"] as const) {
      const parsed = taskSchema.safeParse({ ...validTask, [field]: null });
      expect(parsed.success, `${field}: null should not parse`).toBe(false);
    }
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

  // My Tasks calls this as taskListSummary(rows, { filtered: status !== "ALL" }).
  // The default view (status === null) is open-only — listAssignedTasks applies
  // status: { not: "DONE" } exactly when there is no filter — so its rows can
  // never structurally contain a DONE task; only the ALL view's rows can.
  it("renders a bare count for the default My Tasks view (status null, so filtered: true), even though its rows can never contain a DONE task", () => {
    const rows = [{ status: "TO_DO" }, { status: "IN_PROGRESS" }];
    expect(taskListSummary(rows, { filtered: true })).toBe("2 tasks");
  });

  it("renders the done clause for the ALL My Tasks view (status \"ALL\", so filtered: false), the only view whose rows can contain a DONE task", () => {
    const rows = [{ status: "DONE" }, { status: "TO_DO" }];
    expect(taskListSummary(rows, { filtered: false })).toBe("2 tasks · 1 done");
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

type GroupableRow = {
  id: string;
  dueDate: Date | null;
  priority: TaskPriority;
  clientName: string | null;
  projectName: string | null;
};

function groupable(id: string, overrides: Partial<Omit<GroupableRow, "id">> = {}): GroupableRow {
  return {
    id,
    dueDate: null,
    priority: "MEDIUM",
    clientName: "Harlow & Fitch",
    projectName: "Brand Guidelines v3",
    ...overrides,
  };
}

const personal = (id: string, overrides: Partial<Omit<GroupableRow, "id">> = {}) =>
  groupable(id, { clientName: null, projectName: null, ...overrides });

describe("compareMyTasksByPriority", () => {
  it("puts a higher priority first even when it is due much later", () => {
    const urgentLater = groupable("u", { dueDate: new Date(`2026-09-01${NOON}`), priority: "URGENT" });
    const lowSooner = groupable("l", { dueDate: new Date(`2026-08-01${NOON}`), priority: "LOW" });
    expect(compareMyTasksByPriority(urgentLater, lowSooner)).toBeLessThan(0);
  });

  // The inversion of compareMyTasks' "due date is dominant" rule is the whole
  // point of offering this sort, so it is asserted directly rather than
  // inferred from an ordering.
  it("inverts compareMyTasks' precedence rather than merely re-ordering ties", () => {
    const urgentLater = groupable("u", { dueDate: new Date(`2026-09-01${NOON}`), priority: "URGENT" });
    const lowSooner = groupable("l", { dueDate: new Date(`2026-08-01${NOON}`), priority: "LOW" });
    expect(compareMyTasks(urgentLater, lowSooner)).toBeGreaterThan(0);
    expect(compareMyTasksByPriority(urgentLater, lowSooner)).toBeLessThan(0);
  });

  it("falls through to the due-date order within one priority", () => {
    const early = groupable("e", { dueDate: new Date(`2026-08-01${NOON}`), priority: "HIGH" });
    const late = groupable("l", { dueDate: new Date(`2026-08-10${NOON}`), priority: "HIGH" });
    const undated = groupable("u", { dueDate: null, priority: "HIGH" });
    expect(compareMyTasksByPriority(early, late)).toBeLessThan(0);
    expect(compareMyTasksByPriority(late, undated)).toBeLessThan(0);
  });
});

describe("compareMyTasksByProject", () => {
  it("sorts personal work after every project task, whatever its due date", () => {
    const personalUrgentToday = personal("p", {
      dueDate: new Date(`2026-08-01${NOON}`),
      priority: "URGENT",
    });
    const projectUndatedLow = groupable("w", { dueDate: null, priority: "LOW" });
    expect(compareMyTasksByProject(personalUrgentToday, projectUndatedLow)).toBeGreaterThan(0);
    expect(compareMyTasksByProject(projectUndatedLow, personalUrgentToday)).toBeLessThan(0);
  });

  it("groups by client first, then by project within a client", () => {
    const a = groupable("a", { clientName: "Alder", projectName: "Zephyr" });
    const b = groupable("b", { clientName: "Birch", projectName: "Aurora" });
    expect(compareMyTasksByProject(a, b)).toBeLessThan(0);

    const early = groupable("e", { clientName: "Alder", projectName: "Aurora" });
    expect(compareMyTasksByProject(early, a)).toBeLessThan(0);
  });

  it("falls through to the due-date order inside one project", () => {
    const early = groupable("e", { dueDate: new Date(`2026-08-01${NOON}`) });
    const late = groupable("l", { dueDate: new Date(`2026-08-10${NOON}`) });
    expect(compareMyTasksByProject(early, late)).toBeLessThan(0);
  });

  it("orders two personal tasks against each other by due date and priority", () => {
    const early = personal("e", { dueDate: new Date(`2026-08-01${NOON}`) });
    const late = personal("l", { dueDate: new Date(`2026-08-10${NOON}`) });
    const undatedUrgent = personal("u", { dueDate: null, priority: "URGENT" });
    expect(compareMyTasksByProject(early, late)).toBeLessThan(0);
    expect(compareMyTasksByProject(late, undatedUrgent)).toBeLessThan(0);
  });
});

describe("sortMyTasksBy", () => {
  const MIXED = [
    groupable("betaLate", { clientName: "Beta", projectName: "P2", dueDate: new Date(`2026-08-20${NOON}`) }),
    personal("mine", { priority: "URGENT" }),
    groupable("alphaEarly", { clientName: "Alpha", projectName: "P1", dueDate: new Date(`2026-08-02${NOON}`) }),
  ];

  it("defaults to the due-date order for null", () => {
    expect(sortMyTasksBy(MIXED, null).map((r) => r.id)).toEqual(sortMyTasks(MIXED).map((r) => r.id));
  });

  it("treats DUE_DATE as identical to the default", () => {
    expect(sortMyTasksBy(MIXED, "DUE_DATE").map((r) => r.id)).toEqual(
      sortMyTasksBy(MIXED, null).map((r) => r.id)
    );
  });

  it("puts the urgent personal task first under PRIORITY and last under PROJECT", () => {
    expect(sortMyTasksBy(MIXED, "PRIORITY")[0].id).toBe("mine");
    expect(sortMyTasksBy(MIXED, "PROJECT").at(-1)?.id).toBe("mine");
  });

  it("groups by client under PROJECT", () => {
    expect(sortMyTasksBy(MIXED, "PROJECT").map((r) => r.id)).toEqual([
      "alphaEarly",
      "betaLate",
      "mine",
    ]);
  });

  it("does not mutate the input array under any sort", () => {
    const before = MIXED.map((r) => r.id);
    sortMyTasksBy(MIXED, "PRIORITY");
    sortMyTasksBy(MIXED, "PROJECT");
    sortMyTasksBy(MIXED, null);
    expect(MIXED.map((r) => r.id)).toEqual(before);
  });
});

describe("parseMyTaskSort", () => {
  it("returns null for an absent value, so a bare URL means the default", () => {
    expect(parseMyTaskSort(undefined)).toBeNull();
    expect(parseMyTaskSort("")).toBeNull();
  });

  it("accepts every declared sort", () => {
    for (const s of MY_TASK_SORTS) expect(parseMyTaskSort(s)).toBe(s);
  });

  it("rejects an unknown value rather than throwing, falling back to the default", () => {
    expect(parseMyTaskSort("SOMETHING_ELSE")).toBeNull();
    expect(parseMyTaskSort("due_date")).toBeNull();
  });

  it("takes the first entry when the param is repeated", () => {
    expect(parseMyTaskSort(["PRIORITY", "PROJECT"])).toBe("PRIORITY");
  });

  it("labels every sort, so the picker cannot render an undefined option", () => {
    for (const s of MY_TASK_SORTS) expect(MY_TASK_SORT_LABEL[s]).toBeTruthy();
  });
});

describe("groupTasksByAssignee", () => {
  const DANA = { id: "u1", name: "Dana Reeve" };
  const OMAR = { id: "u2", name: "Omar Silva" };
  const MEMBERS = [DANA, OMAR];

  const task = (id: string, assignees: Array<{ id: string; name: string }>) => ({ id, assignees });

  it("gives every active member a group, in the order supplied", () => {
    const groups = groupTasksByAssignee([], MEMBERS);
    expect(groups.map((g) => g.id)).toEqual(["u1", "u2"]);
    expect(groups.map((g) => g.name)).toEqual(["Dana Reeve", "Omar Silva"]);
  });

  // "Nobody has anything for Dana" is a fact this page must state, not one an
  // admin should have to infer from her section being absent.
  it("keeps a member with no tasks rather than omitting them", () => {
    const groups = groupTasksByAssignee([task("t1", [DANA])], MEMBERS);
    expect(groups.find((g) => g.id === "u2")?.tasks).toEqual([]);
  });

  it("derives initials for each group", () => {
    const groups = groupTasksByAssignee([], MEMBERS);
    expect(groups.find((g) => g.id === "u1")?.initials).toBe("DR");
  });

  // Filing it under one assignee would tell the other person's section that
  // the task is not theirs, which is false.
  it("files a task with two assignees under both", () => {
    const groups = groupTasksByAssignee([task("shared", [DANA, OMAR])], MEMBERS);
    expect(groups.find((g) => g.id === "u1")?.tasks.map((t) => t.id)).toEqual(["shared"]);
    expect(groups.find((g) => g.id === "u2")?.tasks.map((t) => t.id)).toEqual(["shared"]);
  });

  it("adds a trailing Unassigned group only when some task has no assignee", () => {
    expect(groupTasksByAssignee([task("t1", [DANA])], MEMBERS).some((g) => g.id === null)).toBe(false);

    const withOrphan = groupTasksByAssignee([task("t1", [DANA]), task("orphan", [])], MEMBERS);
    const last = withOrphan.at(-1);
    expect(last?.id).toBeNull();
    expect(last?.name).toBe(UNASSIGNED_GROUP_NAME);
    expect(last?.tasks.map((t) => t.id)).toEqual(["orphan"]);
  });

  // Work stranded on a deactivated account is the single thing this page most
  // needs to surface. Dropping rows whose assignee is absent from the active
  // member list would hide it at exactly the moment it is created.
  it("keeps work assigned to a deactivated member, appended after the active ones", () => {
    const ghost = { id: "gone", name: "Priya Nair" };
    const groups = groupTasksByAssignee([task("t1", [DANA]), task("stranded", [ghost])], MEMBERS);
    expect(groups.map((g) => g.id)).toEqual(["u1", "u2", "gone"]);
    expect(groups.find((g) => g.id === "gone")?.tasks.map((t) => t.id)).toEqual(["stranded"]);
    expect(groups.find((g) => g.id === "gone")?.name).toBe("Priya Nair");
  });

  it("preserves the caller's row order inside each group", () => {
    const rows = [task("a", [DANA]), task("b", [DANA]), task("c", [DANA])];
    expect(groupTasksByAssignee(rows, MEMBERS).find((g) => g.id === "u1")?.tasks.map((t) => t.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("returns only the Unassigned group when there are no members at all", () => {
    const groups = groupTasksByAssignee([task("orphan", [])], []);
    expect(groups).toHaveLength(1);
    expect(groups[0].id).toBeNull();
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

describe("groupTasksByStatus", () => {
  const row = (id: string, status: TaskStatus) => ({ id, status });

  it("returns every status as a key even when its column is empty", () => {
    const grouped = groupTasksByStatus([row("t1", "TO_DO")]);
    expect(Object.keys(grouped).sort()).toEqual(["DONE", "IN_PROGRESS", "REVIEW", "TO_DO"]);
    expect(grouped.IN_PROGRESS).toEqual([]);
    expect(grouped.REVIEW).toEqual([]);
    expect(grouped.DONE).toEqual([]);
  });

  it("files each row under its own status", () => {
    const grouped = groupTasksByStatus([
      row("t1", "TO_DO"),
      row("t2", "DONE"),
      row("t3", "TO_DO"),
    ]);
    expect(grouped.TO_DO.map((r) => r.id)).toEqual(["t1", "t3"]);
    expect(grouped.DONE.map((r) => r.id)).toEqual(["t2"]);
  });

  // listProjectTasks already sorts [status, order, createdAt]; the board must
  // not disturb that, or the column ordering silently becomes insertion order.
  it("preserves input order within a group", () => {
    const grouped = groupTasksByStatus([
      row("c", "REVIEW"),
      row("a", "REVIEW"),
      row("b", "REVIEW"),
    ]);
    expect(grouped.REVIEW.map((r) => r.id)).toEqual(["c", "a", "b"]);
  });

  it("returns all four empty groups for an empty list", () => {
    expect(groupTasksByStatus([])).toEqual({ TO_DO: [], IN_PROGRESS: [], REVIEW: [], DONE: [] });
  });
});

describe("taskReference", () => {
  it("pads to three digits so references line up in a column", () => {
    expect(taskReference(8)).toBe("MER-008");
    expect(taskReference(24)).toBe("MER-024");
    expect(taskReference(999)).toBe("MER-999");
  });

  // Truncating past 999 would break the uniqueness the column guarantees.
  it("grows rather than truncating past three digits", () => {
    expect(taskReference(1000)).toBe("MER-1000");
  });

  it("uses the studio prefix", () => {
    expect(taskReference(1).startsWith(`${TASK_REFERENCE_PREFIX}-`)).toBe(true);
  });
});

describe("isTaskBlocked", () => {
  it("is false with no blockers at all", () => {
    expect(isTaskBlocked([])).toBe(false);
  });

  it("is false when every blocker is DONE", () => {
    expect(isTaskBlocked([{ status: "DONE" }, { status: "DONE" }])).toBe(false);
  });

  it("is true when any blocker is not DONE", () => {
    expect(isTaskBlocked([{ status: "DONE" }, { status: "REVIEW" }])).toBe(true);
  });

  // REVIEW is not DONE. Named because "nearly finished" is exactly the case
  // someone will argue should count, and it must not.
  it("treats REVIEW as unfinished", () => {
    expect(isTaskBlocked([{ status: "REVIEW" }])).toBe(true);
  });
});

describe("unfinishedBlockers", () => {
  it("keeps only what still blocks", () => {
    expect(
      unfinishedBlockers([
        { status: "DONE" as const, reference: 1 },
        { status: "TO_DO" as const, reference: 2 },
      ])
    ).toEqual([{ status: "TO_DO", reference: 2 }]);
  });
});

describe("blockedMoveNeedsPermission", () => {
  it("catches every forward move while blocked", () => {
    expect(blockedMoveNeedsPermission({ blocked: true, to: "IN_PROGRESS" })).toBe(true);
    expect(blockedMoveNeedsPermission({ blocked: true, to: "REVIEW" })).toBe(true);
    expect(blockedMoveNeedsPermission({ blocked: true, to: "DONE" })).toBe(true);
  });

  // Spec §5: parking and reopening are the two moves someone makes BECAUSE
  // they have discovered they are blocked. Refusing them would be perverse.
  it("always allows a move to TO_DO, even while blocked", () => {
    expect(blockedMoveNeedsPermission({ blocked: true, to: "TO_DO" })).toBe(false);
  });

  it("allows everything when not blocked", () => {
    expect(blockedMoveNeedsPermission({ blocked: false, to: "DONE" })).toBe(false);
  });

  // It deliberately knows nothing about roles. Refuse-vs-confirm is the
  // service's decision, and folding isAdmin in here previously hid the
  // admin's silent-success case entirely.
  it("takes no view on who is asking", () => {
    expect(blockedMoveNeedsPermission.length).toBe(1);
  });
});

describe("blockedOverridePrompt", () => {
  it("asks about one blocker", () => {
    expect(blockedOverridePrompt([{ reference: 27, status: "TO_DO" }])).toBe(
      "MER-027 isn't finished yet. Move anyway?"
    );
  });

  it("asks about several", () => {
    expect(
      blockedOverridePrompt([
        { reference: 27, status: "TO_DO" },
        { reference: 29, status: "IN_PROGRESS" },
      ])
    ).toBe("MER-027 and 1 more aren't finished yet. Move anyway?");
  });

  it("counts only the unfinished ones", () => {
    expect(
      blockedOverridePrompt([
        { reference: 27, status: "TO_DO" },
        { reference: 29, status: "DONE" },
      ])
    ).toBe("MER-027 isn't finished yet. Move anyway?");
  });
});

describe("blockedChipLabel", () => {
  it("is null when nothing unfinished blocks it", () => {
    expect(blockedChipLabel([], "TO_DO")).toBeNull();
    expect(blockedChipLabel([{ reference: 18, status: "DONE" }], "TO_DO")).toBeNull();
  });

  it("names the single blocker", () => {
    expect(blockedChipLabel([{ reference: 18, status: "TO_DO" }], "TO_DO")).toBe("Blocked by MER-018");
  });

  // The DONE one is not counted in the overflow — only unfinished blockers
  // block, so only they are described.
  it("counts only unfinished blockers in the overflow", () => {
    const label = blockedChipLabel(
      [
        { reference: 18, status: "TO_DO" },
        { reference: 22, status: "IN_PROGRESS" },
        { reference: 30, status: "DONE" },
      ],
      "TO_DO"
    );
    expect(label).toBe("Blocked by MER-018 +1");
  });

  // Never a bare "Blocked" — ProjectHealth.BLOCKED already owns that word.
  it("always names the blocker rather than saying only Blocked", () => {
    expect(blockedChipLabel([{ reference: 18, status: "TO_DO" }], "TO_DO")).not.toBe("Blocked");
  });

  // A finished task no longer asks "can I start this yet", so the chip goes
  // — even though the blocker is genuinely still unfinished. That it was
  // completed out of order lives in the activity log instead.
  it("is null on a DONE task even with an unfinished blocker", () => {
    expect(blockedChipLabel([{ reference: 27, status: "TO_DO" }], "DONE")).toBeNull();
  });

  it("still shows on IN_PROGRESS and REVIEW", () => {
    const blockers = [{ reference: 27, status: "TO_DO" as const }];
    expect(blockedChipLabel(blockers, "IN_PROGRESS")).toBe("Blocked by MER-027");
    expect(blockedChipLabel(blockers, "REVIEW")).toBe("Blocked by MER-027");
  });
});

describe("blockedRefusalMessage", () => {
  it("names one blocker and how to get past it", () => {
    expect(blockedRefusalMessage([{ reference: 18, status: "TO_DO" }])).toBe(
      "Blocked by MER-018. Finish it first, or ask an admin to override."
    );
  });

  it("pluralises past one", () => {
    expect(
      blockedRefusalMessage([
        { reference: 18, status: "TO_DO" },
        { reference: 22, status: "TO_DO" },
      ])
    ).toBe("Blocked by MER-018 and 1 more. Finish them first, or ask an admin to override.");
  });

  // A DONE blocker must not be counted in the message either.
  it("describes only the unfinished ones", () => {
    expect(
      blockedRefusalMessage([
        { reference: 18, status: "TO_DO" },
        { reference: 22, status: "DONE" },
      ])
    ).toBe("Blocked by MER-018. Finish it first, or ask an admin to override.");
  });
});

describe("parseMyTaskScope", () => {
  it("returns null for absent, empty or the all-work keyword", () => {
    expect(parseMyTaskScope(undefined)).toBeNull();
    expect(parseMyTaskScope("")).toBeNull();
    expect(parseMyTaskScope("ALL")).toBeNull();
  });

  it("passes the two keywords through", () => {
    expect(parseMyTaskScope("CLIENT")).toBe("CLIENT");
    expect(parseMyTaskScope("PERSONAL")).toBe("PERSONAL");
  });

  it("passes a project id through unchanged", () => {
    expect(parseMyTaskScope("cms7mcyt600058ku3fv20ue4l")).toBe("cms7mcyt600058ku3fv20ue4l");
  });

  it("takes the first of a repeated parameter", () => {
    expect(parseMyTaskScope(["PERSONAL", "CLIENT"])).toBe("PERSONAL");
  });
});
