import { describe, it, expect } from "vitest";
import { appTimeLabel } from "@/lib/dates";
import {
  attendeeInitialsLabel,
  calendarPeriodSummary,
  eventTimeLabel,
  monthCellRows,
  splitDayEvents,
} from "@/lib/calendar-event";

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
