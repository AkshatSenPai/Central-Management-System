"use client";

import { useState } from "react";
import { PROJECT_STATUSES, PROJECT_STATUS_LABEL, type ProjectStatus } from "@/lib/project";
import { setProjectStatusAction } from "@/server/actions/projects";

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
        <select
          name="status"
          defaultValue={status}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--text)]"
        >
          {PROJECT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {PROJECT_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </form>
      {error ? <span className="text-xs text-[var(--bad)]">{error}</span> : null}
    </div>
  );
}
