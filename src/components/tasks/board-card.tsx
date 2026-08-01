import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { InitialsAvatar } from "@/components/ui/initials-avatar";
import { TASK_PRIORITY_BADGE, TASK_PRIORITY_LABEL, capAssignees } from "@/lib/task";
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
  error,
}: {
  row: TaskListRow;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent<HTMLDivElement>) => void;
  error?: string | null;
}) {
  const { shown, extra } = capAssignees(row.assignees);

  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      style={{ viewTransitionName: `task-${row.id}` }}
      className={`space-y-2 rounded-md border border-[var(--border)] bg-[var(--surface)] p-3 ${
        draggable ? "cursor-grab active:cursor-grabbing" : ""
      }`}
    >
      <Link href={`/tasks/${row.id}`} transitionTypes={["nav-forward"]} className="block min-w-0">
        <p className="truncate text-sm font-medium text-[var(--text)]">{row.title}</p>
        {row.subtitle ? (
          <p className={`truncate text-xs ${row.overdue ? "text-[var(--bad)]" : "text-[var(--text-3)]"}`}>
            {row.subtitle}
          </p>
        ) : null}
      </Link>

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

      {error ? <p className="text-xs text-[var(--bad)]">{error}</p> : null}
    </div>
  );
}
