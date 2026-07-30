import { describe, it, expect } from "vitest";
import {
  sortMilestones,
  milestoneStates,
  milestoneMetaLabel,
  milestoneStateDot,
  milestoneCounts,
  nextMilestoneOrder,
} from "@/lib/milestones";

const NOON = "T12:00:00.000Z";
const now = new Date(`2026-07-30${NOON}`);

function ms(
  order: number,
  overrides: Partial<{ createdAt: Date; dueDate: Date | null; completedAt: Date | null }> = {}
) {
  return {
    order,
    createdAt: new Date(`2026-01-0${order + 1}${NOON}`),
    dueDate: null,
    completedAt: null,
    ...overrides,
  };
}

describe("sortMilestones", () => {
  it("orders by order then createdAt on ties", () => {
    const a = { order: 1, createdAt: new Date(`2026-01-02${NOON}`), id: "a" };
    const b = { order: 0, createdAt: new Date(`2026-01-03${NOON}`), id: "b" };
    const c = { order: 1, createdAt: new Date(`2026-01-01${NOON}`), id: "c" };
    expect(sortMilestones([a, b, c]).map((m) => m.id)).toEqual(["b", "c", "a"]);
  });
});

describe("milestoneStates", () => {
  it("marks the lowest-ordered incomplete milestone in_progress and later incompletes not_started", () => {
    const states = milestoneStates([ms(0), ms(1), ms(2)], now).map((m) => m.state);
    expect(states).toEqual(["in_progress", "not_started", "not_started"]);
  });

  it("reproduces the design's four-row fixture as completed, completed, in_progress, not_started", () => {
    const rows = [
      ms(0, { completedAt: new Date(`2026-06-12${NOON}`) }),
      ms(1, { completedAt: new Date(`2026-07-03${NOON}`) }),
      ms(2, { dueDate: new Date(`2026-08-14${NOON}`) }),
      ms(3, { dueDate: new Date(`2026-08-29${NOON}`) }),
    ];
    expect(milestoneStates(rows, now).map((m) => m.state)).toEqual([
      "completed",
      "completed",
      "in_progress",
      "not_started",
    ]);
  });

  it("reports no in_progress when every milestone is complete", () => {
    const rows = [
      ms(0, { completedAt: new Date(`2026-06-12${NOON}`) }),
      ms(1, { completedAt: new Date(`2026-07-03${NOON}`) }),
    ];
    expect(milestoneStates(rows, now).map((m) => m.state)).toEqual(["completed", "completed"]);
  });

  it("still reads completed for a milestone finished out of order, and still marks the lowest-order incomplete one in_progress", () => {
    const rows = [
      ms(0),
      ms(1, { completedAt: new Date(`2026-07-03${NOON}`) }),
      ms(2),
    ];
    expect(milestoneStates(rows, now).map((m) => m.state)).toEqual([
      "in_progress",
      "completed",
      "not_started",
    ]);
  });

  it("returns an empty array for no milestones", () => {
    expect(milestoneStates([], now)).toEqual([]);
  });

  it("flags overdue only when the due date is past and completedAt is null", () => {
    const rows = [
      ms(0, { dueDate: new Date(`2026-07-01${NOON}`) }),
      ms(1, { dueDate: new Date(`2026-07-01${NOON}`), completedAt: new Date(`2026-06-30${NOON}`) }),
      ms(2, { dueDate: new Date(`2026-08-14${NOON}`) }),
    ];
    expect(milestoneStates(rows, now).map((m) => m.overdue)).toEqual([true, false, false]);
  });
});

describe("milestoneMetaLabel", () => {
  it('reads "Completed 12 Jun"', () => {
    expect(
      milestoneMetaLabel({
        state: "completed",
        dueDate: new Date(`2026-08-14${NOON}`),
        completedAt: new Date(`2026-06-12${NOON}`),
      })
    ).toBe("Completed 12 Jun");
  });

  it('reads "In progress · due 14 Aug"', () => {
    expect(
      milestoneMetaLabel({
        state: "in_progress",
        dueDate: new Date(`2026-08-14${NOON}`),
        completedAt: null,
      })
    ).toBe("In progress · due 14 Aug");
  });

  it('reads "Not started · due 29 Aug"', () => {
    expect(
      milestoneMetaLabel({
        state: "not_started",
        dueDate: new Date(`2026-08-29${NOON}`),
        completedAt: null,
      })
    ).toBe("Not started · due 29 Aug");
  });

  it("omits the due clause when there is no due date", () => {
    expect(milestoneMetaLabel({ state: "in_progress", dueDate: null, completedAt: null })).toBe("In progress");
    expect(milestoneMetaLabel({ state: "not_started", dueDate: null, completedAt: null })).toBe("Not started");
  });
});

describe("milestoneStateDot", () => {
  it("maps completed, in_progress and not_started to the ok, strong and mute dots", () => {
    expect(milestoneStateDot("completed")).toBe("ok");
    expect(milestoneStateDot("in_progress")).toBe("strong");
    expect(milestoneStateDot("not_started")).toBe("mute");
  });
});

describe("milestoneCounts", () => {
  it("counts milestones with a completedAt as complete", () => {
    expect(
      milestoneCounts([
        { completedAt: new Date(`2026-06-12${NOON}`) },
        { completedAt: null },
        { completedAt: new Date(`2026-07-03${NOON}`) },
      ])
    ).toEqual({ completed: 2, total: 3 });
  });
});

describe("nextMilestoneOrder", () => {
  it("is 0 for an empty list and one more than the highest existing order otherwise", () => {
    expect(nextMilestoneOrder([])).toBe(0);
    expect(nextMilestoneOrder([{ order: 0 }, { order: 4 }, { order: 2 }])).toBe(5);
  });
});
