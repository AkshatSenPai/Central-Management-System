import { describe, it, expect } from "vitest";
import { computeProgress, isValidManualProgress } from "@/lib/progress";

const AUTO = { progressMode: "AUTO" as const, manualProgress: null };

describe("computeProgress", () => {
  it("AUTO with no milestones reports no units", () => {
    expect(computeProgress(AUTO, { completed: 0, total: 0 })).toEqual({
      percent: 0,
      mode: "AUTO",
      hasUnits: false,
      label: "—",
    });
  });

  it("AUTO with 3 of 4 complete reads 75%", () => {
    expect(computeProgress(AUTO, { completed: 3, total: 4 })).toEqual({
      percent: 75,
      mode: "AUTO",
      hasUnits: true,
      label: "75%",
    });
  });

  it("rounds 1 of 3 down to 33", () => {
    expect(computeProgress(AUTO, { completed: 1, total: 3 }).percent).toBe(33);
  });

  it("rounds 2 of 3 up to 67", () => {
    expect(computeProgress(AUTO, { completed: 2, total: 3 }).percent).toBe(67);
  });

  it("reads 100 when every unit is complete", () => {
    expect(computeProgress(AUTO, { completed: 4, total: 4 })).toEqual({
      percent: 100,
      mode: "AUTO",
      hasUnits: true,
      label: "100%",
    });
  });

  it("MANUAL returns the stored value and ignores the counts", () => {
    expect(computeProgress({ progressMode: "MANUAL", manualProgress: 40 }, { completed: 4, total: 4 })).toEqual({
      percent: 40,
      mode: "MANUAL",
      hasUnits: true,
      label: "40%",
    });
  });

  it("MANUAL with no stored value reads 0 but still reports units", () => {
    expect(computeProgress({ progressMode: "MANUAL", manualProgress: null }, { completed: 0, total: 0 })).toEqual({
      percent: 0,
      mode: "MANUAL",
      hasUnits: true,
      label: "0%",
    });
  });

  it("clamps an out-of-range stored manualProgress into 0..100", () => {
    expect(computeProgress({ progressMode: "MANUAL", manualProgress: 150 }, { completed: 0, total: 0 }).percent).toBe(100);
    expect(computeProgress({ progressMode: "MANUAL", manualProgress: -5 }, { completed: 0, total: 0 }).percent).toBe(0);
  });
});

describe("isValidManualProgress", () => {
  it("rejects 101, -1 and 33.5", () => {
    expect(isValidManualProgress(101)).toBe(false);
    expect(isValidManualProgress(-1)).toBe(false);
    expect(isValidManualProgress(33.5)).toBe(false);
  });

  it("accepts 0 and 100", () => {
    expect(isValidManualProgress(0)).toBe(true);
    expect(isValidManualProgress(100)).toBe(true);
  });
});
