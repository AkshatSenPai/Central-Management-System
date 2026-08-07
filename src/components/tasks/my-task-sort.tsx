"use client";

import { MY_TASK_SORTS, MY_TASK_SORT_LABEL, type MyTaskSort } from "@/lib/task";
import { SelectField } from "@/components/ui/field";

/** The /my-tasks sort picker. Renders **inside** <TaskStatusFilter>'s form as
 * its children, never as a form of its own — see the note there for why two
 * GET forms would silently reset each other's parameter.
 *
 * `defaultValue` resolves null to "DUE_DATE" rather than "" because every
 * option here carries a real value. A defaultValue matching no option makes
 * React fall back to the first one while the URL still says otherwise, which
 * is precisely the divergence that shipped Low-priority quick-adds and nearly
 * reopened finished projects. Resolving it here means the rendered value and
 * the parsed value cannot disagree.
 *
 * Labelled with a word rather than an icon. The obvious glyph, `swap_vert`,
 * is not in `ICON_NAMES` and adding it would mean re-subsetting the icon font
 * (gates 7 and 8) for one control — and next to the status select, which
 * already carries `filter_list`, two unlabelled dropdowns are genuinely
 * ambiguous. The word is both cheaper and clearer. */
export function MyTaskSort({ sort }: { sort: MyTaskSort | null }) {
  return (
    <>
      <label htmlFor="my-task-sort" className="text-xs text-[var(--text-3)]">
        Sort
      </label>
      <SelectField
        id="my-task-sort"
        size="sm"
        name="sort"
        defaultValue={sort ?? "DUE_DATE"}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
      >
        {MY_TASK_SORTS.map((s) => (
          <option key={s} value={s}>
            {MY_TASK_SORT_LABEL[s]}
          </option>
        ))}
      </SelectField>
    </>
  );
}
