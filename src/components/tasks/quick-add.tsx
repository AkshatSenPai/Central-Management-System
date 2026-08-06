"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createTaskAction } from "@/server/actions/tasks";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox } from "@/components/ui/combobox";
import { Field, SelectField } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { FormError } from "@/components/ui/form-error";
import { TASK_PRIORITIES, TASK_PRIORITY_LABEL, type TaskPriority } from "@/lib/task";

/** A popover, not a modal: no backdrop, no focus trap, no scroll lock. That
 * boundary is what keeps 3a's D6 ("no overlay primitive") from quietly
 * becoming an overlay system.
 *
 * **Capture is title, priority, due date, project and assignees.** It was
 * title + assignees only until 2026-08-07, on the theory that anything more
 * belonged in the full form — but the three things people actually know at
 * capture time are how urgent it is, when it is due and who it is for, and
 * throwing all three away meant reopening the task to fill them in, which is
 * the work this popover exists to save.
 *
 * `status` stays `TO_DO` and `description` stays empty: a task being
 * captured has not started, and a description is what the full form is for.
 *
 * **`milestoneId` stays an empty hidden input, deliberately.** It is optional
 * in `taskSchema` so omitting it is valid, and including it would mean
 * loading milestones per project and re-validating the pair on every project
 * change — the bulk of `<TaskForm>`'s complexity, imported here to serve a
 * field almost nobody sets while capturing. `MILESTONE_MISMATCH` cannot fire
 * while it is always empty. */
export function QuickAdd({
  members,
  projects,
}: {
  members: { id: string; name: string }[];
  projects: { id: string; name: string; clientId: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("MEDIUM");
  const [dueDate, setDueDate] = useState("");
  const [projectId, setProjectId] = useState("");
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
        setPriority("MEDIUM");
        setDueDate("");
        setProjectId("");
        setAssigneeIds([]);
      }
      // Remount on BOTH outcomes, not just failure. React 19 resets the form
      // once the action resolves, and `project-form.tsx:73-76` records what
      // that does to a <select>: text inputs get their controlled value
      // restored, a <select> does not, because React's own state did not
      // change and nothing re-commits its DOM value.
      //
      // Clearing priority back to MEDIUM above is exactly that case, and
      // without this the select sat on its first option (Low) while state
      // said MEDIUM — and since FormData reads the DOM, the *next* quick-add
      // would have silently created a Low task. Caught in the browser; the
      // suite cannot see it, because this repo cannot mount a component.
      setAttempt((a) => a + 1);
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
        variant="primary"
        onClick={() => {
          setOpen((o) => !o);
          setCreatedId(null);
        }}
        aria-expanded={open}
        size="none"
        className="h-8 gap-1.5 rounded-lg px-3 text-[13px] font-semibold"
      >
        <Icon name="add" size="sm" />
        Quick add
      </Button>

      {open ? (
        <div className="absolute right-0 z-20 mt-2 w-[22rem] rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 shadow-[var(--shadow-lg)]">
          <form key={attempt} action={formAction} className="space-y-3">
            {/* createTaskAction rejects a missing or invalid status. */}
            <input type="hidden" name="status" value="TO_DO" />

            {/* taskSchema's optional fields are `.optional().or(z.literal(""))`,
             * which accepts undefined or "" — never null. A field this form
             * simply omits comes back from formData.get() as null, so the whole
             * parse fails with "Invalid input" and the omission looks like a
             * status bug. <TaskForm> never hits this because it renders all four
             * and submits them empty; the shortest capture path has to say the
             * same thing explicitly. `projectId`, `priority` and `dueDate` are
             * real controls below and no longer need a hidden stand-in. */}
            <input type="hidden" name="description" value="" />
            <input type="hidden" name="milestoneId" value="" />

            {/* Not a task field. `createTaskAction` reads `clientId` only to
                revalidate the client page, exactly as <TaskForm> supplies it.
                Derived from the chosen project's own row, so it can never
                disagree with `projectId`, and empty for a personal task —
                which is what the action's own `if (clientId)` checks for. */}
            <input
              type="hidden"
              name="clientId"
              value={projects.find((p) => p.id === projectId)?.clientId ?? ""}
            />

            <Field
              size="sm"
              className="w-full"
              name="title"
              required
              placeholder="Task title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />

            {/* Side by side: both are narrow, and stacking them would push
                the assignee list below the fold in a popover this size. */}
            <div className="grid grid-cols-2 gap-2">
              <SelectField
                label="Priority"
                size="sm"
                className="w-full"
                name="priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value as TaskPriority)}
              >
                {TASK_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {TASK_PRIORITY_LABEL[p]}
                  </option>
                ))}
              </SelectField>
              <Field
                label="Due date"
                size="sm"
                className="w-full"
                type="date"
                name="dueDate"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>

            {/* The empty option has to be first and explicit: a personal task
                is the common case here, and without a row for it there is no
                way to choose one after picking a project by mistake. Same
                shape <TaskForm> uses. */}
            <Combobox
              label="Project"
              size="sm"
              className="w-full"
              name="projectId"
              value={projectId}
              onChange={setProjectId}
              options={[
                { value: "", label: "No project (personal task)" },
                ...projects.map((p) => ({ value: p.id, label: p.name })),
              ]}
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

            {state && !state.ok ? <FormError message={state.error} size="xs" /> : null}

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
