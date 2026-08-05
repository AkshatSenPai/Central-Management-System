"use server";

/**
 * Revalidation map — keep in sync with the calls below.
 *
 * | Mutation                    | revalidatePath calls |
 * |-------------------------------|-----------------------|
 * | createCalendarEventAction      | `/calendar`            |
 * | updateCalendarEventAction      | `/calendar`            |
 * | removeCalendarEventAction      | `/calendar`            |
 *
 * One path, unconditionally, on all three — unlike tasks.ts, which fans out
 * to `/projects`, `/clients` and `/tasks/{id}` because a task's row is
 * rendered on all of those pages too. An event has exactly one surface
 * (spec §6: "One route changes: /calendar. No route is added"), so there is
 * no projectId/clientId branch here to get right or wrong.
 *
 * Every action here is requireUser — there is no requireAdmin anywhere in
 * this file. Writes are creator-or-admin (D10), and that check lives in the
 * service, not at the door, for the reason announcements.ts:16-17 already
 * gives: a member editing their own post (here, their own event) is allowed.
 *
 * Every scalar FormData read is `String(formData.get("x") ?? "")`. The one
 * documented exception is the attendee list, read as
 * `formData.getAll("userId").map(String)` — AssigneePicker names every
 * checkbox `userId`, and `formData.get` would silently return only the
 * first (tasks.ts:20-24).
 */

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { err, type ActionResult } from "@/lib/action-result";
import { AuthError, requireUser } from "@/server/guards";
import { calendarEventSchema, validateEventTimes } from "@/lib/calendar-event";
import { addDays, appDateTime, parseDateInput, parseTimeInput, startOfAppDay } from "@/lib/dates";
import {
  createCalendarEvent,
  updateCalendarEvent,
  removeCalendarEvent,
} from "@/lib/calendar-event-service";

/** Turns the form's `date` field plus its `allDay` flag into the
 * `[startsAt, endsAt)` pair the service writes, or an error string naming
 * which part is wrong. Two branches, and they build the pair two different
 * ways on purpose:
 *
 * All-day skips `startTime`/`endTime` entirely — the form never renders
 * them once the checkbox is on, and D5 is explicit that those bounds are "a
 * storage artefact, app-midnight to app-midnight … never a value a user
 * set". So there is no wall-clock time to turn into an instant, and
 * `appDateTime` is the wrong tool: routing a synthesized `"00:00"` through
 * it just to reuse one function would be arithmetic invented to justify the
 * call, not arithmetic the task needs. What the task needs is exactly
 * `calendarRange`'s day window (`calendar.ts:46-47`) and `dashboard.ts`'s
 * today/tomorrow pair (`:43-44`) already build: `startOfAppDay` for the
 * open end, `addDays(…, 1)` for the exclusive close.
 *
 * The timed branch is the opposite case — two wall-clock times the user
 * actually picked — and `appDateTime` is "the only place in this app a
 * wall-clock time becomes a stored instant … no other call site is allowed
 * to do this arithmetic itself" (`dates.ts:62-64`). `validateEventTimes`
 * still needs minutes-since-midnight, not a `Date`, so `parseTimeInput` runs
 * first for the order check and `appDateTime` runs second to build the
 * instants it already proved are in order. */
function resolveEventTimes(
  formData: FormData,
  allDay: boolean
): { startsAt: Date; endsAt: Date } | { error: string } {
  const date = String(formData.get("date") ?? "");

  if (allDay) {
    const parsedDate = parseDateInput(date);
    if (!parsedDate) return { error: "Invalid input" };
    const startsAt = startOfAppDay(parsedDate);
    return { startsAt, endsAt: addDays(startsAt, 1) };
  }

  const startTime = String(formData.get("startTime") ?? "");
  const endTime = String(formData.get("endTime") ?? "");
  const timeError = validateEventTimes(parseTimeInput(startTime), parseTimeInput(endTime), false);
  if (timeError) return { error: timeError };

  // parseTimeInput already proved both halves parse, above — the only way
  // either call below can still return null is an unparseable `date`.
  const startsAt = appDateTime(date, startTime);
  const endsAt = appDateTime(date, endTime);
  if (!startsAt || !endsAt) return { error: "Invalid input" };
  return { startsAt, endsAt };
}

export async function createCalendarEventAction(
  _prev: ActionResult<{ id: string }> | null,
  formData: FormData
): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireUser();
    const parsed = calendarEventSchema.safeParse({
      title: formData.get("title"),
      description: formData.get("description"),
      projectId: formData.get("projectId"),
      clientId: formData.get("clientId"),
    });
    if (!parsed.success) {
      return err(parsed.error.issues[0]?.message ?? "Invalid input");
    }
    const { title, description, projectId, clientId } = parsed.data;

    const allDay = formData.get("allDay") === "1";
    const times = resolveEventTimes(formData, allDay);
    if ("error" in times) return err(times.error);

    const attendeeIds = formData.getAll("userId").map(String);

    const result = await createCalendarEvent(prisma, {
      title,
      description: description || null,
      startsAt: times.startsAt,
      endsAt: times.endsAt,
      allDay,
      projectId: projectId || null,
      clientId: clientId || null,
      attendeeIds,
      actorId: user.id,
    });
    revalidatePath("/calendar");
    return result;
  } catch (e) {
    if (e instanceof AuthError) return err(e.message);
    throw e;
  }
}

export async function updateCalendarEventAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const eventId = String(formData.get("eventId") ?? "");
    const parsed = calendarEventSchema.safeParse({
      title: formData.get("title"),
      description: formData.get("description"),
      projectId: formData.get("projectId"),
      clientId: formData.get("clientId"),
    });
    if (!parsed.success) {
      return err(parsed.error.issues[0]?.message ?? "Invalid input");
    }
    const { title, description, projectId, clientId } = parsed.data;

    const allDay = formData.get("allDay") === "1";
    const times = resolveEventTimes(formData, allDay);
    if ("error" in times) return err(times.error);

    const attendeeIds = formData.getAll("userId").map(String);

    const result = await updateCalendarEvent(prisma, {
      eventId,
      title,
      description: description || null,
      startsAt: times.startsAt,
      endsAt: times.endsAt,
      allDay,
      projectId: projectId || null,
      clientId: clientId || null,
      attendeeIds,
      actorId: user.id,
      isAdmin: user.role === "ADMIN",
    });
    revalidatePath("/calendar");
    return result;
  } catch (e) {
    if (e instanceof AuthError) return err(e.message);
    throw e;
  }
}

export async function removeCalendarEventAction(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const eventId = String(formData.get("eventId") ?? "");
    const result = await removeCalendarEvent(prisma, {
      eventId,
      actorId: user.id,
      isAdmin: user.role === "ADMIN",
    });
    revalidatePath("/calendar");
    return result;
  } catch (e) {
    if (e instanceof AuthError) return err(e.message);
    throw e;
  }
}
