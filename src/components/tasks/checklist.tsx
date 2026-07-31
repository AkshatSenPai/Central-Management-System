"use client";

import { useRef, useState } from "react";
import {
  addChecklistItemAction,
  setChecklistItemDoneAction,
  removeChecklistItemAction,
} from "@/server/actions/tasks";

type ChecklistItem = { id: string; title: string; done: boolean; order: number };

const FIELD =
  "w-full max-w-xs rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--text)]";
const BTN =
  "flex-none rounded-md border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text-2)] hover:bg-[var(--surface-2)]";

/** Same fire-and-forget shape as member-row-actions.tsx's `run` — every
 * mutation here is a plain async call with its own try/catch, never a
 * useActionState reducer. The one addition, `onSuccess`, exists only so the
 * add form can clear its own title input after a successful submit; toggle
 * and remove never pass it. */
export function Checklist({
  taskId,
  projectId,
  clientId,
  items,
}: {
  taskId: string;
  projectId: string | null;
  clientId: string | null;
  items: ChecklistItem[];
}) {
  const [error, setError] = useState<string | null>(null);
  const addFormRef = useRef<HTMLFormElement>(null);

  async function run(
    action: (fd: FormData) => Promise<{ ok: boolean; error?: string }>,
    fd: FormData,
    onSuccess?: () => void
  ) {
    setError(null);
    try {
      const result = await action(fd);
      if (!result.ok && result.error) setError(result.error);
      else if (result.ok) onSuccess?.();
    } catch {
      setError("Something went wrong — try again");
    }
  }

  return (
    <div className="space-y-3">
      {items.length === 0 ? (
        <p className="text-sm text-[var(--text-3)]">No checklist items yet.</p>
      ) : (
        <ul className="space-y-0.5">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-[var(--surface-2)]"
            >
              {/* Keyed by id+done, not just id: the checkbox below is
                  uncontrolled (defaultChecked), and revalidatePath re-renders
                  this list with the new `done` after every toggle — success
                  or failure — without remounting it. A key tied to `done`
                  forces that remount so the checkbox always reflects the
                  server's actual value instead of whatever React's own
                  post-action form reset happened to leave it showing. */}
              <form
                key={`${item.id}-${item.done}`}
                action={(fd) => run(setChecklistItemDoneAction, fd)}
                onChange={(e) => e.currentTarget.requestSubmit()}
                className="flex min-w-0 flex-1 items-center gap-2"
              >
                <input type="hidden" name="itemId" value={item.id} />
                <input type="hidden" name="taskId" value={taskId} />
                {projectId ? <input type="hidden" name="projectId" value={projectId} /> : null}
                {clientId ? <input type="hidden" name="clientId" value={clientId} /> : null}
                <input
                  type="checkbox"
                  name="done"
                  value="true"
                  defaultChecked={item.done}
                  className="h-4 w-4 flex-none rounded border-[var(--border)]"
                />
                <span
                  className={`truncate text-sm ${
                    item.done ? "text-[var(--text-3)] line-through" : "text-[var(--text)]"
                  }`}
                >
                  {item.title}
                </span>
              </form>
              <form action={(fd) => run(removeChecklistItemAction, fd)}>
                <input type="hidden" name="itemId" value={item.id} />
                <input type="hidden" name="taskId" value={taskId} />
                {projectId ? <input type="hidden" name="projectId" value={projectId} /> : null}
                {clientId ? <input type="hidden" name="clientId" value={clientId} /> : null}
                <button type="submit" className={BTN}>
                  Remove
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}

      <form
        ref={addFormRef}
        action={(fd) =>
          run((formData) => addChecklistItemAction(null, formData), fd, () => addFormRef.current?.reset())
        }
        className="flex items-center gap-2"
      >
        <input type="hidden" name="taskId" value={taskId} />
        {projectId ? <input type="hidden" name="projectId" value={projectId} /> : null}
        {clientId ? <input type="hidden" name="clientId" value={clientId} /> : null}
        <input name="title" placeholder="Add checklist item" required className={FIELD} />
        <button type="submit" className={BTN}>
          Add
        </button>
      </form>

      {error ? <p className="text-xs text-[var(--bad)]">{error}</p> : null}
    </div>
  );
}
