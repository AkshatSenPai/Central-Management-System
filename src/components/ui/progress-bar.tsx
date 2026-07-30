import type { ProgressView } from "@/lib/progress";

/** The fill is always --text-2, never a health colour: the badge carries
 * health, the bar carries only completion. */
export function ProgressBar({ view, size = "sm" }: { view: ProgressView; size?: "sm" | "md" }) {
  // AUTO with zero units renders "—" and no bar at all — showing 0% would
  // read as "nothing done" rather than "nothing to measure yet".
  if (!view.hasUnits) {
    return (
      <div className="flex flex-col gap-0.5">
        <span className="text-[11.5px] font-semibold text-[var(--text-2)]">{view.label}</span>
        <span className="text-[11px] text-[var(--text-3)]">
          Add milestones or set progress manually
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span
        className={`block ${
          size === "md" ? "h-[7px]" : "h-[5px]"
        } flex-1 overflow-hidden rounded-[3px] bg-[var(--surface-3)]`}
      >
        <span
          className="block h-full rounded-[3px] bg-[var(--text-2)]"
          style={{ width: `${view.percent}%` }}
        />
      </span>
      <span className="w-8 text-right text-[11.5px] font-semibold text-[var(--text-2)]">
        {view.label}
      </span>
    </div>
  );
}
