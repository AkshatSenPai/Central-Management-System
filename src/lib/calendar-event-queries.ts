import { Prisma, type PrismaClient } from "@prisma/client";
import { clientInitials } from "@/lib/client";

/** The grid's per-event contract (spec §6), and its one read query. Lives
 * here rather than in `calendar-event.ts` because it is the query's output
 * shape, the same reasoning `TaskListRow` sits in `task-queries.ts` rather
 * than `task.ts` (`task-queries.ts:13-26`). `calendar-event.ts` imports it
 * as a type only, so this file's Prisma dependency never reaches the one
 * unit-testable, DOM-free surface calendar events have. */
export type CalendarEventRow = {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  creatorId: string;
  projectId: string | null;
  projectName: string | null;
  clientId: string | null;
  clientName: string | null;
  attendees: Array<{ id: string; name: string; initials: string }>;
};

/** The shape the one query selects. Unlike `taskRowSelect`, `project` and
 * `client` are each read straight off the event's own FK rather than one
 * derived through the other — the schema comment at `schema.prisma:365-369`
 * says why: a client-with-no-project is the prospect pitch, and deriving
 * `clientId` through `projectId` the way `Task` does would make that case
 * unrepresentable. */
const calendarEventRowSelect = {
  id: true,
  title: true,
  startsAt: true,
  endsAt: true,
  allDay: true,
  creatorId: true,
  projectId: true,
  project: { select: { name: true } },
  clientId: true,
  client: { select: { name: true } },
  attendees: { select: { user: { select: { id: true, name: true } } } },
} as const;

type CalendarEventRowSource = {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  creatorId: string;
  projectId: string | null;
  project: { name: string } | null;
  clientId: string | null;
  client: { name: string } | null;
  attendees: { user: { id: string; name: string } }[];
};

/** Same helper `mapAssignees` (`task-queries.ts:56`) uses for task assignee
 * initials — one `clientInitials` call site's worth of behaviour, not a
 * second one that could drift from it. */
function mapAttendees(rows: { user: { id: string; name: string } }[]) {
  return rows.map((a) => ({ id: a.user.id, name: a.user.name, initials: clientInitials(a.user.name) }));
}

function toCalendarEventRow(e: CalendarEventRowSource): CalendarEventRow {
  return {
    id: e.id,
    title: e.title,
    startsAt: e.startsAt,
    endsAt: e.endsAt,
    allDay: e.allDay,
    creatorId: e.creatorId,
    projectId: e.projectId,
    projectName: e.project?.name ?? null,
    clientId: e.clientId,
    clientName: e.client?.name ?? null,
    attendees: mapAttendees(e.attendees),
  };
}

/** Events inside a half-open window, for the calendar grid. Mirrors
 * `listTasksInRange` (`task-queries.ts:129`): same half-open `gte`/`lt`
 * clause on the window column, same optional attendee/project filters that
 * only attach when a truthy id is given so an unselected `<select>`'s empty
 * string can never narrow the result to nothing.
 *
 * **No status parameter, and none should ever be added.** Events have no
 * status column — the schema has nothing to filter on — and a status filter
 * here would silently apply a task's vocabulary to a model that does not
 * have it, hiding every event the moment a caller picked one. Spec §6 states
 * the accepted alternative: `status=DONE` shows completed tasks *and* every
 * event, which is honest about what the calendar is actually filtering.
 *
 * Ordering is `[allDay desc, startsAt asc, createdAt asc]`. The first key is
 * the deliberate one: Postgres sorts `false` before `true`, so ordering
 * `allDay` ascending would put timed events first and bury the all-day rows
 * — the ones that belong at the top of a cell and in the untimed band —
 * beneath them. `desc` here is what makes that order come out right, not a
 * copy-paste of `listTasksInRange`'s `asc` defaults. */
export async function listCalendarEventsInRange(
  db: PrismaClient,
  input: { from: Date; to: Date; userId?: string | null; projectId?: string | null }
): Promise<CalendarEventRow[]> {
  const where: Prisma.CalendarEventWhereInput = { startsAt: { gte: input.from, lt: input.to } };
  if (input.userId) where.attendees = { some: { userId: input.userId } };
  if (input.projectId) where.projectId = input.projectId;

  const events = await db.calendarEvent.findMany({
    where,
    orderBy: [{ allDay: "desc" }, { startsAt: "asc" }, { createdAt: "asc" }],
    select: calendarEventRowSelect,
  });

  return events.map(toCalendarEventRow);
}
