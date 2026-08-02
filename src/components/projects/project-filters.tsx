"use client";

import {
  PROJECT_HEALTHS,
  PROJECT_HEALTH_LABEL,
  PROJECT_STATUSES,
  PROJECT_STATUS_LABEL,
  type ProjectHealth,
  type StatusFilter,
} from "@/lib/project";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";

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
      {/* Labels the row as a filter set without spending a word on it — the
          two selects already say what they filter. */}
      <Icon name="filter_list" size="sm" className="text-[var(--text-3)]" />
      <SelectField
        size="sm"
        name="status"
        defaultValue={status ?? ""}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
      >
        <option value="">Active projects</option>
        <option value="ALL">All statuses</option>
        {PROJECT_STATUSES.map((s) => (
          <option key={s} value={s}>
            {PROJECT_STATUS_LABEL[s]}
          </option>
        ))}
      </SelectField>

      <SelectField
        size="sm"
        name="health"
        defaultValue={health ?? ""}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
      >
        <option value="">All health</option>
        {PROJECT_HEALTHS.map((h) => (
          <option key={h} value={h}>
            {PROJECT_HEALTH_LABEL[h]}
          </option>
        ))}
      </SelectField>

      <noscript>
        <Button type="submit">Filter</Button>
      </noscript>
    </form>
  );
}
