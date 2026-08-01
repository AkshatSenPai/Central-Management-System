"use client";

import { useState } from "react";
import { TASK_STATUSES, TASK_STATUS_LABEL, type TaskStatus } from "@/lib/task";
import { setTaskStatusAction } from "@/server/actions/tasks";
import { SelectField } from "@/components/ui/field";

/** Status is set by a human, never derived — same fire-and-forget shape as
 * ProjectHealthControl. projectId/clientId are only present for a task that
 * belongs to a project; a personal task submits neither. */
export function TaskStatusControl({
  taskId,
  projectId,
  clientId,
  status,
}: {
  taskId: string;
  projectId: string | null;
  clientId: string | null;
  status: TaskStatus;
}) {
  const [error, setError] = useState<string | null>(null);

  async function run(formData: FormData) {
    setError(null);
    try {
      const result = await setTaskStatusAction(formData);
      if (!result.ok) setError(result.error);
    } catch {
      setError("Something went wrong — try again");
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <form action={run}>
        <input type="hidden" name="taskId" value={taskId} />
        {projectId ? <input type="hidden" name="projectId" value={projectId} /> : null}
        {clientId ? <input type="hidden" name="clientId" value={clientId} /> : null}
        <SelectField
          key={status}
          size="xs"
          name="status"
          defaultValue={status}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
        >
          {TASK_STATUSES.map((s) => (
            <option key={s} value={s}>
              {TASK_STATUS_LABEL[s]}
            </option>
          ))}
        </SelectField>
      </form>
      {error ? <span className="text-xs text-[var(--bad)]">{error}</span> : null}
    </div>
  );
}
