"use client";

import { useState } from "react";
import { PROJECT_STATUSES, PROJECT_STATUS_LABEL, type ProjectStatus } from "@/lib/project";
import { setProjectStatusAction } from "@/server/actions/projects";
import { SelectField } from "@/components/ui/field";
import { FormError } from "@/components/ui/form-error";

/** Status is reversible from the project's own page — a project moved to Done
 * must always be able to come back. */
export function ProjectStatusControl({
  projectId,
  clientId,
  status,
}: {
  projectId: string;
  clientId: string;
  status: ProjectStatus;
}) {
  const [error, setError] = useState<string | null>(null);

  async function run(formData: FormData) {
    setError(null);
    try {
      const result = await setProjectStatusAction(formData);
      if (!result.ok) setError(result.error);
    } catch {
      setError("Something went wrong — try again");
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <form action={run}>
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="clientId" value={clientId} />
        <SelectField
          size="sm"
          name="status"
          defaultValue={status}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
        >
          {PROJECT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {PROJECT_STATUS_LABEL[s]}
            </option>
          ))}
        </SelectField>
      </form>
      {error ? <FormError message={error} size="xs" /> : null}
    </div>
  );
}
