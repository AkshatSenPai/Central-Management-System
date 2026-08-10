"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { InitialsAvatar } from "@/components/ui/initials-avatar";
import { FormError } from "@/components/ui/form-error";
import { TASK_PRIORITY_BADGE, TASK_PRIORITY_LABEL, blockedChipLabel, capAssignees } from "@/lib/task";
import type { TaskListRow } from "@/lib/task-queries";
import { TaskStatusControl } from "@/components/tasks/task-status-control";

/** One card. The status select stays on every card on purpose (spec D4): it
 * is the keyboard and touch path, so the board degrades to a usable layout
 * when drag is unavailable rather than becoming read-only. `error` is keyed
 * by task id upstream, so a failed move reports on the card it happened to
 * — a board can show forty cards, and a board-level banner would not say
 * which one. */
export function BoardCard({
  row,
  draggable = false,
  onDragStart,
  onDragEnd,
  error,
}: {
  row: TaskListRow;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd?: () => void;
  error?: string | null;
}) {
  const { shown, extra } = capAssignees(row.assignees);
  // Null unless something unfinished blocks it. `warn` and not `bad`: a
  // blocked task is a constraint, not a failure, and `bad` is what overdue
  // already uses — two different problems reading identically is how a colour
  // stops meaning anything.
  const blockedLabel = blockedChipLabel(row.blockers);
  // Dragging has no CSS pseudo-class, so the held state has to be tracked.
  const [dragging, setDragging] = useState(false);

  return (
    <div
      draggable={draggable}
      onDragStart={(e) => {
        setDragging(true);
        onDragStart?.(e);
      }}
      // Fires however the drag ends — dropped, Esc, or released outside a
      // column — which is what lets the board clear its drag-over highlight.
      // Its absence is why that highlight could stick (Phase 3b follow-up).
      onDragEnd={() => {
        setDragging(false);
        onDragEnd?.();
      }}
      style={{ viewTransitionName: `task-${row.id}` }}
      className={`space-y-2 rounded-md border border-[var(--border)] bg-[var(--surface)] p-3 transition-[opacity,box-shadow] duration-150 ${
        draggable ? "cursor-grab active:cursor-grabbing hover:shadow-[var(--shadow-md)]" : ""
      } ${dragging ? "opacity-50" : ""}`}
    >
      <Link href={`/tasks/${row.id}`} transitionTypes={["nav-forward"]} className="block min-w-0">
        <p className="truncate text-sm font-medium text-[var(--text)]">{row.title}</p>
        {row.subtitle ? (
          <p className={`truncate text-xs ${row.overdue ? "text-[var(--bad)]" : "text-[var(--text-3)]"}`}>
            {row.subtitle}
          </p>
        ) : null}
      </Link>

      {/* The card stays draggable. The refusal is what teaches the rule; this
          is what stops anyone needing to be taught twice. */}
      {blockedLabel ? <Badge kind="warn">{blockedLabel}</Badge> : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Badge kind={TASK_PRIORITY_BADGE[row.priority]}>{TASK_PRIORITY_LABEL[row.priority]}</Badge>
        <div className="flex items-center -space-x-2">
          {shown.map((a) => (
            <span key={a.id} className="rounded-full ring-2 ring-[var(--surface)]">
              <InitialsAvatar initials={a.initials} shape="circle" size={24} />
            </span>
          ))}
          {extra > 0 ? (
            <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full ring-2 ring-[var(--surface)] bg-[var(--avatar-2)] text-[10px] font-bold text-[var(--text-2)]">
              +{extra}
            </span>
          ) : null}
        </div>
      </div>

      <TaskStatusControl
        taskId={row.id}
        projectId={row.projectId}
        clientId={row.clientId}
        status={row.status}
      />

      {error ? <FormError message={error} size="xs" /> : null}
    </div>
  );
}
