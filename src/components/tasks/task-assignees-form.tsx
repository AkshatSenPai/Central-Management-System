"use client";

import { useActionState } from "react";
import type { ActionResult } from "@/lib/action-result";
import { setTaskAssigneesAction } from "@/server/actions/tasks";
import { AssigneePicker } from "@/components/tasks/assignee-picker";

/** The assignee set has exactly one owner on this page: this form, via
 * setTaskAssigneesAction directly — never <TaskForm>'s own embedded
 * AssigneePicker, which saves through updateTaskAction and never touches
 * assignees at all (task-service.ts). `members` must already be the union of
 * active members and the task's current assignees (computed by the page) so
 * a deactivated current assignee's box still renders checked and a save here
 * never drops them.
 *
 * `key={selectedIds.join(",")}` on <AssigneePicker> is the one addition
 * beyond "an AssigneePicker in a useActionState form": AssigneePicker's
 * checkboxes are uncontrolled, and revalidatePath re-renders this form with
 * fresh `selectedIds` after every submit (success or failure) without
 * remounting it. Without a key tied to that value, the checkboxes would keep
 * whatever DOM state React's own post-action reset happened to leave them in
 * instead of the server's actual truth. Keying by content forces a remount
 * that re-derives every checkbox from the latest `selectedIds` — the true
 * saved set on success, the unchanged pre-attempt set on failure. */
export function TaskAssigneesForm({
  taskId,
  projectId,
  clientId,
  members,
  selectedIds,
}: {
  taskId: string;
  projectId: string | null;
  clientId: string | null;
  members: Array<{ id: string; name: string; active: boolean }>;
  selectedIds: string[];
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    setTaskAssigneesAction,
    null
  );

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="taskId" value={taskId} />
      {projectId ? <input type="hidden" name="projectId" value={projectId} /> : null}
      {clientId ? <input type="hidden" name="clientId" value={clientId} /> : null}
      <AssigneePicker key={selectedIds.join(",")} members={members} selectedIds={selectedIds} />
      {state && !state.ok ? <p className="text-xs text-[var(--bad)]">{state.error}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-[var(--btn)] px-3 py-1.5 text-sm text-[var(--on-btn)] hover:bg-[var(--btn-h)] disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save assignees"}
      </button>
    </form>
  );
}
