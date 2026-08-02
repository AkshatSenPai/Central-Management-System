import { prisma } from "@/lib/prisma";
import { listTasksInRange } from "@/lib/task-queries";
import { parseDateInput } from "@/lib/dates";
import { parseTaskStatusFilter } from "@/lib/task";
import { calendarRange, calendarTitle, parseCalendarView, stepAnchor } from "@/lib/calendar";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { CalendarFilters } from "@/components/calendar/calendar-filters";
import { CalendarGrid } from "@/components/calendar/calendar-grid";

/** Spec 5.5's calendar. Reads `dueDate`, so it needed no migration — which is
 * what made it the natural first slice of Phase 4 after the notification
 * centre.
 *
 * "Scheduled date" in the spec is not a separate column and is not invented
 * here: due date is the only date a task has. */
export default async function CalendarPage(props: {
  searchParams: Promise<{
    view?: string | string[];
    date?: string | string[];
    person?: string | string[];
    project?: string | string[];
    status?: string | string[];
  }>;
}) {
  const raw = await props.searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

  // One `now` for the whole render, so the page cannot cross midnight
  // mid-render and disagree with itself about which cell is today.
  const now = new Date();
  const view = parseCalendarView(raw.view) ?? "month";
  // parseDateInput already returns null for anything that is not YYYY-MM-DD,
  // so it validates the anchor param with no new code.
  const anchor = parseDateInput(first(raw.date)) ?? now;
  const status = parseTaskStatusFilter(raw.status);
  // Opaque cuids, so they cannot be validated against a union the way view and
  // status can. An unknown id simply matches nothing, which is the honest
  // result — and the query parameterises them, so it is not an injection risk.
  const userId = first(raw.person) || null;
  const projectId = first(raw.project) || null;

  const { from, to } = calendarRange(view, anchor);

  const [rows, members, projects] = await Promise.all([
    listTasksInRange(prisma, { from, to, userId, projectId, status }),
    prisma.user.findMany({
      where: { active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.project.findMany({
      where: { status: { not: "DONE" } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <div className="space-y-5 px-6 pb-10 pt-5">
      <PageHeader
        title={calendarTitle(view, anchor)}
        subtitle={
          rows.length === 1 ? "1 task due in this period" : `${rows.length} tasks due in this period`
        }
      />

      <CalendarFilters
        view={view}
        prevAnchor={stepAnchor(view, anchor, -1)}
        nextAnchor={stepAnchor(view, anchor, 1)}
        today={now}
        userId={userId}
        projectId={projectId}
        status={status}
        members={members}
        projects={projects}
      />

      <CalendarGrid view={view} anchor={anchor} now={now} rows={rows} />

      {/* Said once, under the grid, rather than in every empty cell. Undated
          work is invisible here by design — a task with no due date has no
          cell to sit in — and /my-tasks is where it lives. */}
      {rows.length === 0 ? (
        <EmptyState
          message="Nothing due in this period. Tasks with no due date never appear here —"
          actionLabel="see all your tasks."
          actionHref="/my-tasks"
        />
      ) : null}
    </div>
  );
}
