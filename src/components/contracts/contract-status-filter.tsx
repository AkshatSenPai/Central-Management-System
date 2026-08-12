"use client";

import { CONTRACT_STATUSES, CONTRACT_STATUS_LABEL, type ContractStatus } from "@/lib/contract";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";

/** The same GET-form-that-submits-itself shape as the feedback and task
 * filters, `<noscript>` fallback included. */
export function ContractStatusFilter({ active }: { active: ContractStatus | null }) {
  return (
    <form method="get" className="flex flex-wrap items-center gap-2">
      <Icon name="filter_list" size="sm" className="text-[var(--text-3)]" />
      <SelectField
        size="sm"
        name="status"
        defaultValue={active ?? ""}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
      >
        <option value="">Every contract</option>
        {CONTRACT_STATUSES.map((s) => (
          <option key={s} value={s}>
            {CONTRACT_STATUS_LABEL[s]}
          </option>
        ))}
      </SelectField>

      <noscript>
        <Button type="submit">Filter</Button>
      </noscript>
    </form>
  );
}
