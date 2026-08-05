import { Prisma, type PrismaClient } from "@prisma/client";
import { ActionResult, ok, err } from "@/lib/action-result";
import { recordActivity, fieldDiff } from "@/lib/activity";
import { notify, clearNotificationsFor } from "@/lib/notification-service";
import { eventTimeLabel } from "@/lib/calendar-event";
import { toDateInputValue } from "@/lib/dates";

const UPDATABLE_FIELDS = [
  "title",
  "description",
  "startsAt",
  "endsAt",
  "allDay",
  "projectId",
  "clientId",
] as const;

const PERMISSION_DENIED = "You can only edit events you created";

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

function pick<T extends object, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const key of keys) out[key] = obj[key];
  return out;
}

/** True when `e` is the row-vanished error a concurrent delete can race a
 * later update or delete into. Duplicated rather than imported —
 * `announcement-service.ts:8-10` sets the precedent, copying this same
 * three-liner rather than reaching into `task-service.ts` for its unexported
 * copy. `createCalendarEvent` never needed this: nothing in a create can
 * throw P2025. Update and remove both load-then-write, so they can. */
function isRowGoneRace(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025";
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

export async function updateCalendarEvent(
  db: PrismaClient,
  input: CalendarEventWriteInput & {
    eventId: string;
    attendeeIds: string[];
    actorId: string;
    isAdmin: boolean;
  }
): Promise<ActionResult> {
  const title = input.title.trim();
  if (!title) return err("Give the event a title");

  const existing = await db.calendarEvent.findUnique({
    where: { id: input.eventId },
    select: {
      title: true,
      description: true,
      startsAt: true,
      endsAt: true,
      allDay: true,
      projectId: true,
      clientId: true,
      creatorId: true,
    },
  });
  if (!existing) return err("Event not found");

  // D10: creator or admin, the announcement-service.ts:82 check, applied to
  // the other studio-wide writable object. Attendance grants no write.
  if (existing.creatorId !== input.actorId && !input.isAdmin) {
    return err(PERMISSION_DENIED);
  }

  // Mirrors createCalendarEvent's own resolution, except only when the
  // project actually moved (updateTask's own guard, task-service.ts:207): an
  // unchanged project's clientId cannot have silently diverged from the row's
  // stored value, since nothing else ever writes CalendarEvent.clientId, so
  // re-deriving it here would be a lookup that only ever confirms what is
  // already known.
  //
  // A direct-supplied clientId (no project chosen) is left unchecked against
  // a real Client row here, same as createCalendarEvent — a known gap Task
  // 3's review flagged (spec §8:359-364 only mandates checking the
  // project-derived clientId) and inherited rather than fixed in this task.
  // Fixing only the update path would leave create still exposed to the same
  // tampered-id P2003 while widening what this task has to test; the
  // consistent call is to leave both sides of the gap exactly as wide as
  // Task 3 left them, recorded here rather than silently closed or silently
  // left in only one of the two places it appears.
  let clientId = input.clientId;
  if (input.projectId && input.projectId !== existing.projectId) {
    const project = await db.project.findUnique({
      where: { id: input.projectId },
      select: { clientId: true },
    });
    if (!project) return err("Project not found");
    clientId = project.clientId;
  } else if (input.projectId) {
    clientId = existing.clientId;
  }

  const candidate = {
    title,
    description: input.description,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    allDay: input.allDay,
    projectId: input.projectId,
    clientId,
  };
  const changes = fieldDiff(existing, candidate, [...UPDATABLE_FIELDS]);

  // The attendee set is a true diff, the attemptTaskAssigneeDiff shape
  // (task-service.ts:357-435): only added ids are ever validated, removed
  // ones read their names off rows already loaded, and a resubmission of the
  // current set lands in neither list.
  const current = await db.calendarEventAttendee.findMany({
    where: { eventId: input.eventId },
    select: { userId: true, user: { select: { name: true } } },
  });
  const currentIds = current.map((row) => row.userId);
  const requestedIds = Array.from(new Set(input.attendeeIds));
  const addedIds = requestedIds.filter((id) => !currentIds.includes(id));
  const removedIds = currentIds.filter((id) => !requestedIds.includes(id));

  // fieldDiff's normalize compares dates BY VALUE (activity.ts:97), so
  // re-saving an unchanged time lands here too — nothing is logged and
  // nothing rings.
  if (!changes && addedIds.length === 0 && removedIds.length === 0) return ok(undefined);

  const added = addedIds.length > 0 ? await resolveAttendees(db, addedIds) : [];
  if (added === null) return err("Invalid input");

  const data = changes ? pick(candidate, Object.keys(changes) as (keyof typeof candidate)[]) : null;

  // The bell fires ONLY when the clock moved (D7/§9) — not a title edit, not
  // a description edit, not an attendee change on its own. Checked against
  // fieldDiff's own result rather than re-comparing the raw values, so this
  // can never drift from what actually got written.
  const timeMoved = changes !== null && ["startsAt", "endsAt", "allDay"].some((field) => field in changes);

  try {
    await db.$transaction(async (tx) => {
      if (data) {
        await tx.calendarEvent.update({ where: { id: input.eventId }, data });
      }
      // Scoped to exactly the departed/added ids — a true diff, never a
      // blanket rewrite of the whole set.
      if (removedIds.length > 0) {
        await tx.calendarEventAttendee.deleteMany({
          where: { eventId: input.eventId, userId: { in: removedIds } },
        });
      }
      if (addedIds.length > 0) {
        await tx.calendarEventAttendee.createMany({
          data: addedIds.map((userId) => ({ eventId: input.eventId, userId })),
          skipDuplicates: true,
        });
      }
      // Exactly one row per call (task-service.ts:160-161's rule, reused):
      // unlike Task, this model has no task.assigned/unassigned twin, so a
      // field change and an attendee change on the same submit still fold
      // into the one verb this vocabulary lock defines for "something about
      // this event changed" (spec §13).
      await recordActivity(tx, {
        actorId: input.actorId,
        entityType: "CALENDAR_EVENT",
        entityId: input.eventId,
        action: "event.updated",
        clientId,
        meta: { name: title },
      });
      if (timeMoved) {
        // The attendees AFTER the diff — someone just dropped from the
        // event must not be told it moved out from under them, and someone
        // just added to it should hear where it landed.
        const recipientIds = [...currentIds.filter((id) => !removedIds.includes(id)), ...addedIds];
        await notify(tx, {
          recipientIds,
          actorId: input.actorId,
          type: "EVENT_SCHEDULED",
          entityType: "CALENDAR_EVENT",
          entityId: input.eventId,
          meta: {
            name: title,
            when: eventTimeLabel({
              startsAt: candidate.startsAt,
              endsAt: candidate.endsAt,
              allDay: candidate.allDay,
            }),
            // The frozen string saying where the event WAS, computed from
            // the row as loaded before this write touched it.
            movedFrom: eventTimeLabel({
              startsAt: existing.startsAt,
              endsAt: existing.endsAt,
              allDay: existing.allDay,
            }),
            // Not optional: without it every "moved" row takes
            // notificationHref's /calendar fallback instead of landing on
            // the day the event is now on.
            date: toDateInputValue(candidate.startsAt),
          },
        });
      }
    });
  } catch (e) {
    if (isRowGoneRace(e)) return err("Event not found");
    throw e;
  }
  return ok(undefined);
}

export async function removeCalendarEvent(
  db: PrismaClient,
  input: { eventId: string; actorId: string; isAdmin: boolean }
): Promise<ActionResult> {
  const existing = await db.calendarEvent.findUnique({
    where: { id: input.eventId },
    select: { title: true, creatorId: true, clientId: true },
  });
  if (!existing) return err("Event not found");
  if (existing.creatorId !== input.actorId && !input.isAdmin) {
    return err(PERMISSION_DENIED);
  }

  // Captured before the delete — afterwards there is nothing left to read.
  const title = existing.title;

  try {
    await db.$transaction(async (tx) => {
      await tx.calendarEvent.delete({ where: { id: input.eventId } });
      // Attendee rows are Cascade-deleted by the FK (schema.prisma:392); no
      // manual join-row cleanup belongs here.
      //
      // entityId carries no foreign key, so nothing cascades to it — the
      // same reason removeTask clears its own (task-service.ts:330).
      await clearNotificationsFor(tx, { entityType: "CALENDAR_EVENT", entityId: input.eventId });
      // Left alone, never cleared: the activity log is an audit trail and
      // must outlive its subject (task-service.ts:327-329), unlike a
      // notification, which is only a link to a 404 once the row is gone.
      // This call ADDS a row rather than removing one — the event's own
      // cancellation is itself part of the story the feed tells.
      await recordActivity(tx, {
        actorId: input.actorId,
        entityType: "CALENDAR_EVENT",
        entityId: input.eventId,
        action: "event.removed",
        clientId: existing.clientId,
        meta: { name: title },
      });
    });
  } catch (e) {
    if (isRowGoneRace(e)) return err("Event not found");
    throw e;
  }
  return ok(undefined);
}
