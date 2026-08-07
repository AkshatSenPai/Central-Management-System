import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { listTasksInRange } from "@/lib/task-queries";
import { listCalendarEventsInRange } from "@/lib/calendar-event-queries";
import { parseDateInput } from "@/lib/dates";
import { parseTaskStatusFilter } from "@/lib/task";
import { calendarPeriodSummary } from "@/lib/calendar-event";
import { calendarRange, calendarTitle, parseCalendarView, stepAnchor } from "@/lib/calendar";
import { lastParam } from "@/lib/search-params";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { CalendarFilters } from "@/components/calendar/calendar-filters";
import { CalendarGrid } from "@/components/calendar/calendar-grid";
import { EventForm } from "@/components/calendar/event-form";

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
  const session = await auth();
  // The layout already redirects. Repeated here because this page reads
  // session.user.id directly (the New event trigger pre-checks its creator
  // as an attendee), and TypeScript cannot see a guard that lives in
  // another file.
  if (!session?.user) redirect("/login");

  const raw = await props.searchParams;

  // One `now` for the whole render, so the page cannot cross midnight
  // mid-render and disagree with itself about which cell is today.
  const now = new Date();
  const view = parseCalendarView(raw.view) ?? "month";
  // parseDateInput already returns null for anything that is not YYYY-MM-DD,
  // so it validates the anchor param with no new code.
  // `lastParam`, not `[0]`: like `view`, the anchor date is carried in a
  // hidden input on `CalendarFilters` and overridden by the prev/next/today
  // submit buttons, so a paging click sends `date` twice and the button's
  // value is the later one. See `lastParam`'s comment for the guarantee.
  const anchor = parseDateInput(lastParam(raw.date)) ?? now;
  const status = parseTaskStatusFilter(raw.status);
  // Opaque cuids, so they cannot be validated against a union the way view and
  // status can. An unknown id simply matches nothing, which is the honest
  // result — and the query parameterises them, so it is not an injection risk.
  // These two have no hidden-input/button pair, so first and last are the same
  // value in practice; `lastParam` is used anyway so every parameter on this
  // page resolves by one rule rather than two.
  const userId = lastParam(raw.person) || null;
  const projectId = lastParam(raw.project) || null;

  const { from, to } = calendarRange(view, anchor);

  const [rows, events, members, projects, clients] = await Promise.all([
    listTasksInRange(prisma, { from, to, userId, projectId, status }),
    // No status: events have no status column, so passing one would not
    // compile — status=DONE shows completed tasks and every event (spec §6).
    listCalendarEventsInRange(prisma, { from, to, userId, projectId }),
    prisma.user.findMany({
      where: { active: true },
      select: { id: true, name: true, active: true },
      orderBy: { name: "asc" },
    }),
    prisma.project.findMany({
      where: { status: { not: "DONE" } },
      select: { id: true, name: true, clientId: true },
      orderBy: { name: "asc" },
    }),
    // <EventForm>'s Client Combobox (step 4) is now a real reader, so this is
    // no longer the deferred fifth query it was in step 3 — it reads here.
    prisma.client.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="space-y-5 px-4 pb-10 pt-5 sm:px-6">
      <PageHeader
        title={calendarTitle(view, anchor)}
        subtitle={calendarPeriodSummary(rows.length, events.length)}
      />

      {/* The New event trigger sits beside the filters, not beside the title
          (spec §6:270) — this row, not <PageHeader>'s action slot. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <CalendarFilters
          view={view}
          anchor={anchor}
          prevAnchor={stepAnchor(view, anchor, -1)}
          nextAnchor={stepAnchor(view, anchor, 1)}
          today={now}
          userId={userId}
          projectId={projectId}
          status={status}
          members={members}
          projects={projects}
        />
        <EventForm
          projects={projects}
          clients={clients}
          members={members}
          selectedAttendeeIds={[session.user.id]}
        />
      </div>

      <CalendarGrid
        view={view}
        anchor={anchor}
        now={now}
        rows={rows}
        events={events}
        projects={projects}
        clients={clients}
        members={members}
      />

      {/* Said once, under the grid, rather than in every empty cell. Undated
          work is invisible here by design — a task with no due date has no
          cell to sit in — and /my-tasks is where it lives. */}
      {rows.length === 0 && events.length === 0 ? (
        <EmptyState
          message="Nothing due or scheduled in this period. Tasks with no due date never appear here —"
          actionLabel="see all your tasks."
          actionHref="/my-tasks"
        />
      ) : null}
    </div>
  );
}
