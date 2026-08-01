"use client";

import { useOptimistic, useState, useTransition } from "react";
import { groupTasksByStatus, TASK_STATUSES, type TaskStatus } from "@/lib/task";
import type { TaskListRow } from "@/lib/task-queries";
import { setTaskStatusAction } from "@/server/actions/tasks";
import { BoardCard } from "@/components/tasks/board-card";
import { BoardColumn } from "@/components/tasks/board-column";

const DRAG_KEY = "text/plain";

/** Rollback is deliberately absent as code. setTaskStatusAction calls
 * revalidatePath unconditionally after setTaskStatus returns — on both the
 * ok and the error path, not only on success. Rollback still works, but for
 * a different reason: a rejected move never wrote to the database, so the
 * revalidated refetch returns the original status, and when the transition
 * ends React discards the optimistic overlay onto that unchanged state — the
 * card is already back where it started. Writing an explicit revert here
 * would fight that, not help it.
 *
 * One known gap this leaves: when setTaskStatus fails because the task no
 * longer exists ("Task not found"), the revalidated refetch omits the row
 * entirely, so the card disappears along with it — its per-card error in
 * `errors` never gets a chance to render. Not worked around here. */
export function Board({ rows }: { rows: TaskListRow[] }) {
  const [, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [overColumn, setOverColumn] = useState<TaskStatus | null>(null);

  const [optimisticRows, applyMove] = useOptimistic(
    rows,
    (current: TaskListRow[], move: { taskId: string; status: TaskStatus }) =>
      current.map((r) => (r.id === move.taskId ? { ...r, status: move.status } : r))
  );

  const grouped = groupTasksByStatus(optimisticRows);

  function onDrop(status: TaskStatus) {
    return (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setOverColumn(null);
      const taskId = e.dataTransfer.getData(DRAG_KEY);
      // Looked up in optimisticRows, not rows: rows is the server snapshot
      // from the last revalidation and goes stale the moment an optimistic
      // move lands, so comparing against it here would let a second drag —
      // fired before the first one's round trip resolves — read the card's
      // pre-transition status and wrongly treat a real move as a same-column
      // no-op.
      const row = optimisticRows.find((r) => r.id === taskId);
      // Unknown id, or a drop back onto the card's own column: nothing to do.
      // setTaskStatus would also no-op, but not issuing the call at all keeps
      // the board silent instead of round-tripping to say nothing changed.
      if (!row || row.status === status) return;

      startTransition(async () => {
        applyMove({ taskId, status });
        const fd = new FormData();
        fd.set("taskId", taskId);
        fd.set("status", status);
        if (row.projectId) fd.set("projectId", row.projectId);
        if (row.clientId) fd.set("clientId", row.clientId);

        try {
          const result = await setTaskStatusAction(fd);
          if (result.ok) {
            setErrors((prev) => {
              const next = { ...prev };
              delete next[taskId];
              return next;
            });
          } else {
            setErrors((prev) => ({ ...prev, [taskId]: result.error }));
          }
        } catch {
          setErrors((prev) => ({ ...prev, [taskId]: "Something went wrong — try again" }));
        }
      });
    };
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      {TASK_STATUSES.map((status) => (
        <BoardColumn
          key={status}
          status={status}
          count={grouped[status].length}
          isOver={overColumn === status}
          onDragOver={(e) => {
            // Without preventDefault the browser fires no drop event at all.
            e.preventDefault();
            setOverColumn(status);
          }}
          // Only clear if this column is still the highlighted one — dragging
          // from A into B fires B's dragover before A's dragleave, so an
          // unconditional clear would wipe the highlight B just set.
          onDragLeave={() => setOverColumn((c) => (c === status ? null : c))}
          onDrop={onDrop(status)}
        >
          {grouped[status].map((row) => (
            <BoardCard
              key={row.id}
              row={row}
              draggable
              onDragStart={(e) => e.dataTransfer.setData(DRAG_KEY, row.id)}
              // The backstop for an abandoned drag — Esc, or a release outside
              // any column — neither of which produces a drop or a dragleave.
              onDragEnd={() => setOverColumn(null)}
              error={errors[row.id] ?? null}
            />
          ))}
        </BoardColumn>
      ))}
    </div>
  );
}
