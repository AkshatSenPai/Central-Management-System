"use client";

import { useState } from "react";
import { PROJECT_HEALTHS, PROJECT_HEALTH_LABEL, type ProjectHealth } from "@/lib/project";
import { setProjectHealthAction } from "@/server/actions/projects";
import { SelectField } from "@/components/ui/field";
import { FormError } from "@/components/ui/form-error";

/** Health is set by a human, never derived. */
export function ProjectHealthControl({
  projectId,
  clientId,
  health,
}: {
  projectId: string;
  clientId: string;
  health: ProjectHealth;
}) {
  const [error, setError] = useState<string | null>(null);

  async function run(formData: FormData) {
    setError(null);
    try {
      const result = await setProjectHealthAction(formData);
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
          name="health"
          defaultValue={health}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
        >
          {PROJECT_HEALTHS.map((h) => (
            <option key={h} value={h}>
              {PROJECT_HEALTH_LABEL[h]}
            </option>
          ))}
        </SelectField>
      </form>
      {error ? <FormError message={error} size="xs" /> : null}
    </div>
  );
}
