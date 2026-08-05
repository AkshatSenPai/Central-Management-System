import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { TASK_PRIORITY_BADGE, TASK_PRIORITY_LABEL } from "@/lib/task";
import { projectColorIndex } from "@/lib/project";
import { shortDate } from "@/lib/dates";
import {
  WEEKDAY_LABELS,
  groupByAppDay,
  isInAppMonth,
  isOverdueOnDay,
  isSameAppDay,
  monthGrid,
  startOfAppWeek,
  type CalendarView,
} from "@/lib/calendar";
import { addDays, appDayOfMonth, startOfAppDay } from "@/lib/dates";
import type { TaskListRow } from "@/lib/task-queries";
import type { CalendarEventRow } from "@/lib/calendar-event-queries";

const SWATCH: Record<number, string> = {
  1: "bg-[var(--pj1)]",
  2: "bg-[var(--pj2)]",
  3: "bg-[var(--pj3)]",
  4: "bg-[var(--pj4)]",
  5: "bg-[var(--pj5)]",
  6: "bg-[var(--pj6)]",
};

/** One task inside a cell. Compact by necessity — a month cell is about 140px
 * wide — so it carries only the project colour and the title, and leans on the
 * link to the task for everything else. */
function CellTask({ row, overdue }: { row: TaskListRow; overdue: boolean }) {
  const colorIndex = row.projectId ? projectColorIndex(row.projectId) : 1;
  return (
    <Link
      href={`/tasks/${row.id}`}
      transitionTypes={["nav-forward"]}
      title={row.subtitle ? `${row.title} — ${row.subtitle}` : row.title}
      className={`flex items-center gap-1.5 rounded px-1 py-0.5 text-[11.5px] transition-colors hover:bg-[var(--surface-3)] ${
        overdue ? "text-[var(--bad)]" : "text-[var(--text-2)]"
      }`}
    >
      <span aria-hidden="true" className={`h-1.5 w-1.5 flex-none rounded-full ${SWATCH[colorIndex]}`} />
      <span className="truncate">{row.title}</span>
    </Link>
  );
}

/** The month grid: always six rows, so paging through the year does not make
 * the page jump. Days outside the anchor month are dimmed rather than blank —
 * a task due on the 1st of next month is still worth seeing from this one. */
function MonthView({
  anchor,
  now,
  byDay,
}: {
  anchor: Date;
  now: Date;
  byDay: Map<number, TaskListRow[]>;
}) {
  const weeks = monthGrid(anchor);
  return (
    <div className="overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow)]">
      <div className="grid grid-cols-7 border-b border-[var(--border)]">
        {WEEKDAY_LABELS.map((label) => (
          <span
            key={label}
            className="px-2 py-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-3)]"
          >
            {label}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {weeks.flat().map((day) => {
          const tasks = byDay.get(day.getTime()) ?? [];
          const inMonth = isInAppMonth(day, anchor);
          const isToday = isSameAppDay(day, now);
          return (
            <div
              key={day.getTime()}
              className={`min-h-[104px] border-b border-r border-[var(--border)] p-1.5 last:border-r-0 ${
                inMonth ? "" : "bg-[var(--surface-2)]"
              }`}
            >
              <span
                className={`mb-1 flex h-5 w-5 items-center justify-center rounded-full text-[11.5px] ${
                  isToday
                    ? "bg-[var(--btn)] font-bold text-[var(--on-btn)]"
                    : inMonth
                      ? "text-[var(--text-2)]"
                      : "text-[var(--text-3)]"
                }`}
              >
                {appDayOfMonth(day)}
              </span>
              <div className="flex flex-col gap-0.5">
                {tasks.slice(0, 3).map((row) => (
                  <CellTask key={row.id} row={row} overdue={isOverdueOnDay(row.dueDate, now)} />
                ))}
                {/* Truncated rather than scrolled: a cell that scrolls is a
                    cell nobody scrolls. The count is the invitation to open
                    the day view. */}
                {tasks.length > 3 ? (
                  <span className="px-1 text-[11px] text-[var(--text-3)]">
                    +{tasks.length - 3} more
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Week and day share a layout: a column per day, full task rows rather than
 * one-line chips, because there is room for them. */
function ColumnsView({
  days,
  now,
  byDay,
}: {
  days: Date[];
  now: Date;
  byDay: Map<number, TaskListRow[]>;
}) {
  return (
    <div
      className={`grid gap-3 ${days.length === 1 ? "grid-cols-1" : "grid-cols-1 md:grid-cols-7"}`}
    >
      {days.map((day) => {
        const tasks = byDay.get(day.getTime()) ?? [];
        const isToday = isSameAppDay(day, now);
        return (
          <section
            key={day.getTime()}
            className="overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow)]"
          >
            <div
              className={`flex items-baseline gap-1.5 border-b border-[var(--border)] px-2.5 py-2 ${
                isToday ? "bg-[var(--accent-soft)]" : ""
              }`}
            >
              <span
                className={`text-[12px] font-semibold ${
                  isToday ? "text-[var(--accent)]" : "text-[var(--text)]"
                }`}
              >
                {shortDate(day)}
              </span>
              {tasks.length > 0 ? (
                <span className="mono text-[11px] text-[var(--text-3)]">{tasks.length}</span>
              ) : null}
            </div>
            <div className="flex flex-col gap-1 p-2">
              {tasks.length === 0 ? (
                <span className="px-1 py-1 text-[11.5px] text-[var(--text-3)]">—</span>
              ) : (
                tasks.map((row) => (
                  <Link
                    key={row.id}
                    href={`/tasks/${row.id}`}
                    transitionTypes={["nav-forward"]}
                    className="flex flex-col gap-1 rounded-md px-1.5 py-1 transition-colors hover:bg-[var(--surface-2)]"
                  >
                    <span
                      className={`text-[12.5px] font-medium ${
                        isOverdueOnDay(row.dueDate, now)
                          ? "text-[var(--bad)]"
                          : "text-[var(--text)]"
                      }`}
                    >
                      {row.title}
                    </span>
                    <span className="truncate text-[11px] text-[var(--text-3)]">
                      {row.projectName ?? "Personal"}
                    </span>
                    <Badge kind={TASK_PRIORITY_BADGE[row.priority]}>
                      {TASK_PRIORITY_LABEL[row.priority]}
                    </Badge>
                  </Link>
                ))
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export function CalendarGrid({
  view,
  anchor,
  now,
  rows,
}: {
  view: CalendarView;
  anchor: Date;
  now: Date;
  rows: TaskListRow[];
  // Accepted but not yet rendered — wiring the grid to draw these is Task 5.
  // Left out of the destructure (rather than bound and unused) so the prop
  // is part of the contract without tripping @typescript-eslint/no-unused-vars.
  events: CalendarEventRow[];
}) {
  // Bucketed by app-midnight epoch, which is what each cell looks itself up
  // by — never by slicing an ISO string, because the dueDate column carries no
  // constraint forcing midnight.
  const byDay = groupByAppDay(rows, (r) => r.dueDate);

  if (view === "month") return <MonthView anchor={anchor} now={now} byDay={byDay} />;
  if (view === "week") {
    const start = startOfAppWeek(anchor);
    return (
      <ColumnsView
        days={Array.from({ length: 7 }, (_, i) => addDays(start, i))}
        now={now}
        byDay={byDay}
      />
    );
  }
  return <ColumnsView days={[startOfAppDay(anchor)]} now={now} byDay={byDay} />;
}
