"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createTaskAction } from "@/server/actions/tasks";

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
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          setCreatedId(null);
        }}
        className="rounded-md border border-[var(--border)] px-2 py-1 text-sm text-[var(--text-2)] hover:bg-[var(--surface-3)]"
      >
        Quick add
      </button>

      {open ? (
        <div className="absolute right-0 z-20 mt-2 w-72 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 shadow-lg">
          <form key={attempt} action={formAction} className="space-y-3">
            {/* createTaskAction rejects a missing or invalid status. */}
            <input type="hidden" name="status" value="TO_DO" />
            <input type="hidden" name="priority" value="MEDIUM" />

            <input
              name="title"
              required
              placeholder="Task title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--text)]"
            />

            <div className="max-h-40 space-y-1 overflow-y-auto">
              {members.map((m) => (
                <label key={m.id} className="flex items-center gap-2 text-sm text-[var(--text)]">
                  <input
                    type="checkbox"
                    name="userId"
                    value={m.id}
                    checked={assigneeIds.includes(m.id)}
                    onChange={() => toggle(m.id)}
                    className="h-4 w-4 rounded border-[var(--border)]"
                  />
                  {m.name}
                </label>
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

            <button
              type="submit"
              disabled={pending}
              className="w-full rounded-md bg-[var(--btn)] px-3 py-1.5 text-sm text-[var(--on-btn)] hover:bg-[var(--btn-h)] disabled:opacity-50"
            >
              {pending ? "Saving…" : "Save"}
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
