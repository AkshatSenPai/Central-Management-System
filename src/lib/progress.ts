export type ProgressMode = "AUTO" | "MANUAL";

/** Completed vs total *units*, where a unit is the finest-grained trackable
 * work item the project has. In Phase 2 that unit is the milestone; Phase 3
 * changes the provider that fills this shape, not the shape itself. */
export type ProgressCounts = { completed: number; total: number };

export type ProgressView = {
  percent: number;
  mode: ProgressMode;
  /** False only for AUTO with zero units — the caller renders "—", never 0%. */
  hasUnits: boolean;
  label: string;
};

export function computeAutoPercent(counts: ProgressCounts): number {
  if (counts.total <= 0) return 0;
  return Math.round((counts.completed / counts.total) * 100);
}

export function isValidManualProgress(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 100;
}

/** The single place progress is calculated. Everything else reads ProgressView. */
export function computeProgress(
  project: { progressMode: ProgressMode; manualProgress: number | null },
  counts: ProgressCounts
): ProgressView {
  if (project.progressMode === "MANUAL") {
    const raw = project.manualProgress ?? 0;
    const percent = Math.min(100, Math.max(0, Math.round(raw)));
    return { percent, mode: "MANUAL", hasUnits: true, label: `${percent}%` };
  }
  if (counts.total <= 0) {
    return { percent: 0, mode: "AUTO", hasUnits: false, label: "—" };
  }
  const percent = computeAutoPercent(counts);
  return { percent, mode: "AUTO", hasUnits: true, label: `${percent}%` };
}
