"use client";

import {
  PROJECT_HEALTHS,
  PROJECT_HEALTH_LABEL,
  PROJECT_STATUSES,
  PROJECT_STATUS_LABEL,
  type ProjectHealth,
  type StatusFilter,
} from "@/lib/project";

const SELECT =
  "rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--text)]";

/**
 * One GET form for both filters, so changing either keeps the other — two
 * separate forms would silently drop each other's search param.
 */
export function ProjectFilters({
  health,
  status,
}: {
  health: ProjectHealth | null;
  status: StatusFilter | null;
}) {
  return (
    <form method="get" className="flex flex-wrap items-center gap-2">
      <select
        name="status"
        defaultValue={status ?? ""}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className={SELECT}
      >
        <option value="">Active projects</option>
        <option value="ALL">All statuses</option>
        {PROJECT_STATUSES.map((s) => (
          <option key={s} value={s}>
            {PROJECT_STATUS_LABEL[s]}
          </option>
        ))}
      </select>

      <select
        name="health"
        defaultValue={health ?? ""}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className={SELECT}
      >
        <option value="">All health</option>
        {PROJECT_HEALTHS.map((h) => (
          <option key={h} value={h}>
            {PROJECT_HEALTH_LABEL[h]}
          </option>
        ))}
      </select>

      <noscript>
        <button
          type="submit"
          className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text-2)]"
        >
          Filter
        </button>
      </noscript>
    </form>
  );
}
