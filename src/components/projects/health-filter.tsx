"use client";

import { PROJECT_HEALTHS, PROJECT_HEALTH_LABEL, type ProjectHealth } from "@/lib/project";

/** A plain GET form: filtering happens server-side, so the choice survives a
 * reload and is shareable as a URL. */
export function HealthFilter({ value }: { value: ProjectHealth | null }) {
  return (
    <form method="get">
      <select
        name="health"
        defaultValue={value ?? ""}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--text)]"
      >
        <option value="">All health</option>
        {PROJECT_HEALTHS.map((health) => (
          <option key={health} value={health}>
            {PROJECT_HEALTH_LABEL[health]}
          </option>
        ))}
      </select>
      <noscript>
        <button
          type="submit"
          className="ml-2 rounded-md border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text-2)]"
        >
          Filter
        </button>
      </noscript>
    </form>
  );
}
