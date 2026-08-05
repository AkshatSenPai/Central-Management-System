import { describe, it, expect } from "vitest";
import { appTimeLabel } from "@/lib/dates";
import {
  assignLanes,
  attendeeInitialsLabel,
  calendarEventSchema,
  calendarPeriodSummary,
  eventPosition,
  eventTimeLabel,
  monthCellRows,
  splitDayEvents,
  timelineWindow,
  validateEventTimes,
} from "@/lib/calendar-event";
import type { CalendarEventRow } from "@/lib/calendar-event-queries";

/** Minimal CalendarEventRow builder for the timeline-geometry tests below.
 * They only ever vary id/startsAt/endsAt/allDay, and spelling out project,
 * client and attendee fields on every fixture would bury the one or two
 * values each test actually asserts on under boilerplate nobody reads. */
function eventRow(overrides: {
  id: string;
  startsAt: Date;
  endsAt: Date;
  allDay?: boolean;
}): CalendarEventRow {
  return {
    title: "Event",
    creatorId: "u1",
    projectId: null,
    projectName: null,
    clientId: null,
    clientName: null,
    attendees: [],
    allDay: false,
    ...overrides,
  };
}

describe("appTimeLabel", () => {
  // 09:30Z + 05:30 = 15:00 IST — derived from the offset, not copied from
  // anywhere else in this repo.
  it("renders 24-hour app-zone time", () => {
    expect(appTimeLabel(new Date("2026-08-04T09:30:00.000Z"))).toBe("15:00");
  });

  // 19:05Z + 05:30 = 24:35, which is 00:35 on the next IST day. This is the
  // case that would catch a UTC-hour formatter: the wrap, not just the pad.
  it("wraps a late UTC instant into the next app day's early hours", () => {
    expect(appTimeLabel(new Date("2026-08-04T19:05:00.000Z"))).toBe("00:35");
  });

  // 00:00Z + 05:30 = 05:30 — a single-digit UTC hour still comes out
  // two-digit and 24-hour, never "5:30 am".
  it("pads to two digits and never prints am/pm", () => {
    const label = appTimeLabel(new Date("2026-08-04T00:00:00.000Z"));
    expect(label).toBe("05:30");
    expect(label).not.toMatch(/am|pm/i);
  });
});

describe("calendarPeriodSummary", () => {
  it("pluralises both halves for the both-zero case", () => {
    expect(calendarPeriodSummary(0, 0)).toBe("0 tasks due · 0 events in this period");
  });

  it("singularises the task half only", () => {
    expect(calendarPeriodSummary(1, 0)).toBe("1 task due · 0 events in this period");
  });

  it("singularises the event half only", () => {
    expect(calendarPeriodSummary(0, 1)).toBe("0 tasks due · 1 event in this period");
  });

  it("pluralises both halves independently", () => {
    expect(calendarPeriodSummary(2, 3)).toBe("2 tasks due · 3 events in this period");
  });
});

describe("eventTimeLabel", () => {
  it("never prints a clock for an all-day event, even at the app-midnight bound", () => {
    // All-day bounds are app-midnight to app-midnight (D5) — a storage
    // artefact, not a chosen time — so a start of exactly app-midnight must
    // not surface as "00:00".
    const label = eventTimeLabel({
      startsAt: new Date("2026-08-03T18:30:00.000Z"), // app-midnight, 4 Aug IST
      endsAt: new Date("2026-08-04T18:30:00.000Z"),
      allDay: true,
    });
    expect(label).toBe("All day");
  });

  it("renders a start – end range for a timed event, from a UTC instant that differs from its IST rendering", () => {
    // 11:00Z + 05:30 = 16:30 IST; 12:00Z + 05:30 = 17:30 IST. Neither UTC
    // hour matches its IST rendering, so this is the case spec §12 calls
    // "the one test that would have caught a display-only timezone fix" —
    // a fixture that happened to read the same in both zones would pass
    // even if the function silently formatted in UTC.
    const label = eventTimeLabel({
      startsAt: new Date("2026-08-04T11:00:00.000Z"),
      endsAt: new Date("2026-08-04T12:00:00.000Z"),
      allDay: false,
    });
    expect(label).toBe("16:30 – 17:30");
  });
});

describe("splitDayEvents", () => {
  it("partitions into untimed and timed, preserving order within each", () => {
    const events = [
      { id: "a", allDay: false },
      { id: "b", allDay: true },
      { id: "c", allDay: false },
      { id: "d", allDay: true },
    ];
    const { timed, untimed } = splitDayEvents(events);
    expect(timed.map((e) => e.id)).toEqual(["a", "c"]);
    expect(untimed.map((e) => e.id)).toEqual(["b", "d"]);
  });

  it("returns empty arrays for no events", () => {
    expect(splitDayEvents([])).toEqual({ untimed: [], timed: [] });
  });
});

describe("monthCellRows", () => {
  // 2 events + 5 tasks, limit 3: events fill first, tasks take what remains.
  it("fills events first and gives tasks whatever remains", () => {
    const events = ["e1", "e2"];
    const tasks = ["t1", "t2", "t3", "t4", "t5"];
    expect(monthCellRows(events, tasks, 3)).toEqual({
      events: ["e1", "e2"],
      tasks: ["t1"],
      overflow: 4,
    });
  });

  // 5 events + 0 tasks, limit 3: events alone can exhaust the cap.
  it("caps events alone at the limit when there are no tasks", () => {
    const events = ["e1", "e2", "e3", "e4", "e5"];
    expect(monthCellRows(events, [], 3)).toEqual({
      events: ["e1", "e2", "e3"],
      tasks: [],
      overflow: 2,
    });
  });

  // 1 + 1, limit 3: everything fits, so overflow is exactly zero — not
  // omitted, not negative.
  it("reports zero overflow when the total is under the cap", () => {
    expect(monthCellRows(["e1"], ["t1"], 3)).toEqual({
      events: ["e1"],
      tasks: ["t1"],
      overflow: 0,
    });
  });
});

describe("attendeeInitialsLabel", () => {
  it("returns an empty string for no attendees", () => {
    expect(attendeeInitialsLabel([])).toBe("");
  });

  it("joins initials under the cap with no trailing count", () => {
    expect(attendeeInitialsLabel([{ initials: "AS" }, { initials: "PK" }])).toBe("AS, PK");
  });

  it("caps at three and folds the rest into a trailing +N, preserving order", () => {
    expect(
      attendeeInitialsLabel([
        { initials: "AS" },
        { initials: "PK" },
        { initials: "RM" },
        { initials: "TN" },
        { initials: "VJ" },
      ])
    ).toBe("AS, PK, RM +2");
  });
});

describe("timelineWindow", () => {
  it("returns the default 08:00-19:00 window for an empty list", () => {
    expect(timelineWindow([])).toEqual({ startHour: 8, endHour: 19 });
  });

  it("does not narrow for a day entirely inside the default window", () => {
    // 04:30Z + 05:30 = 10:00 IST, 05:30Z + 05:30 = 11:00 IST — well inside 8-19.
    const events = [
      eventRow({
        id: "a",
        startsAt: new Date("2026-08-04T04:30:00.000Z"),
        endsAt: new Date("2026-08-04T05:30:00.000Z"),
      }),
    ];
    expect(timelineWindow(events)).toEqual({ startHour: 8, endHour: 19 });
  });

  it("widens down, floored to the hour, for an early start", () => {
    // 01:00Z + 05:30 = 06:30 IST — floors to 06:00, not the half-hour it
    // actually starts on: the timeline draws whole hour rows.
    const events = [
      eventRow({
        id: "a",
        startsAt: new Date("2026-08-03T01:00:00.000Z"),
        endsAt: new Date("2026-08-03T01:30:00.000Z"),
      }),
    ];
    expect(timelineWindow(events)).toEqual({ startHour: 6, endHour: 19 });
  });

  it("widens up, ceiled to the hour, for a late end", () => {
    // 14:15Z + 05:30 = 19:45 IST, 14:45Z + 05:30 = 20:15 IST — ceils to
    // 21:00, not down to the hour it merely touches.
    const events = [
      eventRow({
        id: "a",
        startsAt: new Date("2026-08-09T14:15:00.000Z"),
        endsAt: new Date("2026-08-09T14:45:00.000Z"),
      }),
    ];
    expect(timelineWindow(events)).toEqual({ startHour: 8, endHour: 21 });
  });

  it("returns one window for a seven-day array whose extremes fall on different days", () => {
    // Monday's event supplies the early extreme (06:30 IST), Sunday's the
    // late one (20:15 IST); the five days between sit well inside 8-19 and
    // exist only to prove the aggregation is not confused by which day each
    // row falls on.
    const events = [
      eventRow({
        id: "mon",
        startsAt: new Date("2026-08-03T01:00:00.000Z"), // 06:30 IST
        endsAt: new Date("2026-08-03T01:30:00.000Z"), // 07:00 IST
      }),
      eventRow({
        id: "tue",
        startsAt: new Date("2026-08-04T04:30:00.000Z"), // 10:00 IST
        endsAt: new Date("2026-08-04T05:30:00.000Z"), // 11:00 IST
      }),
      eventRow({
        id: "wed",
        startsAt: new Date("2026-08-05T04:30:00.000Z"),
        endsAt: new Date("2026-08-05T05:30:00.000Z"),
      }),
      eventRow({
        id: "thu",
        startsAt: new Date("2026-08-06T04:30:00.000Z"),
        endsAt: new Date("2026-08-06T05:30:00.000Z"),
      }),
      eventRow({
        id: "fri",
        startsAt: new Date("2026-08-07T04:30:00.000Z"),
        endsAt: new Date("2026-08-07T05:30:00.000Z"),
      }),
      eventRow({
        id: "sat",
        startsAt: new Date("2026-08-08T04:30:00.000Z"),
        endsAt: new Date("2026-08-08T05:30:00.000Z"),
      }),
      eventRow({
        id: "sun",
        startsAt: new Date("2026-08-09T14:15:00.000Z"), // 19:45 IST
        endsAt: new Date("2026-08-09T14:45:00.000Z"), // 20:15 IST
      }),
    ];
    expect(timelineWindow(events)).toEqual({ startHour: 6, endHour: 21 });
  });

  it("returns 8-19 for one all-day row plus one 09:00-10:00 row — a leave day never opens the timeline to midnight", () => {
    // §7's pinned case: an all-day event's stored bounds are app-midnight to
    // app-midnight (D5), the widest span expressible. If timelineWindow read
    // it like any other row, this single "Priya on leave" would drag the
    // window to 00:00-24:00 for a row the timeline does not even draw.
    const allDay = eventRow({
      id: "leave",
      startsAt: new Date("2026-08-03T18:30:00.000Z"), // app-midnight, 4 Aug IST
      endsAt: new Date("2026-08-04T18:30:00.000Z"),
      allDay: true,
    });
    const call = eventRow({
      id: "call",
      startsAt: new Date("2026-08-04T03:30:00.000Z"), // 09:00 IST
      endsAt: new Date("2026-08-04T04:30:00.000Z"), // 10:00 IST
    });
    expect(timelineWindow([allDay, call])).toEqual({ startHour: 8, endHour: 19 });
  });
});

describe("eventPosition", () => {
  const window = { startHour: 8, endHour: 19 };

  it("places a 09:00-10:00 event at 1/11th of an 08:00-19:00 window", () => {
    const event = eventRow({
      id: "a",
      startsAt: new Date("2026-08-04T03:30:00.000Z"), // 09:00 IST
      endsAt: new Date("2026-08-04T04:30:00.000Z"), // 10:00 IST
    });
    const { topPct, heightPct } = eventPosition(event, window);
    expect(topPct).toBeCloseTo(100 / 11, 10);
    expect(heightPct).toBeCloseTo(100 / 11, 10);
  });

  it("returns 0 for an event starting exactly at the window start", () => {
    const event = eventRow({
      id: "a",
      startsAt: new Date("2026-08-04T02:30:00.000Z"), // 08:00 IST
      endsAt: new Date("2026-08-04T03:00:00.000Z"), // 08:30 IST
    });
    expect(eventPosition(event, window).topPct).toBe(0);
  });

  it("fills the whole window for an event spanning it exactly, with no minimum baked in", () => {
    const event = eventRow({
      id: "a",
      startsAt: new Date("2026-08-04T02:30:00.000Z"), // 08:00 IST
      endsAt: new Date("2026-08-04T13:30:00.000Z"), // 19:00 IST
    });
    expect(eventPosition(event, window)).toEqual({ topPct: 0, heightPct: 100 });
  });

  it("computes exact percentages for an event in the middle half of the window", () => {
    const event = eventRow({
      id: "a",
      startsAt: new Date("2026-08-04T05:15:00.000Z"), // 10:45 IST
      endsAt: new Date("2026-08-04T10:45:00.000Z"), // 16:15 IST
    });
    expect(eventPosition(event, window)).toEqual({ topPct: 25, heightPct: 50 });
  });

  it("gives a 15-minute event its true fractional height, with no minimum clamp", () => {
    // A fixture that only ever lands on a "round" percentage (1/11th, 50%,
    // 100%) can't tell a correct implementation from one that floors
    // heightPct at some small constant — every value above would sail past
    // a plausible clamp undetected. 15 minutes in an 08:00-19:00 (660-minute)
    // window is 15/660*100 = 2.2727...%, small enough that a clamp anywhere
    // in the 2-5% range would visibly change it — the exact risk the brief
    // and spec §7 name: "a 15-minute call yields its true tiny percentage".
    const event = eventRow({
      id: "a",
      startsAt: new Date("2026-08-04T03:30:00.000Z"), // 09:00 IST
      endsAt: new Date("2026-08-04T03:45:00.000Z"), // 09:15 IST
    });
    expect(eventPosition(event, window).heightPct).toBeCloseTo((15 / 660) * 100, 10);
  });
});

describe("validateEventTimes", () => {
  it("returns null outright for an all-day event, even with both times null", () => {
    expect(validateEventTimes(null, null, true)).toBeNull();
  });

  it("returns null outright for an all-day event, even with an end before the start", () => {
    // allDay short-circuits before any ordering check runs — an all-day
    // event's bounds are a storage artefact (app-midnight to app-midnight),
    // never a value a user set, so there is nothing here to validate.
    expect(validateEventTimes(600, 500, true)).toBeNull();
  });

  it("rejects a null start", () => {
    expect(validateEventTimes(null, 600, false)).toBe("An event needs a start time");
  });

  it("rejects a null end", () => {
    expect(validateEventTimes(540, null, false)).toBe("An event needs an end time");
  });

  it("rejects an end equal to the start", () => {
    expect(validateEventTimes(600, 600, false)).toBe("The end time can't be the same as the start time");
  });

  it("rejects an end before the start", () => {
    expect(validateEventTimes(600, 540, false)).toBe("The end time must be after the start time");
  });

  it("accepts any pair in order", () => {
    expect(validateEventTimes(540, 600, false)).toBeNull();
    expect(validateEventTimes(0, 1439, false)).toBeNull();
  });

  // The point of "each with its own string" (spec §12:438): a user is told
  // which thing is wrong, not handed one generic message four different
  // ways. Four distinct rejections in, four distinct strings out.
  it("gives each of the four rejections its own distinct string", () => {
    const messages = [
      validateEventTimes(null, 600, false),
      validateEventTimes(540, null, false),
      validateEventTimes(600, 600, false),
      validateEventTimes(600, 540, false),
    ];
    expect(new Set(messages).size).toBe(4);
  });
});

describe("calendarEventSchema", () => {
  const validEvent = {
    title: "Kickoff call",
    description: "",
    projectId: "",
    clientId: "",
  };

  it("rejects a blank title", () => {
    const parsed = calendarEventSchema.safeParse({ ...validEvent, title: "   " });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toBe("Give the event a title");
  });

  it("trims the title", () => {
    const parsed = calendarEventSchema.safeParse({ ...validEvent, title: "  Kickoff call  " });
    expect(parsed.data?.title).toBe("Kickoff call");
  });

  it("rejects a title over 200 characters", () => {
    const parsed = calendarEventSchema.safeParse({ ...validEvent, title: "a".repeat(201) });
    expect(parsed.success).toBe(false);
  });

  it("accepts an empty description, project and client", () => {
    const parsed = calendarEventSchema.safeParse(validEvent);
    expect(parsed.success).toBe(true);
  });

  // Same distinction taskSchema pins for its own optional fields: omitted
  // is a field the form never rendered, "" is a sentinel the picker
  // submitted on purpose, and null is neither — a tampered submission.
  it("rejects a null description, project or client — omitted is not empty", () => {
    for (const field of ["description", "projectId", "clientId"] as const) {
      const parsed = calendarEventSchema.safeParse({ ...validEvent, [field]: null });
      expect(parsed.success, `${field}: null should not parse`).toBe(false);
    }
  });
});

describe("assignLanes", () => {
  it("gives one lane to two non-overlapping events", () => {
    const a = eventRow({
      id: "a",
      startsAt: new Date("2026-08-04T03:30:00.000Z"), // 09:00-10:00 IST
      endsAt: new Date("2026-08-04T04:30:00.000Z"),
    });
    const b = eventRow({
      id: "b",
      startsAt: new Date("2026-08-04T05:30:00.000Z"), // 11:00-12:00 IST
      endsAt: new Date("2026-08-04T06:30:00.000Z"),
    });
    const lanes = assignLanes([a, b]);
    expect(lanes.find((l) => l.id === "a")).toEqual({ id: "a", lane: 0, laneCount: 1 });
    expect(lanes.find((l) => l.id === "b")).toEqual({ id: "b", lane: 0, laneCount: 1 });
  });

  it("gives two half-width lanes to an overlapping pair", () => {
    const a = eventRow({
      id: "a",
      startsAt: new Date("2026-08-04T03:30:00.000Z"), // 09:00-10:00 IST
      endsAt: new Date("2026-08-04T04:30:00.000Z"),
    });
    const b = eventRow({
      id: "b",
      startsAt: new Date("2026-08-04T03:30:00.000Z"), // 09:00-10:00 IST
      endsAt: new Date("2026-08-04T04:30:00.000Z"),
    });
    const lanes = assignLanes([a, b]);
    expect(lanes.find((l) => l.id === "a")).toEqual({ id: "a", lane: 0, laneCount: 2 });
    expect(lanes.find((l) => l.id === "b")).toEqual({ id: "b", lane: 1, laneCount: 2 });
  });

  it("gives three lanes to three mutually overlapping events", () => {
    const a = eventRow({
      id: "a",
      startsAt: new Date("2026-08-04T03:30:00.000Z"), // 09:00-11:00 IST
      endsAt: new Date("2026-08-04T05:30:00.000Z"),
    });
    const b = eventRow({
      id: "b",
      startsAt: new Date("2026-08-04T03:45:00.000Z"), // 09:15-10:45 IST
      endsAt: new Date("2026-08-04T05:15:00.000Z"),
    });
    const c = eventRow({
      id: "c",
      startsAt: new Date("2026-08-04T04:00:00.000Z"), // 09:30-10:15 IST
      endsAt: new Date("2026-08-04T04:45:00.000Z"),
    });
    const lanes = assignLanes([a, b, c]);
    expect(lanes.find((l) => l.id === "a")).toEqual({ id: "a", lane: 0, laneCount: 3 });
    expect(lanes.find((l) => l.id === "b")).toEqual({ id: "b", lane: 1, laneCount: 3 });
    expect(lanes.find((l) => l.id === "c")).toEqual({ id: "c", lane: 2, laneCount: 3 });
  });

  it("shares a lane when one event ends exactly as the next starts — touching is not overlapping", () => {
    const a = eventRow({
      id: "a",
      startsAt: new Date("2026-08-04T03:30:00.000Z"), // 09:00-10:00 IST
      endsAt: new Date("2026-08-04T04:30:00.000Z"),
    });
    const b = eventRow({
      id: "b",
      startsAt: new Date("2026-08-04T04:30:00.000Z"), // 10:00-11:00 IST
      endsAt: new Date("2026-08-04T05:30:00.000Z"),
    });
    const lanes = assignLanes([a, b]);
    expect(lanes.find((l) => l.id === "a")).toEqual({ id: "a", lane: 0, laneCount: 1 });
    expect(lanes.find((l) => l.id === "b")).toEqual({ id: "b", lane: 0, laneCount: 1 });
  });

  it("reports the cluster width, not a running total — a third event overlapping only the second does not shrink the first", () => {
    const a = eventRow({
      id: "a",
      startsAt: new Date("2026-08-04T03:30:00.000Z"), // 09:00-10:00 IST
      endsAt: new Date("2026-08-04T04:30:00.000Z"),
    });
    const b = eventRow({
      id: "b",
      startsAt: new Date("2026-08-04T04:00:00.000Z"), // 09:30-10:30 IST — overlaps a
      endsAt: new Date("2026-08-04T05:00:00.000Z"),
    });
    const c = eventRow({
      id: "c",
      startsAt: new Date("2026-08-04T04:45:00.000Z"), // 10:15-11:00 IST — overlaps b only
      endsAt: new Date("2026-08-04T05:30:00.000Z"),
    });
    const lanes = assignLanes([a, b, c]);
    expect(lanes.find((l) => l.id === "a")).toEqual({ id: "a", lane: 0, laneCount: 2 });
    expect(lanes.find((l) => l.id === "b")).toEqual({ id: "b", lane: 1, laneCount: 2 });
    expect(lanes.find((l) => l.id === "c")).toEqual({ id: "c", lane: 0, laneCount: 2 });
  });

  it("does not let an unrelated cluster elsewhere in the day inflate this one's laneCount", () => {
    // solo sits alone at 09:00-10:00; x/y/z form a three-way overlap at
    // 17:00. A global running total would carry the later cluster's width
    // back onto solo; the cluster width must not.
    const solo = eventRow({
      id: "solo",
      startsAt: new Date("2026-08-04T03:30:00.000Z"), // 09:00-10:00 IST
      endsAt: new Date("2026-08-04T04:30:00.000Z"),
    });
    const x = eventRow({
      id: "x",
      startsAt: new Date("2026-08-04T11:30:00.000Z"), // 17:00-19:00 IST
      endsAt: new Date("2026-08-04T13:30:00.000Z"),
    });
    const y = eventRow({
      id: "y",
      startsAt: new Date("2026-08-04T11:45:00.000Z"), // 17:15-18:45 IST
      endsAt: new Date("2026-08-04T13:15:00.000Z"),
    });
    const z = eventRow({
      id: "z",
      startsAt: new Date("2026-08-04T12:00:00.000Z"), // 17:30-18:15 IST
      endsAt: new Date("2026-08-04T12:45:00.000Z"),
    });
    const lanes = assignLanes([solo, x, y, z]);
    expect(lanes.find((l) => l.id === "solo")).toEqual({ id: "solo", lane: 0, laneCount: 1 });
    expect(lanes.find((l) => l.id === "x")?.laneCount).toBe(3);
  });
});
