"use client";

import { useState } from "react";
import { PROJECT_HEALTHS, PROJECT_HEALTH_LABEL, type ProjectHealth } from "@/lib/project";
import { setProjectHealthAction } from "@/server/actions/projects";

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
        <select
          name="health"
          defaultValue={health}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--text)]"
        >
          {PROJECT_HEALTHS.map((h) => (
            <option key={h} value={h}>
              {PROJECT_HEALTH_LABEL[h]}
            </option>
          ))}
        </select>
      </form>
      {error ? <span className="text-xs text-[var(--bad)]">{error}</span> : null}
    </div>
  );
}
