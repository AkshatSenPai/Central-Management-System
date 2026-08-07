"use client";

import type { ReactNode } from "react";
import {
  TASK_STATUSES,
  TASK_STATUS_LABEL,
  type TaskStatusFilter as TaskStatusFilterValue,
} from "@/lib/task";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";

/** Copy of ProjectFilters for the single task-status axis: a GET form whose
 * select submits itself on change, plus a <noscript> fallback button.
 *
 * `children` exists so a page with a second axis — /my-tasks' sort picker —
 * can put its control **inside this same form**. That is not a style
 * preference. A GET form submits only its own fields, so two sibling forms
 * would each drop the other's parameter: changing the sort would silently
 * reset the status filter back to Open tasks, and changing the status would
 * silently reset the sort. One form, both params, every submit. */
export function TaskStatusFilter({
  status,
  children,
}: {
  status: TaskStatusFilterValue | null;
  children?: ReactNode;
}) {
  return (
    <form method="get" className="flex flex-wrap items-center gap-2">
      <Icon name="filter_list" size="sm" className="text-[var(--text-3)]" />
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

      {children}

      <noscript>
        <Button type="submit">Filter</Button>
      </noscript>
    </form>
  );
}
