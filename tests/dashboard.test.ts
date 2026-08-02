import { describe, it, expect } from "vitest";
import { addDays, bucketMyTasks, startOfUtcDay, todayLabel, weekStats } from "@/lib/dashboard";
import type { TaskListRow } from "@/lib/task-queries";

/** A fixed Wednesday afternoon. Every assertion below is relative to it, so
 * none of this depends on when the suite runs. */
const NOW = new Date("2026-07-29T14:30:00.000Z");
const TODAY = new Date("2026-07-29T00:00:00.000Z");

function task(id: string, dueDate: Date | null, extra: Partial<TaskListRow> = {}): TaskListRow {
  return {
    id,
    title: `Task ${id}`,
    status: "TO_DO",
    priority: "MEDIUM",
    dueDate,
    overdue: false,
    projectId: null,
    projectName: null,
    clientId: null,
    clientName: null,
    subtitle: "",
    assignees: [],
    ...extra,
  };
}

describe("startOfUtcDay", () => {
  it("strips the time, in UTC", () => {
    expect(startOfUtcDay(NOW).toISOString()).toBe("2026-07-29T00:00:00.000Z");
  });

  // Due dates are stored at UTC midnight by parseDateInput. Truncating in
  // local time would put a task due today into yesterday for anyone west of
  // UTC, which is the overdue bucket.
  it("does not shift the day for a late-evening UTC time", () => {
    expect(startOfUtcDay(new Date("2026-07-29T23:59:59.000Z")).toISOString()).toBe(
      "2026-07-29T00:00:00.000Z"
    );
  });
});

describe("bucketMyTasks", () => {
  const rows = [
    task("a", new Date("2026-07-27T00:00:00.000Z")), // two days late
    task("b", new Date("2026-07-28T00:00:00.000Z")), // yesterday
    task("c", TODAY), // today
    task("d", new Date("2026-07-30T00:00:00.000Z")), // tomorrow
    task("e", null), // no due date
  ];

  it("puts anything before today in overdue", () => {
    expect(bucketMyTasks(rows, NOW).overdue.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("puts only today's tasks in today", () => {
    expect(bucketMyTasks(rows, NOW).today.map((r) => r.id)).toEqual(["c"]);
  });

  // An overdue task in both lists would double the apparent workload and bury
  // the one signal the overdue callout exists to raise.
  it("keeps the two buckets disjoint", () => {
    const { overdue, today } = bucketMyTasks(rows, NOW);
    const ids = new Set(today.map((r) => r.id));
    expect(overdue.some((r) => ids.has(r.id))).toBe(false);
  });

  it("shows an undated task in neither bucket", () => {
    const { overdue, today } = bucketMyTasks(rows, NOW);
    expect([...overdue, ...today].map((r) => r.id)).not.toContain("e");
  });

  // listAssignedTasks has already applied sortMyTasks; re-sorting here would
  // silently disagree with the order the same tasks have on /my-tasks.
  it("preserves input order within a bucket", () => {
    const reversed = [rows[1], rows[0]];
    expect(bucketMyTasks(reversed, NOW).overdue.map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("handles an empty list", () => {
    expect(bucketMyTasks([], NOW)).toEqual({ overdue: [], today: [] });
  });
});

describe("weekStats", () => {
  const rows = [
    task("late", new Date("2026-07-27T00:00:00.000Z")),
    task("today", TODAY),
    task("soon", new Date("2026-08-04T00:00:00.000Z")), // day 6
    task("edge", new Date("2026-08-05T00:00:00.000Z")), // day 7 — outside
    task("undated", null),
  ];

  it("counts every open row as assigned, dated or not", () => {
    expect(weekStats(rows, 0, NOW).assigned).toBe(5);
  });

  it("counts today and the next six days as due soon", () => {
    expect(weekStats(rows, 0, NOW).dueSoon).toBe(2);
  });

  // Overdue has its own figure directly below dueSoon. Counting it in both
  // makes the two numbers disagree with their own labels.
  it("excludes overdue work from due soon", () => {
    expect(weekStats([task("late", addDays(TODAY, -1))], 0, NOW).dueSoon).toBe(0);
  });

  it("counts anything before today as overdue", () => {
    expect(weekStats(rows, 0, NOW).overdue).toBe(1);
  });

  // Task has no completedAt column and updatedAt moves on any edit, so this
  // figure is counted from the activity log and passed through untouched.
  it("passes the completed count straight through", () => {
    expect(weekStats(rows, 9, NOW).completed).toBe(9);
  });

  it("returns zeroes for an empty list", () => {
    expect(weekStats([], 0, NOW)).toEqual({
      assigned: 0,
      dueSoon: 0,
      overdue: 0,
      completed: 0,
    });
  });
});

describe("todayLabel", () => {
  it("reads as the design's subtitle", () => {
    expect(todayLabel(NOW)).toBe("Wednesday, 29 July");
  });

  it("is pinned to UTC, so a late evening does not roll to tomorrow", () => {
    expect(todayLabel(new Date("2026-07-29T23:30:00.000Z"))).toBe("Wednesday, 29 July");
  });
});

describe("addDays", () => {
  it("moves forward and back", () => {
    expect(addDays(TODAY, 7).toISOString()).toBe("2026-08-05T00:00:00.000Z");
    expect(addDays(TODAY, -7).toISOString()).toBe("2026-07-22T00:00:00.000Z");
  });
});
