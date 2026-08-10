"use client";

import { useRef, useState } from "react";
import { TASK_STATUSES, TASK_STATUS_LABEL, type TaskStatus } from "@/lib/task";
import { setTaskStatusAction } from "@/server/actions/tasks";
import { SelectField } from "@/components/ui/field";
import { FormError } from "@/components/ui/form-error";

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
  const formRef = useRef<HTMLFormElement>(null);

  async function run(formData: FormData) {
    setError(null);
    try {
      let result = await setTaskStatusAction(formData);

      // The move did not land; an admin may confirm and retry. Asking here
      // rather than server-side is what makes the override a deliberate act
      // — the server re-reads the role on the retry, so this prompt grants
      // nothing on its own.
      if (!result.ok && result.needsOverride) {
        if (!window.confirm(result.error)) {
          // Nothing was written, so the <select> is showing a status the task
          // does not have. reset() restores it to defaultValue.
          formRef.current?.reset();
          return;
        }
        formData.set("override", "1");
        result = await setTaskStatusAction(formData);
      }

      if (!result.ok) {
        setError(result.error);
        // Same reason: a refused move leaves the select on the value the
        // server rejected. revalidatePath cannot fix it, because the status
        // is unchanged so `key` is unchanged and the field never remounts.
        formRef.current?.reset();
      }
    } catch {
      setError("Something went wrong — try again");
      formRef.current?.reset();
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <form action={run} ref={formRef}>
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
      {error ? <FormError message={error} size="xs" /> : null}
    </div>
  );
}
