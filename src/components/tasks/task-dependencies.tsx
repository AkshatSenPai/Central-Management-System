"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { FormError } from "@/components/ui/form-error";
import { SectionCard } from "@/components/ui/section-card";
import { Icon } from "@/components/ui/icon";
import type { ActionResult } from "@/lib/action-result";
import type { ComboboxOption } from "@/lib/combobox";
import { TASK_STATUS_BADGE, TASK_STATUS_LABEL, taskReference, unfinishedBlockers } from "@/lib/task";
import type { DependencyTask } from "@/lib/task-queries";
import { addTaskDependencyAction, removeTaskDependencyAction } from "@/server/actions/tasks";

/** One task at the other end of a dependency. `onRemove` absent means the
 * read-only Blocking list — a dependency is edited from the blocked task's
 * page, so there is exactly one place it lives and no question of which end
 * owns it. */
function DependencyRow({
  task,
  onRemove,
  pending,
}: {
  task: DependencyTask;
  onRemove?: () => void;
  pending: boolean;
}) {
  return (
    <div className="flex items-center gap-3 py-2">
      <Badge kind={TASK_STATUS_BADGE[task.status]}>{TASK_STATUS_LABEL[task.status]}</Badge>
      <Link
        href={`/tasks/${task.id}`}
        transitionTypes={["nav-forward"]}
        className="min-w-0 flex-1 truncate text-sm text-[var(--text)] hover:underline"
      >
        <span className="font-medium">{taskReference(task.reference)}</span> {task.title}
      </Link>
      {onRemove ? (
        <Button
          variant="ghost"
          size="xs"
          onClick={onRemove}
          disabled={pending}
          aria-label={`Remove ${taskReference(task.reference)} as a blocker`}
          className="flex-none"
        >
          <Icon name="close" size="sm" />
        </Button>
      ) : null}
    </div>
  );
}

/** The two sequencing panels on task detail.
 *
 * Actions are driven imperatively inside a `useTransition`, the same shape
 * the board uses — NOT `useActionState`, whose `(prevState, formData)`
 * signature these actions do not have. */
export function TaskDependencies({
  taskId,
  projectId,
  clientId,
  blockers,
  blocking,
  candidates,
}: {
  taskId: string;
  projectId: string | null;
  clientId: string | null;
  blockers: DependencyTask[];
  blocking: DependencyTask[];
  candidates: ComboboxOption[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState("");

  function run(action: (fd: FormData) => Promise<ActionResult>, blockerTaskId: string) {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("taskId", taskId);
      fd.set("blockerTaskId", blockerTaskId);
      if (projectId) fd.set("projectId", projectId);
      if (clientId) fd.set("clientId", clientId);
      try {
        const result = await action(fd);
        if (result.ok) {
          setError(null);
          setPicked("");
        } else {
          setError(result.error);
        }
      } catch {
        setError("Something went wrong — try again");
      }
    });
  }

  const openCount = unfinishedBlockers(blockers).length;

  return (
    <>
      {/* overflowVisible: this card's body opens a Combobox listbox, and the
          frame's default overflow-hidden clips it to the card — the options
          stay in the DOM and pass every scripted check while rendering as an
          unreadable sliver on screen. */}
      <SectionCard
        title="Blocked by"
        meta={openCount > 0 ? `${openCount} unfinished` : null}
        overflowVisible
      >
        {/* Rendered even when empty. A card that appears only when non-empty
            is one nobody discovers — the same reasoning Checklist and Files
            already follow. */}
        {blockers.length === 0 ? (
          <p className="text-sm text-[var(--text-3)]">Nothing is blocking this task.</p>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {blockers.map((b) => (
              <DependencyRow
                key={b.id}
                task={b}
                pending={pending}
                onRemove={() => run(removeTaskDependencyAction, b.id)}
              />
            ))}
          </div>
        )}

        <div className="mt-3 flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <Combobox
              name="blockerTaskId"
              value={picked}
              onChange={setPicked}
              options={candidates}
              label="Add a blocker"
              placeholder="Search tasks…"
            />
          </div>
          <Button
            variant="secondary"
            size="sm"
            disabled={pending || !picked}
            onClick={() => run(addTaskDependencyAction, picked)}
            className="flex-none"
          >
            Add
          </Button>
        </div>

        {/* Where the cycle refusal surfaces. It names the other end, because
            "would create a loop" alone leaves someone staring at a picker
            with no idea which option was the problem. */}
        {error ? <FormError message={error} size="xs" /> : null}
      </SectionCard>

      <SectionCard title="Blocking" meta={blocking.length > 0 ? blocking.length : null}>
        {blocking.length === 0 ? (
          <p className="text-sm text-[var(--text-3)]">This task isn&apos;t blocking anything.</p>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {blocking.map((t) => (
              <DependencyRow key={t.id} task={t} pending={pending} />
            ))}
          </div>
        )}
      </SectionCard>
    </>
  );
}
