import { describe, it, expect } from "vitest";
import {
  PROJECT_STATUS_LABEL,
  PROJECT_HEALTH_LABEL,
  PROJECT_HEALTH_BADGE,
  projectSchema,
  milestoneSchema,
  isProjectActive,
  projectColorIndex,
  projectListSummary,
  projectRowSubtitle,
  parseHealthFilter,
} from "@/lib/project";

const validProject = {
  name: "Brand Guidelines v3",
  description: "Refresh the identity system.",
  status: "IN_PROGRESS",
  health: "ON_TRACK",
  startDate: "2026-06-01",
  dueDate: "2026-08-14",
};

describe("projectSchema", () => {
  it("rejects a blank name", () => {
    const parsed = projectSchema.safeParse({ ...validProject, name: "  " });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toBe("Project name is required");
  });

  it("rejects a due date before the start date", () => {
    const parsed = projectSchema.safeParse({
      ...validProject,
      startDate: "2026-08-14",
      dueDate: "2026-06-01",
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toBe("Due date cannot be before the start date");
  });

  it("accepts both dates absent and only one present", () => {
    expect(projectSchema.safeParse({ ...validProject, startDate: "", dueDate: "" }).success).toBe(true);
    expect(projectSchema.safeParse({ ...validProject, startDate: "", dueDate: "2026-08-14" }).success).toBe(true);
    expect(projectSchema.safeParse({ ...validProject, startDate: "2026-06-01", dueDate: "" }).success).toBe(true);
  });
});

describe("milestoneSchema", () => {
  it("requires a title", () => {
    const parsed = milestoneSchema.safeParse({ title: "   ", dueDate: "" });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toBe("Milestone title is required");
  });

  it("accepts an empty due date", () => {
    expect(milestoneSchema.safeParse({ title: "Launch & QA", dueDate: "" }).success).toBe(true);
  });

  it("trims the title", () => {
    const parsed = milestoneSchema.safeParse({ title: "  Launch & QA  ", dueDate: "" });
    expect(parsed.data?.title).toBe("Launch & QA");
  });
});

describe("project vocabulary", () => {
  it("labels project statuses as Planning, In Progress, On Hold and Done", () => {
    expect(PROJECT_STATUS_LABEL).toEqual({
      PLANNING: "Planning",
      IN_PROGRESS: "In Progress",
      ON_HOLD: "On Hold",
      DONE: "Done",
    });
  });

  it("labels health as On Track, At Risk and Blocked", () => {
    expect(PROJECT_HEALTH_LABEL).toEqual({
      ON_TRACK: "On Track",
      AT_RISK: "At Risk",
      BLOCKED: "Blocked",
    });
  });

  it("maps ON_TRACK, AT_RISK and BLOCKED to the ok, warn and bad badge kinds", () => {
    expect(PROJECT_HEALTH_BADGE).toEqual({ ON_TRACK: "ok", AT_RISK: "warn", BLOCKED: "bad" });
  });
});

describe("isProjectActive", () => {
  it("is false for DONE and true for the other three", () => {
    expect(isProjectActive("DONE")).toBe(false);
    expect(isProjectActive("PLANNING")).toBe(true);
    expect(isProjectActive("IN_PROGRESS")).toBe(true);
    expect(isProjectActive("ON_HOLD")).toBe(true);
  });
});

describe("projectColorIndex", () => {
  it("is stable for the same id across calls", () => {
    expect(projectColorIndex("clx123")).toBe(projectColorIndex("clx123"));
  });

  it("always returns a value between 1 and 6 across 200 sample ids", () => {
    for (let i = 0; i < 200; i++) {
      const index = projectColorIndex(`project-${i}`);
      expect(index).toBeGreaterThanOrEqual(1);
      expect(index).toBeLessThanOrEqual(6);
    }
  });

  it("differs for at least two of three sample ids", () => {
    const indexes = [projectColorIndex("p1"), projectColorIndex("p2"), projectColorIndex("p3")];
    expect(new Set(indexes).size).toBeGreaterThan(1);
  });
});

describe("projectListSummary", () => {
  it('reads "6 active projects across 5 clients"', () => {
    const rows = [
      { status: "IN_PROGRESS", clientId: "c1" },
      { status: "IN_PROGRESS", clientId: "c2" },
      { status: "PLANNING", clientId: "c3" },
      { status: "ON_HOLD", clientId: "c4" },
      { status: "PLANNING", clientId: "c5" },
      { status: "IN_PROGRESS", clientId: "c1" },
    ];
    expect(projectListSummary(rows)).toBe("6 active projects across 5 clients");
  });

  it("counts only non-DONE projects and counts distinct clients across that same filtered set", () => {
    const rows = [
      { status: "IN_PROGRESS", clientId: "c1" },
      { status: "DONE", clientId: "c2" },
      { status: "DONE", clientId: "c3" },
    ];
    expect(projectListSummary(rows)).toBe("1 active project across 1 client");
  });

  it('reads "No projects yet" for an empty list', () => {
    expect(projectListSummary([])).toBe("No projects yet");
  });
});

describe("projectRowSubtitle", () => {
  it('reads "3 milestones · due 14 Aug"', () => {
    expect(
      projectRowSubtitle({ milestoneCount: 3, dueDate: new Date("2026-08-14T12:00:00.000Z") })
    ).toBe("3 milestones · due 14 Aug");
  });

  it('reads "1 milestone" when there is no due date', () => {
    expect(projectRowSubtitle({ milestoneCount: 1, dueDate: null })).toBe("1 milestone");
  });

  it('reads "No milestones · due 14 Aug" for a project with none', () => {
    expect(
      projectRowSubtitle({ milestoneCount: 0, dueDate: new Date("2026-08-14T12:00:00.000Z") })
    ).toBe("No milestones · due 14 Aug");
  });
});

describe("parseHealthFilter", () => {
  it('maps "AT_RISK" to AT_RISK', () => {
    expect(parseHealthFilter("AT_RISK")).toBe("AT_RISK");
  });

  it("maps undefined to null", () => {
    expect(parseHealthFilter(undefined)).toBeNull();
  });

  it("maps an unrecognised value to null rather than throwing", () => {
    expect(() => parseHealthFilter("ON_FIRE")).not.toThrow();
    expect(parseHealthFilter("ON_FIRE")).toBeNull();
  });

  it("takes the first entry of an array-valued searchParam", () => {
    expect(parseHealthFilter(["BLOCKED", "AT_RISK"])).toBe("BLOCKED");
  });
});
