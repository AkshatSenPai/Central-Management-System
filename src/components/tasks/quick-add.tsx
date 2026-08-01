"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createTaskAction } from "@/server/actions/tasks";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";

/** A popover, not a modal: no backdrop, no focus trap, no scroll lock. That
 * boundary is what keeps 3a's D6 ("no overlay primitive") from quietly
 * becoming an overlay system. Capture is title + assignees only; the created
 * task is a personal TO_DO/MEDIUM and the success link is how you reach
 * everything else. */
export function QuickAdd({ members }: { members: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const [state, formAction, pending] = useActionState(
    async (prev: Awaited<ReturnType<typeof createTaskAction>> | null, formData: FormData) => {
      const result = await createTaskAction(prev, formData);
      if (result.ok) {
        setCreatedId(result.data.id);
        setTitle("");
        setAssigneeIds([]);
      } else {
        setAttempt((a) => a + 1);
      }
      return result;
    },
    null
  );

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  function toggle(id: string) {
    setAssigneeIds((ids) => (ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id]));
  }

  return (
    <div ref={rootRef} className="relative">
      <Button
        onClick={() => {
          setOpen((o) => !o);
          setCreatedId(null);
        }}
      >
        Quick add
      </Button>

      {open ? (
        <div className="absolute right-0 z-20 mt-2 w-72 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 shadow-[var(--shadow-lg)]">
          <form key={attempt} action={formAction} className="space-y-3">
            {/* createTaskAction rejects a missing or invalid status. */}
            <input type="hidden" name="status" value="TO_DO" />
            <input type="hidden" name="priority" value="MEDIUM" />

            {/* taskSchema's optional fields are `.optional().or(z.literal(""))`,
             * which accepts undefined or "" — never null. A field this form
             * simply omits comes back from formData.get() as null, so the whole
             * parse fails with "Invalid input" and the omission looks like a
             * status bug. <TaskForm> never hits this because it renders all four
             * and submits them empty; the shortest capture path has to say the
             * same thing explicitly. */}
            <input type="hidden" name="description" value="" />
            <input type="hidden" name="projectId" value="" />
            <input type="hidden" name="milestoneId" value="" />
            <input type="hidden" name="dueDate" value="" />

            <Field
              size="sm"
              className="w-full"
              name="title"
              required
              placeholder="Task title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />

            <div className="max-h-40 space-y-1 overflow-y-auto">
              {members.map((m) => (
                <Checkbox
                  key={m.id}
                  label={m.name}
                  name="userId"
                  value={m.id}
                  checked={assigneeIds.includes(m.id)}
                  onChange={() => toggle(m.id)}
                />
              ))}
            </div>

            {state && !state.ok ? <p className="text-xs text-[var(--bad)]">{state.error}</p> : null}

            {createdId ? (
              <Link
                href={`/tasks/${createdId}`}
                onClick={() => setOpen(false)}
                className="block text-xs text-[var(--accent)] hover:underline"
              >
                Task created — open it
              </Link>
            ) : null}

            <Button type="submit" variant="primary" className="w-full" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
