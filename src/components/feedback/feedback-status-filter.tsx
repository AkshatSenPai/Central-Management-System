"use client";

import {
  FEEDBACK_STATUSES,
  FEEDBACK_STATUS_LABEL,
  type FeedbackStatusFilter as FeedbackStatusFilterValue,
} from "@/lib/feedback";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";

/** The same GET-form-that-submits-itself shape as <TaskStatusFilter>, with a
 * <noscript> fallback. One axis only, so no children hatch is needed here. */
export function FeedbackStatusFilter({ status }: { status: FeedbackStatusFilterValue | null }) {
  return (
    <form method="get" className="flex flex-wrap items-center gap-2">
      <Icon name="filter_list" size="sm" className="text-[var(--text-3)]" />
      <SelectField
        size="sm"
        name="status"
        defaultValue={status ?? ""}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
      >
        <option value="">All feedback</option>
        {FEEDBACK_STATUSES.map((s) => (
          <option key={s} value={s}>
            {FEEDBACK_STATUS_LABEL[s]}
          </option>
        ))}
      </SelectField>

      <noscript>
        <Button type="submit">Filter</Button>
      </noscript>
    </form>
  );
}
