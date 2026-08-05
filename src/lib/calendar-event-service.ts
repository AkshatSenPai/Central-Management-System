import type { PrismaClient } from "@prisma/client";
import { ActionResult, ok, err } from "@/lib/action-result";
import { recordActivity } from "@/lib/activity";
import { notify } from "@/lib/notification-service";
import { eventTimeLabel } from "@/lib/calendar-event";
import { toDateInputValue } from "@/lib/dates";

/** The fields `createCalendarEvent` and Task 4's `updateCalendarEvent` both
 * write. No `attendeeIds` here — create resolves the whole set up front,
 * update diffs it (the `attemptTaskAssigneeDiff` shape), so the two need
 * different call shapes around this common core, the same reason
 * `TaskWriteInput` (task-service.ts:7-14) stays a plain field bag rather than
 * carrying `assigneeIds` itself. */
export type CalendarEventWriteInput = {
  title: string;
  description: string | null;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  projectId: string | null;
  /** The direct client picker's value, live only when no project is chosen
   * (spec §8 item 6 — the prospect-with-no-project case). Overwritten below
   * whenever a project resolves, so a project's client always wins. */
  clientId: string | null;
};

/** De-duplicates, asks only for active users, and returns null when fewer
 * rows come back than distinct ids requested — an unknown id and a
 * deactivated one are indistinguishable to the caller, and both map to
 * "Invalid input" with no write issued. A twin of task-service.ts's
 * resolveAssignees rather than a shared import: that function's own doc
 * comment says it is "module-private", reused only by that file's own
 * assignment diff, and exporting it to save nine lines would couple this
 * service to task-service.ts through a function whose contract was never
 * meant to be shared. Implementer's call if the two turn out to diverge in
 * nothing at all — but it is a call, not an import that already works. */
async function resolveAttendees(
  db: PrismaClient,
  ids: string[]
): Promise<{ id: string; name: string }[] | null> {
  const uniqueIds = Array.from(new Set(ids));
  if (uniqueIds.length === 0) return [];
  const users = await db.user.findMany({
    where: { id: { in: uniqueIds }, active: true },
    select: { id: true, name: true },
  });
  return users.length < uniqueIds.length ? null : users;
}

export async function createCalendarEvent(
  db: PrismaClient,
  input: CalendarEventWriteInput & { attendeeIds: string[]; actorId: string }
): Promise<ActionResult<{ id: string }>> {
  const title = input.title.trim();
  if (!title) return err("Give the event a title");

  // A project pins the client too (spec §4): the form derives a matching
  // hidden value for its own submit, but trusting that instead of re-reading
  // the project here would let a stale or tampered clientId disagree with a
  // real projectId. Mirrors createTask's own clientId resolution
  // (task-service.ts:113-124), except the result is stored on the row itself
  // rather than only carried for the activity log's scope — CalendarEvent
  // has its own clientId column (schema.prisma:372-373), Task does not.
  let clientId = input.clientId;
  if (input.projectId) {
    const project = await db.project.findUnique({
      where: { id: input.projectId },
      select: { clientId: true },
    });
    if (!project) return err("Project not found");
    clientId = project.clientId;
  }

  const attendees = input.attendeeIds.length > 0 ? await resolveAttendees(db, input.attendeeIds) : [];
  if (attendees === null) return err("Invalid input");

  const created = await db.$transaction(async (tx) => {
    const event = await tx.calendarEvent.create({
      data: {
        title,
        description: input.description,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        allDay: input.allDay,
        creatorId: input.actorId,
        projectId: input.projectId,
        clientId,
      },
    });
    if (attendees.length > 0) {
      await tx.calendarEventAttendee.createMany({
        data: attendees.map((attendee) => ({ eventId: event.id, userId: attendee.id })),
        skipDuplicates: true,
      });
    }
    // Exactly one row per call (R6/R16's rule, reused): the initial
    // attendees are part of event.created's own story, never a separate
    // event.assigned event — this model has no such verb at all.
    await recordActivity(tx, {
      actorId: input.actorId,
      entityType: "CALENDAR_EVENT",
      entityId: event.id,
      action: "event.created",
      clientId,
      meta: { name: event.title },
    });
    // `when` and `date` are display data frozen at write time (spec §9): a
    // later time change writes a fresh row rather than editing this one, so
    // an old notification keeps saying where the event was when it fired.
    // `date` is not optional — without it notificationHref has nowhere to
    // point and falls back to `/calendar` at whatever period the URL
    // defaults to, a link that appears to work and does not.
    await notify(tx, {
      recipientIds: attendees.map((attendee) => attendee.id),
      actorId: input.actorId,
      type: "EVENT_SCHEDULED",
      entityType: "CALENDAR_EVENT",
      entityId: event.id,
      meta: {
        name: event.title,
        when: eventTimeLabel({ startsAt: event.startsAt, endsAt: event.endsAt, allDay: event.allDay }),
        date: toDateInputValue(event.startsAt),
      },
    });
    return event;
  });
  return ok({ id: created.id });
}
