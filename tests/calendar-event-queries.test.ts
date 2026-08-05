import { describe, it, expect } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { listCalendarEventsInRange } from "@/lib/calendar-event-queries";

type EventRow = {
  id: string;
  title: string;
  description: string | null;
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

function fakeDb(parts: { events?: EventRow[] }) {
  const byDelegate = { calendarEvent: 0 };
  const findManyArgs: unknown[] = [];

  const db = {
    calendarEvent: {
      findMany: async (args: unknown) => {
        byDelegate.calendarEvent++;
        findManyArgs.push(args);
        return parts.events ?? [];
      },
    },
  } as unknown as PrismaClient;

  return { db, callsByDelegate: () => ({ ...byDelegate }), findManyArgs };
}

const STARTS = new Date("2026-08-14T09:00:00.000Z");
const ENDS = new Date("2026-08-14T10:00:00.000Z");

function eventRow(overrides: Partial<EventRow> = {}): EventRow {
  return {
    id: "e1",
    title: "Kickoff call",
    description: null,
    startsAt: STARTS,
    endsAt: ENDS,
    allDay: false,
    creatorId: "u1",
    projectId: "p1",
    project: { name: "Brand Guidelines v3" },
    clientId: "c1",
    client: { name: "Harlow & Fitch" },
    attendees: [],
    ...overrides,
  };
}

describe("listCalendarEventsInRange", () => {
  const FROM = new Date("2026-07-27T00:00:00.000Z");
  const TO = new Date("2026-09-07T00:00:00.000Z");
  const where = (args: unknown) => (args as { where: Record<string, unknown> }).where;

  it("filters by a half-open startsAt window", async () => {
    const { db, findManyArgs } = fakeDb({ events: [] });
    await listCalendarEventsInRange(db, { from: FROM, to: TO });
    expect(where(findManyArgs[0]).startsAt).toEqual({ gte: FROM, lt: TO });
  });

  it("issues exactly one query", async () => {
    const { db, callsByDelegate } = fakeDb({ events: [eventRow()] });
    await listCalendarEventsInRange(db, { from: FROM, to: TO });
    expect(callsByDelegate()).toEqual({ calendarEvent: 1 });
  });

  it("never applies a status filter — events have no status", async () => {
    const { db, findManyArgs } = fakeDb({ events: [] });
    await listCalendarEventsInRange(db, { from: FROM, to: TO });
    expect(where(findManyArgs[0])).not.toHaveProperty("status");
  });

  it("adds a person filter only when asked, by attendee", async () => {
    const { db, findManyArgs } = fakeDb({ events: [] });
    await listCalendarEventsInRange(db, { from: FROM, to: TO });
    expect(where(findManyArgs[0]).attendees).toBeUndefined();

    const second = fakeDb({ events: [] });
    await listCalendarEventsInRange(second.db, { from: FROM, to: TO, userId: "u1" });
    expect(where(second.findManyArgs[0]).attendees).toEqual({ some: { userId: "u1" } });
  });

  it("adds a project filter only when asked", async () => {
    const { db, findManyArgs } = fakeDb({ events: [] });
    await listCalendarEventsInRange(db, { from: FROM, to: TO, projectId: "p1" });
    expect(where(findManyArgs[0]).projectId).toBe("p1");
  });

  // An empty string is what an unselected <select> submits; it must not
  // become a filter matching nothing — same rule as listTasksInRange.
  it("ignores empty-string filters", async () => {
    const { db, findManyArgs } = fakeDb({ events: [] });
    await listCalendarEventsInRange(db, { from: FROM, to: TO, userId: "", projectId: "" });
    expect(where(findManyArgs[0]).attendees).toBeUndefined();
    expect(where(findManyArgs[0]).projectId).toBeUndefined();
  });

  it("orders all-day first, then by start time, then by createdAt", async () => {
    const { db, findManyArgs } = fakeDb({ events: [] });
    await listCalendarEventsInRange(db, { from: FROM, to: TO });
    expect((findManyArgs[0] as { orderBy: unknown }).orderBy).toEqual([
      { allDay: "desc" },
      { startsAt: "asc" },
      { createdAt: "asc" },
    ]);
  });

  it("maps a row through the shared flat shape, with project and client carried through", async () => {
    const { db } = fakeDb({ events: [eventRow()] });
    const rows = await listCalendarEventsInRange(db, { from: FROM, to: TO });
    expect(rows[0]).toEqual({
      id: "e1",
      title: "Kickoff call",
      description: null,
      startsAt: STARTS,
      endsAt: ENDS,
      allDay: false,
      creatorId: "u1",
      projectId: "p1",
      projectName: "Brand Guidelines v3",
      clientId: "c1",
      clientName: "Harlow & Fitch",
      attendees: [],
    });
  });

  // The regression case for the day-view edit bug: CalendarEventRow briefly
  // carried no `description` field, so <EventForm>'s edit-mode seed was
  // always empty and every save through the day view wrote that emptiness
  // back over whatever was stored. This is the assertion that would have
  // caught it — a stored, non-null description surviving the row mapping
  // unchanged.
  it("carries a stored description through to the row unchanged", async () => {
    const { db } = fakeDb({
      events: [eventRow({ description: "Bring the deck and last month's numbers" })],
    });
    const rows = await listCalendarEventsInRange(db, { from: FROM, to: TO });
    expect(rows[0].description).toBe("Bring the deck and last month's numbers");
  });

  it("carries nulls for project and client on an event with neither", async () => {
    const { db } = fakeDb({
      events: [eventRow({ projectId: null, project: null, clientId: null, client: null })],
    });
    const rows = await listCalendarEventsInRange(db, { from: FROM, to: TO });
    expect(rows[0].projectId).toBeNull();
    expect(rows[0].projectName).toBeNull();
    expect(rows[0].clientId).toBeNull();
    expect(rows[0].clientName).toBeNull();
  });

  it("carries every attendee with initials derived by clientInitials", async () => {
    const { db } = fakeDb({
      events: [eventRow({ attendees: [{ user: { id: "u2", name: "Dana Reeve" } }] })],
    });
    const rows = await listCalendarEventsInRange(db, { from: FROM, to: TO });
    expect(rows[0].attendees).toEqual([{ id: "u2", name: "Dana Reeve", initials: "DR" }]);
  });
});
