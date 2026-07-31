"use client";

import {
  TASK_STATUSES,
  TASK_STATUS_LABEL,
  type TaskStatusFilter as TaskStatusFilterValue,
} from "@/lib/task";

const SELECT =
  "rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--text)]";

/** Copy of ProjectFilters for the single task-status axis: a GET form whose
 * select submits itself on change, plus a <noscript> fallback button. */
export function TaskStatusFilter({ status }: { status: TaskStatusFilterValue | null }) {
  return (
    <form method="get" className="flex flex-wrap items-center gap-2">
      <select
        name="status"
        defaultValue={status ?? ""}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className={SELECT}
      >
        <option value="">Open tasks</option>
        <option value="ALL">All statuses</option>
        {TASK_STATUSES.map((s) => (
          <option key={s} value={s}>
            {TASK_STATUS_LABEL[s]}
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
