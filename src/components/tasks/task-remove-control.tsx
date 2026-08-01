"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { removeTaskAction } from "@/server/actions/tasks";
import { Button } from "@/components/ui/button";

/** Same fire-and-forget shape as Checklist's `run` — a plain async call with
 * its own try/catch, never a useActionState reducer. Deletion has no form
 * state worth preserving on failure, so there's nothing to remount; on
 * success the task no longer exists, so this navigates away itself instead
 * of relying on revalidatePath to re-render a page whose data is gone. */
export function TaskRemoveControl({
  taskId,
  projectId,
  clientId,
}: {
  taskId: string;
  projectId: string | null;
  clientId: string | null;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const router = useRouter();

  async function run(formData: FormData) {
    setError(null);
    setPending(true);
    try {
      const result = await removeTaskAction(formData);
      if (!result.ok) setError(result.error);
      else router.push("/my-tasks");
    } catch {
      setError("Something went wrong — try again");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <form action={run}>
        <input type="hidden" name="taskId" value={taskId} />
        {projectId ? <input type="hidden" name="projectId" value={projectId} /> : null}
        {clientId ? <input type="hidden" name="clientId" value={clientId} /> : null}
        <Button type="submit" disabled={pending}>
          Remove
        </Button>
      </form>
      {error ? <span className="text-xs text-[var(--bad)]">{error}</span> : null}
    </div>
  );
}
