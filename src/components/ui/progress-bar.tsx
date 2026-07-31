import type { ProgressView } from "@/lib/progress";

/** The fill is always --text-2, never a health colour: the badge carries
 * health, the bar carries only completion. */
export function ProgressBar({
  view,
  size = "sm",
  showLabel = true,
}: {
  view: ProgressView;
  size?: "sm" | "md";
  /** Rows want the compact "50%"; project detail renders the longer
   * "50% complete" itself and turns this off to avoid saying it twice. */
  showLabel?: boolean;
}) {
  // AUTO with zero units renders "—" and no bar at all — showing 0% would
  // read as "nothing done" rather than "nothing to measure yet".
  if (!view.hasUnits) {
    return (
      <div className="flex flex-col gap-0.5">
        <span className="text-[11.5px] font-semibold text-[var(--text-2)]">{view.label}</span>
        <span className="text-[11px] text-[var(--text-3)]">
          Add tasks or set progress manually
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
      {showLabel ? (
        <span className="w-8 text-right text-[11.5px] font-semibold text-[var(--text-2)]">
          {view.label}
        </span>
      ) : null}
    </div>
  );
}
