import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { InitialsAvatar } from "@/components/ui/initials-avatar";
import { TASK_PRIORITY_BADGE, TASK_PRIORITY_LABEL, capAssignees } from "@/lib/task";
import type { TaskListRow } from "@/lib/task-queries";
import { TaskStatusControl } from "@/components/tasks/task-status-control";

/** My Tasks is a working list, not just a scan-and-click list, so status
 * lives here as the live <TaskStatusControl> rather than an inert badge —
 * that is what lets a row's status change in place without a detour through
 * the (not-yet-built) task detail page. Priority stays a plain <Badge>: there
 * is no priority-editing control in this phase. Only the title/subtitle cell
 * is a link, so the status <select> never ends up nested inside an <a>. */
export function TaskRow({ row }: { row: TaskListRow }) {
  const { shown, extra } = capAssignees(row.assignees);

  return (
    <div className="grid grid-cols-[2fr_auto_auto_auto] items-center gap-4 border-b border-[var(--border)] px-4 py-3 last:border-b-0 hover:bg-[var(--surface-2)]">
      <Link href={`/tasks/${row.id}`} className="min-w-0">
        <p className="truncate text-sm font-medium text-[var(--text)]">{row.title}</p>
        <p className="truncate text-xs text-[var(--text-3)]">{row.subtitle}</p>
      </Link>

      <TaskStatusControl
        taskId={row.id}
        projectId={row.projectId}
        clientId={row.clientId}
        status={row.status}
      />

      <Badge kind={TASK_PRIORITY_BADGE[row.priority]}>{TASK_PRIORITY_LABEL[row.priority]}</Badge>

      <div className="flex items-center -space-x-2">
        {shown.map((a) => (
          <span key={a.id} className="rounded-full ring-2 ring-[var(--surface)]">
            <InitialsAvatar initials={a.initials} shape="circle" size={28} />
          </span>
        ))}
        {extra > 0 ? (
          <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full ring-2 ring-[var(--surface)] bg-[var(--surface-3)] text-[11px] font-bold text-[var(--text-2)]">
            +{extra}
          </span>
        ) : null}
      </div>
    </div>
  );
}
