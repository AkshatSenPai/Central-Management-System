import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { InitialsAvatar } from "@/components/ui/initials-avatar";
import { TASK_PRIORITY_BADGE, TASK_PRIORITY_LABEL, capAssignees } from "@/lib/task";
import { projectColorIndex } from "@/lib/project";
import { shortDate } from "@/lib/dates";
import type { TaskListRow } from "@/lib/task-queries";

const SWATCH: Record<number, string> = {
  1: "bg-[var(--pj1)]",
  2: "bg-[var(--pj2)]",
  3: "bg-[var(--pj3)]",
  4: "bg-[var(--pj4)]",
  5: "bg-[var(--pj5)]",
  6: "bg-[var(--pj6)]",
};

const ROW =
  "flex items-center gap-3 border-b border-[var(--border)] px-3.5 py-2.5 last:border-b-0 " +
  "transition-colors hover:bg-[var(--surface-2)]";

/** A dashboard task line.
 *
 * Deliberately not <TaskRow>. That one is a working row for /my-tasks: it
 * carries a live status <select> so a task can be moved without leaving the
 * list. The dashboard is a triage screen — you read it and click through —
 * so this row is entirely a link, and the four-column grid TaskRow needs for
 * its control would only add weight here.
 *
 * The `variant` distinguishes what each list is for. Overdue rows lead with
 * how late they are, which is the whole reason they are grouped; Today rows
 * lead with which project they belong to, because on a single day the
 * question is what to pick up next.
 */
export function DashboardTaskRow({
  row,
  variant,
}: {
  row: TaskListRow;
  variant: "overdue" | "today";
}) {
  const { shown, extra } = capAssignees(row.assignees, 2);
  const colorIndex = row.projectId ? projectColorIndex(row.projectId) : 1;

  return (
    <Link href={`/tasks/${row.id}`} transitionTypes={["nav-forward"]} className={ROW}>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] font-medium text-[var(--text)]">{row.title}</p>
        {variant === "overdue" ? (
          <p className="truncate text-[11.5px] text-[var(--text-3)]">
            {row.clientName && row.projectName
              ? `${row.clientName} · ${row.projectName}`
              : "Personal"}
          </p>
        ) : null}
      </div>

      {variant === "today" ? (
        <>
          <span
            aria-hidden="true"
            className={`h-1.5 w-1.5 flex-none rounded-full ${SWATCH[colorIndex]}`}
          />
          <span className="max-w-[190px] flex-none truncate text-xs text-[var(--text-2)]">
            {row.projectName ?? "Personal"}
          </span>
        </>
      ) : null}

      <Badge kind={TASK_PRIORITY_BADGE[row.priority]}>{TASK_PRIORITY_LABEL[row.priority]}</Badge>

      {variant === "overdue" ? (
        <span className="w-[72px] flex-none text-right text-xs font-semibold text-[var(--bad)]">
          {row.dueDate ? shortDate(row.dueDate) : ""}
        </span>
      ) : (
        <span className="flex w-11 flex-none justify-end -space-x-1.5">
          {shown.map((a) => (
            <span key={a.id} className="rounded-full ring-2 ring-[var(--surface)]">
              <InitialsAvatar initials={a.initials} shape="circle" size={22} />
            </span>
          ))}
          {extra > 0 ? (
            <span className="flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full bg-[var(--avatar-2)] text-[9.5px] font-bold text-[var(--text-2)] ring-2 ring-[var(--surface)]">
              +{extra}
            </span>
          ) : null}
        </span>
      )}
    </Link>
  );
}
