"use client";

import {
  TASK_STATUSES,
  TASK_STATUS_LABEL,
  type TaskStatusFilter as TaskStatusFilterValue,
} from "@/lib/task";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/field";

/** Copy of ProjectFilters for the single task-status axis: a GET form whose
 * select submits itself on change, plus a <noscript> fallback button. */
export function TaskStatusFilter({ status }: { status: TaskStatusFilterValue | null }) {
  return (
    <form method="get" className="flex flex-wrap items-center gap-2">
      <SelectField
        size="sm"
        name="status"
        defaultValue={status ?? ""}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
      >
        <option value="">Open tasks</option>
        <option value="ALL">All statuses</option>
        {TASK_STATUSES.map((s) => (
          <option key={s} value={s}>
            {TASK_STATUS_LABEL[s]}
          </option>
        ))}
      </SelectField>

      <noscript>
        <Button type="submit">Filter</Button>
      </noscript>
    </form>
  );
}
