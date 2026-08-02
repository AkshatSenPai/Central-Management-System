"use client";

import { useRef, useState } from "react";
import {
  addChecklistItemAction,
  setChecklistItemDoneAction,
  removeChecklistItemAction,
} from "@/server/actions/tasks";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { FormError } from "@/components/ui/form-error";

type ChecklistItem = { id: string; title: string; done: boolean; order: number };

/** Not a possible item id (cuid), so it can never collide with one. */
const ADD_SCOPE = "add";

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
  /** Which control failed, not just that something did. A single list-scoped
   * string rendered a failed toggle on the seventh item as a message above
   * the first — `scope` is the item's id, or ADD_SCOPE for the add form, so
   * the message lands on the row the user actually touched. */
  const [error, setError] = useState<{ scope: string; message: string } | null>(null);
  const [pending, setPending] = useState(false);
  const addFormRef = useRef<HTMLFormElement>(null);

  async function run(
    action: (fd: FormData) => Promise<{ ok: boolean; error?: string }>,
    fd: FormData,
    scope: string,
    onSuccess?: () => void
  ) {
    setError(null);
    setPending(true);
    try {
      const result = await action(fd);
      if (!result.ok && result.error) setError({ scope, message: result.error });
      else if (result.ok) onSuccess?.();
    } catch {
      setError({ scope, message: "Something went wrong — try again" });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-3">
      {items.length === 0 ? (
        <p className="text-sm text-[var(--text-3)]">No checklist items yet.</p>
      ) : (
        <ul className="space-y-0.5">
          {items.map((item) => (
            <li key={item.id} className="rounded-md px-2 py-1 hover:bg-[var(--surface-2)]">
              <div className="flex items-center gap-2">
              {/* Keyed by id+done, not just id: the checkbox below is
                  uncontrolled (defaultChecked), and revalidatePath re-renders
                  this list with the new `done` after every toggle — success
                  or failure — without remounting it. A key tied to `done`
                  forces that remount so the checkbox always reflects the
                  server's actual value instead of whatever React's own
                  post-action form reset happened to leave it showing. */}
              <form
                key={`${item.id}-${item.done}`}
                action={(fd) => run(setChecklistItemDoneAction, fd, item.id)}
                onChange={(e) => e.currentTarget.requestSubmit()}
                className="flex min-w-0 flex-1 items-center gap-2"
              >
                <input type="hidden" name="itemId" value={item.id} />
                <input type="hidden" name="taskId" value={taskId} />
                {projectId ? <input type="hidden" name="projectId" value={projectId} /> : null}
                {clientId ? <input type="hidden" name="clientId" value={clientId} /> : null}
                <Checkbox
                  name="done"
                  value="true"
                  defaultChecked={item.done}
                  className="flex-none"
                />
                <span
                  className={`truncate text-sm ${
                    item.done ? "text-[var(--text-3)] line-through" : "text-[var(--text)]"
                  }`}
                >
                  {item.title}
                </span>
              </form>
              <form action={(fd) => run(removeChecklistItemAction, fd, item.id)}>
                <input type="hidden" name="itemId" value={item.id} />
                <input type="hidden" name="taskId" value={taskId} />
                {projectId ? <input type="hidden" name="projectId" value={projectId} /> : null}
                {clientId ? <input type="hidden" name="clientId" value={clientId} /> : null}
                <Button type="submit" className="flex-none" disabled={pending}>
                  Remove
                </Button>
              </form>
              </div>
              {error?.scope === item.id ? (
                <FormError message={error.message} size="xs" className="mt-1 pl-6" />
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <form
        ref={addFormRef}
        action={(fd) =>
          run((formData) => addChecklistItemAction(null, formData), fd, ADD_SCOPE, () =>
            addFormRef.current?.reset()
          )
        }
        className="flex items-center gap-2"
      >
        <input type="hidden" name="taskId" value={taskId} />
        {projectId ? <input type="hidden" name="projectId" value={projectId} /> : null}
        {clientId ? <input type="hidden" name="clientId" value={clientId} /> : null}
        <Field size="sm" className="w-full max-w-xs" name="title" placeholder="Add checklist item" required />
        <Button type="submit" className="flex-none">
          Add
        </Button>
      </form>

      {error?.scope === ADD_SCOPE ? (
        <FormError message={error.message} size="xs" />
      ) : null}
    </div>
  );
}
