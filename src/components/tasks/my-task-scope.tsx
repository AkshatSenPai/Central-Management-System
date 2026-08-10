"use client";

import { SelectField } from "@/components/ui/field";
import { MY_TASK_SCOPE_ALL, MY_TASK_SCOPE_CLIENT, MY_TASK_SCOPE_PERSONAL } from "@/lib/task";

/** The /my-tasks scope picker. Renders **inside** `<TaskStatusFilter>`'s form
 * as its children, never as a form of its own — a second GET form submits only
 * its own fields and would silently reset the status and the sort. Third
 * control on that seam; see the note in task-status-filter.tsx.
 *
 * `defaultValue` resolves null to "ALL" rather than "", for the reason
 * my-task-sort.tsx records: a defaultValue matching no option makes React fall
 * back to the first one while the URL still says otherwise, and the rendered
 * value and the parsed value must not be able to disagree.
 *
 * Labelled with a word, not an icon — no suitable glyph is in ICON_NAMES, and
 * adding one means re-subsetting the icon font for gates 7 and 8. */
export function MyTaskScope({
  scope,
  projects,
}: {
  scope: string | null;
  projects: Array<{ id: string; name: string; clientName: string }>;
}) {
  return (
    <>
      <label htmlFor="my-task-scope" className="text-xs text-[var(--text-3)]">
        Show
      </label>
      <SelectField
        id="my-task-scope"
        size="sm"
        name="scope"
        defaultValue={scope ?? MY_TASK_SCOPE_ALL}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
      >
        <option value={MY_TASK_SCOPE_ALL}>All work</option>
        <option value={MY_TASK_SCOPE_CLIENT}>Client work</option>
        <option value={MY_TASK_SCOPE_PERSONAL}>Personal</option>
        {projects.length > 0 ? (
          <optgroup label="Project">
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.clientName} · {p.name}
              </option>
            ))}
          </optgroup>
        ) : null}
      </SelectField>
    </>
  );
}
