import type { WeekStats } from "@/lib/dashboard";

/** The four figures are `--mono` — the one place in the app where numbers sit
 * in a right-aligned column and have to line up down the card. Tabular
 * numerals on body get the widths equal; the monospace face is what makes
 * them read as measurements rather than prose. */
function Stat({ label, value, tone }: { label: string; value: number; tone?: "bad" | "ok" }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[12.5px] text-[var(--text-2)]">{label}</span>
      <span
        className={`mono text-[15px] font-bold ${
          tone === "bad"
            ? "text-[var(--bad)]"
            : tone === "ok"
              ? "text-[var(--ok)]"
              : "text-[var(--text)]"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

export function WeekStatsCard({ stats }: { stats: WeekStats }) {
  return (
    <section className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-3.5 shadow-[var(--shadow)]">
      <h2 className="mb-3 text-[13.5px] font-bold tracking-[-0.01em] text-[var(--text)]">
        This week
      </h2>
      <div className="flex flex-col gap-[11px]">
        <Stat label="Assigned to me" value={stats.assigned} />
        <span aria-hidden="true" className="block h-px bg-[var(--border)]" />
        <Stat label="Due in 7 days" value={stats.dueSoon} />
        <span aria-hidden="true" className="block h-px bg-[var(--border)]" />
        {/* Coloured only when non-zero. A red 0 is a warning about the
            absence of a problem. */}
        <Stat label="Overdue" value={stats.overdue} tone={stats.overdue > 0 ? "bad" : undefined} />
        <span aria-hidden="true" className="block h-px bg-[var(--border)]" />
        <Stat
          label="Completed"
          value={stats.completed}
          tone={stats.completed > 0 ? "ok" : undefined}
        />
      </div>
    </section>
  );
}
