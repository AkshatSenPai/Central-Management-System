import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { TASK_PRIORITY_BADGE, TASK_PRIORITY_LABEL } from "@/lib/task";
import { projectColorIndex } from "@/lib/project";
import {
  assignLanes,
  eventPosition,
  eventTimeLabel,
  monthCellRows,
  splitDayEvents,
  timelineWindow,
} from "@/lib/calendar-event";
import { appTimeLabel, shortDate, toDateInputValue } from "@/lib/dates";
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
import { EventForm } from "@/components/calendar/event-form";

/** `<EventForm>`'s own prop shapes, structurally — it does not export its
 * `ProjectOption`/`ClientOption`/`MemberOption` types (spec §8 names no
 * reason to), and this file needs nothing from them but the shape. */
type ProjectOption = { id: string; name: string; clientId: string };
type ClientOption = { id: string; name: string };
type MemberOption = { id: string; name: string; active: boolean };

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

/** One event inside a cell, following `CellTask`'s shape: a dot, then a label,
 * then the truncated title, linking out rather than carrying detail itself.
 * The dot is the project swatch when the event has one, `--accent` when it
 * does not — an event is never colourless the way an unassigned task's dot
 * still resolves to swatch 1.
 *
 * The label is `appTimeLabel(startsAt)` — a bare "15:00", not
 * `eventTimeLabel`'s "15:00 – 16:00" range — because a month cell is ~140px
 * wide and has a title to fit beside it; the day/week views are where the
 * full range belongs. All-day events print no label at all: their stored
 * bounds are app-midnight to app-midnight, so any clock read off them is an
 * artefact of storage, not a time anyone chose. */
function CellEvent({ event }: { event: CalendarEventRow }) {
  const dotClass = event.projectId
    ? SWATCH[projectColorIndex(event.projectId)]
    : "bg-[var(--accent)]";
  return (
    <Link
      href={`/calendar?view=day&date=${toDateInputValue(event.startsAt)}`}
      transitionTypes={["nav-forward"]}
      title={event.title}
      className="flex items-center gap-1.5 rounded px-1 py-0.5 text-[11.5px] text-[var(--text-2)] transition-colors hover:bg-[var(--surface-3)]"
    >
      <span aria-hidden="true" className={`h-1.5 w-1.5 flex-none rounded-full ${dotClass}`} />
      {event.allDay ? null : (
        <span className="mono text-[10.5px] text-[var(--text-3)]">
          {appTimeLabel(event.startsAt)}
        </span>
      )}
      <span className="truncate">{event.title}</span>
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
  eventsByDay,
}: {
  anchor: Date;
  now: Date;
  byDay: Map<number, TaskListRow[]>;
  eventsByDay: Map<number, CalendarEventRow[]>;
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
          const events = eventsByDay.get(day.getTime()) ?? [];
          const cell = monthCellRows(events, tasks, 3);
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
                {cell.events.map((event) => (
                  <CellEvent key={event.id} event={event} />
                ))}
                {cell.tasks.map((row) => (
                  <CellTask key={row.id} row={row} overdue={isOverdueOnDay(row.dueDate, now)} />
                ))}
                {/* Truncated rather than scrolled: a cell that scrolls is a
                    cell nobody scrolls. The count is the invitation to open
                    the day view. */}
                {cell.overflow > 0 ? (
                  <span className="px-1 text-[11px] text-[var(--text-3)]">
                    +{cell.overflow} more
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

/** One all-day event inside the untimed band, shaped like the due-task row
 * beside it (title line, then a second line) so the two kinds read as one
 * list rather than two different components glued together. The second line
 * is `eventTimeLabel(event)`, which for an all-day row is always the literal
 * "All day" — §13's locked label for this exact spot — never a repeat of
 * the band's own "no set time" heading. */
function UntimedEventRow({ event }: { event: CalendarEventRow }) {
  const dotClass = event.projectId
    ? SWATCH[projectColorIndex(event.projectId)]
    : "bg-[var(--accent)]";
  return (
    <Link
      href={`/calendar?view=day&date=${toDateInputValue(event.startsAt)}`}
      transitionTypes={["nav-forward"]}
      title={event.title}
      className="flex flex-col gap-1 rounded-md px-1.5 py-1 transition-colors hover:bg-[var(--surface-2)]"
    >
      <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-[var(--text)]">
        <span aria-hidden="true" className={`h-1.5 w-1.5 flex-none rounded-full ${dotClass}`} />
        <span className="truncate">{event.title}</span>
      </span>
      <span className="mono text-[11px] text-[var(--text-3)]">{eventTimeLabel(event)}</span>
    </Link>
  );
}

/** Pixels per hour row in the timeline. A pure layout constant, not part of
 * the arithmetic `eventPosition`/`timelineWindow` own — those stay in
 * percentages so they never need to know this number, or that it is in
 * pixels at all. */
const HOUR_ROW_HEIGHT_PX = 44;

/** The hour scaffold for one column: a background of hour rows sized by the
 * `window` every column on screen shares (§7), with the day's own timed
 * events laid over it via `eventPosition` (position) and `assignLanes`
 * (side-by-side width for overlaps). Renders even with zero timed events —
 * an empty grid of hours reads as "nothing booked", where a blank panel
 * would read as broken (§10) — and never receives an all-day event or a due
 * task; those belong to the untimed band above it, not here.
 *
 * Each box carries `topPct`/`heightPct`, a lane width, a time label and a
 * title via `style` on its own outer element — none of which a default
 * trigger knows about (spec §7:325), which is why gate 2's Button primitive
 * cannot simply wrap the label. `min-h-[22px]` is a CSS class, not part of
 * the `heightPct` arithmetic above it — `eventPosition` deliberately returns
 * a 15-minute event's true, tiny percentage, and the click target is kept
 * usable here instead.
 *
 * **Only in the day view** (`isDayView`, i.e. exactly one column on screen)
 * does the box become `<EventForm>`'s edit trigger — the whole positioned
 * node passed in as `trigger` rather than splitting position and visuals
 * across two elements, per the task-7 brief's ⚠️. In week view (and the
 * month chips, unchanged) the box stays a `<Link>` to that day's day view:
 * per-column edit triggers there would mean threading `projects`/`clients`/
 * `members` seven times over for a click a reader can already reach in one
 * more hop, and spec §7:325 names only "the day view" as the edit entry
 * point. */
function DayTimeline({
  events,
  window,
  isDayView,
  projects,
  clients,
  members,
}: {
  events: CalendarEventRow[];
  window: { startHour: number; endHour: number };
  isDayView: boolean;
  projects: ProjectOption[];
  clients: ClientOption[];
  members: MemberOption[];
}) {
  const hours = Array.from(
    { length: window.endHour - window.startHour },
    (_, i) => window.startHour + i
  );
  const lanes = new Map(assignLanes(events).map((l) => [l.id, l] as const));
  return (
    <div className="relative" style={{ height: `${hours.length * HOUR_ROW_HEIGHT_PX}px` }}>
      <div className="absolute inset-0 flex flex-col">
        {hours.map((hour) => (
          <span
            key={hour}
            className="mono flex-none border-t border-[var(--border)] pl-1 text-[10px] text-[var(--text-3)]"
            style={{ height: `${HOUR_ROW_HEIGHT_PX}px` }}
          >
            {`${String(hour).padStart(2, "0")}:00`}
          </span>
        ))}
      </div>
      {events.map((event) => {
        const { topPct, heightPct } = eventPosition(event, window);
        const lane = lanes.get(event.id);
        const laneCount = lane?.laneCount ?? 1;
        const widthPct = 100 / laneCount;
        const leftPct = (lane?.lane ?? 0) * widthPct;
        const dotClass = event.projectId
          ? SWATCH[projectColorIndex(event.projectId)]
          : "bg-[var(--accent)]";
        const boxClassName =
          "absolute min-h-[22px] overflow-hidden rounded-md border border-[var(--border)] bg-[var(--surface)] px-1.5 py-0.5 text-[11px] shadow-[var(--shadow)] transition-colors hover:bg-[var(--surface-3)]";
        const boxStyle = {
          top: `${topPct}%`,
          height: `${heightPct}%`,
          left: `calc(${leftPct}% + 2px)`,
          width: `calc(${widthPct}% - 4px)`,
        };
        const boxContent = (
          <>
            <span className="flex items-center gap-1">
              <span aria-hidden="true" className={`h-1.5 w-1.5 flex-none rounded-full ${dotClass}`} />
              <span className="mono truncate text-[10px] text-[var(--text-3)]">
                {eventTimeLabel(event)}
              </span>
            </span>
            <span className="block truncate text-[11px] font-medium text-[var(--text)]">
              {event.title}
            </span>
          </>
        );

        if (!isDayView) {
          return (
            <Link
              key={event.id}
              href={`/calendar?view=day&date=${toDateInputValue(event.startsAt)}`}
              transitionTypes={["nav-forward"]}
              title={event.title}
              className={boxClassName}
              style={boxStyle}
            >
              {boxContent}
            </Link>
          );
        }

        return (
          <EventForm
            key={event.id}
            event={{
              id: event.id,
              title: event.title,
              // CalendarEventRow (spec §6) carries no `description` — it is
              // the grid's row contract, and the grid never displays one.
              // <EventForm>'s edit mode needs the full row and has nothing
              // else to read it from here; see task-7-report.md for why this
              // is flagged rather than silently patched by widening that
              // query's select.
              description: null,
              startsAt: event.startsAt,
              endsAt: event.endsAt,
              allDay: event.allDay,
              projectId: event.projectId,
              clientId: event.clientId,
            }}
            projects={projects}
            clients={clients}
            members={members}
            selectedAttendeeIds={event.attendees.map((a) => a.id)}
            trigger={
              <div title={event.title} className={boxClassName} style={boxStyle}>
                {boxContent}
              </div>
            }
          />
        );
      })}
    </div>
  );
}

/** Week and day share a layout: a column per day, full task rows rather than
 * one-line chips, because there is room for them. Each column now carries
 * two stacked regions below its date header: the untimed band (that day's
 * due tasks and all-day events, headed "Due today · no set time" or "No set
 * time") and the hour timeline (timed events only). The timeline's window is
 * computed once, here, for every column on screen — never per column, which
 * would leave the hour rows unaligned across the grid. */
function ColumnsView({
  days,
  now,
  byDay,
  events,
  eventsByDay,
  projects,
  clients,
  members,
}: {
  days: Date[];
  now: Date;
  byDay: Map<number, TaskListRow[]>;
  events: CalendarEventRow[];
  eventsByDay: Map<number, CalendarEventRow[]>;
  projects: ProjectOption[];
  clients: ClientOption[];
  members: MemberOption[];
}) {
  // Fed the timed rows only, never the raw `events` array: an all-day event
  // runs app-midnight to app-midnight, so a single "Priya on leave" left in
  // would drag this window to 00:00–24:00 for every column on screen (D5,
  // §7) — for a row the timeline does not even carry.
  const window = timelineWindow(splitDayEvents(events).timed);
  // The same invariant the grid className below already keys off: day view
  // is always exactly one column, week view is always seven. Reused rather
  // than re-derived so there is one definition of "is this the day view" —
  // the one place spec §7:325 names as the edit trigger's home.
  const isDayView = days.length === 1;
  return (
    <div className={`grid gap-3 ${isDayView ? "grid-cols-1" : "grid-cols-1 md:grid-cols-7"}`}>
      {days.map((day) => {
        const tasks = byDay.get(day.getTime()) ?? [];
        const dayEvents = eventsByDay.get(day.getTime()) ?? [];
        const { untimed: allDayEvents, timed: timedEvents } = splitDayEvents(dayEvents);
        const isToday = isSameAppDay(day, now);
        const hasBandContent = tasks.length > 0 || allDayEvents.length > 0;
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
            {/* The untimed band: due tasks and all-day events. Renders
                nothing at all — no heading, no empty dash — when the day
                has neither, so a week of pure meetings does not grow seven
                empty captions. */}
            {hasBandContent ? (
              <div className="border-b border-[var(--border)] p-2">
                <span className="px-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-3)]">
                  {isToday ? "Due today · no set time" : "No set time"}
                </span>
                <div className="mt-1 flex flex-col gap-1">
                  {allDayEvents.map((event) => (
                    <UntimedEventRow key={event.id} event={event} />
                  ))}
                  {tasks.map((row) => (
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
                  ))}
                </div>
              </div>
            ) : null}
            {/* The hour timeline: timed events only, positioned within the
                window shared by every column on screen. */}
            <div className="p-2">
              <DayTimeline
                events={timedEvents}
                window={window}
                isDayView={isDayView}
                projects={projects}
                clients={clients}
                members={members}
              />
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
  events,
  projects,
  clients,
  members,
}: {
  view: CalendarView;
  anchor: Date;
  now: Date;
  rows: TaskListRow[];
  events: CalendarEventRow[];
  /** Only read by the day view's `<EventForm>` edit trigger (below) — month
   * and week never open the form, so `MonthView` takes none of these three. */
  projects: ProjectOption[];
  clients: ClientOption[];
  members: MemberOption[];
}) {
  // Bucketed by app-midnight epoch, which is what each cell looks itself up
  // by — never by slicing an ISO string, because the dueDate column carries no
  // constraint forcing midnight.
  const byDay = groupByAppDay(rows, (r) => r.dueDate);
  const eventsByDay = groupByAppDay(events, (e) => e.startsAt);

  if (view === "month") {
    return <MonthView anchor={anchor} now={now} byDay={byDay} eventsByDay={eventsByDay} />;
  }
  if (view === "week") {
    const start = startOfAppWeek(anchor);
    return (
      <ColumnsView
        days={Array.from({ length: 7 }, (_, i) => addDays(start, i))}
        now={now}
        byDay={byDay}
        events={events}
        eventsByDay={eventsByDay}
        projects={projects}
        clients={clients}
        members={members}
      />
    );
  }
  return (
    <ColumnsView
      days={[startOfAppDay(anchor)]}
      now={now}
      byDay={byDay}
      events={events}
      eventsByDay={eventsByDay}
      projects={projects}
      clients={clients}
      members={members}
    />
  );
}
