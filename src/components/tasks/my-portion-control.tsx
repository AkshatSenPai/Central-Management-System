"use client";

import { useState } from "react";
import { markMyPortionAction } from "@/server/actions/tasks";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/form-error";
import { Icon } from "@/components/ui/icon";

/** "My part done" for one person on a shared task.
 *
 * Same fire-and-forget shape as TaskStatusControl: a plain async call with its
 * own try/catch, never a useActionState reducer.
 *
 * **The vocabulary is "part", never "complete" or "finished".** Those words
 * belong to the task, and the entire difficulty of this feature is that a
 * portion being finished is not the task being finished.
 *
 * Renders nothing for a solo task — the caller decides with `canMarkPortion`,
 * because on a task with one assignee the status dropdown already does this and
 * two controls meaning the same thing is how people learn to distrust both. */
export function MyPortionControl({
  taskId,
  projectId,
  clientId,
  done,
}: {
  taskId: string;
  projectId: string | null;
  clientId: string | null;
  done: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function run(formData: FormData) {
    setError(null);
    setPending(true);
    try {
      const result = await markMyPortionAction(formData);
      if (!result.ok) setError(result.error);
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
        {/* Posts the state being moved TO, so a double submit is idempotent
            rather than a toggle that races with itself. */}
        <input type="hidden" name="done" value={done ? "0" : "1"} />
        <Button
          type="submit"
          size="xs"
          variant={done ? "secondary" : "primary"}
          disabled={pending}
          className="gap-1.5 whitespace-nowrap"
        >
          {/* No icon on the undo state: the obvious glyph is not in
              ICON_NAMES, and adding one means re-subsetting the icon font for
              gates 7 and 8 to save three short words. Same call
              my-task-sort.tsx records. */}
          {done ? null : <Icon name="check_circle" size="sm" />}
          {done ? "Undo my part" : "My part done"}
        </Button>
      </form>
      {error ? <FormError message={error} size="xs" /> : null}
    </div>
  );
}
