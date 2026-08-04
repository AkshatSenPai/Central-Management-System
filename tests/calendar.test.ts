import { describe, it, expect } from "vitest";
import {
  calendarRange,
  calendarTitle,
  groupByAppDay,
  isInAppMonth,
  isOverdueOnDay,
  isSameAppDay,
  monthGrid,
  parseCalendarView,
  startOfAppMonth,
  startOfAppWeek,
  stepAnchor,
} from "@/lib/calendar";
import { startOfAppDay } from "@/lib/dates";

const iso = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);

// Wednesday 29 July 2026.
const WED = new Date("2026-07-29T00:00:00.000Z");
// Sunday 2 August 2026 — the case a naive `day - 1` week start gets wrong.
const SUN = new Date("2026-08-02T00:00:00.000Z");

describe("parseCalendarView", () => {
  it("accepts the three views", () => {
    expect(parseCalendarView("month")).toBe("month");
    expect(parseCalendarView("week")).toBe("week");
    expect(parseCalendarView("day")).toBe("day");
  });

  // Null means "not specified", so the caller applies its own default — the
  // same contract as the other filter parsers.
  it("returns null for anything else, so the caller defaults", () => {
    expect(parseCalendarView(undefined)).toBeNull();
    expect(parseCalendarView("")).toBeNull();
    expect(parseCalendarView("year")).toBeNull();
    expect(parseCalendarView("../../etc/passwd")).toBeNull();
  });

  it("takes the first of a repeated param", () => {
    expect(parseCalendarView(["week", "day"])).toBe("week");
  });
});

describe("startOfAppWeek", () => {
  it("starts weeks on Monday", () => {
    expect(iso(startOfAppWeek(WED))).toBe("2026-07-27");
  });

  // getUTCDay() is 0 on Sunday, so `day - 1` would give -1 and pull the whole
  // grid back a week. Sunday must belong to the week that began six days ago.
  it("puts Sunday at the END of its week, not the start of the next", () => {
    expect(iso(startOfAppWeek(SUN))).toBe("2026-07-27");
  });

  it("is idempotent on a Monday", () => {
    const mon = new Date("2026-07-27T00:00:00.000Z");
    expect(iso(startOfAppWeek(mon))).toBe("2026-07-27");
  });

  it("ignores the time of day", () => {
    expect(iso(startOfAppWeek(new Date("2026-07-29T23:59:59.000Z")))).toBe("2026-07-27");
  });
});

describe("calendarRange", () => {
  it("covers exactly one day for the day view", () => {
    const { from, to } = calendarRange("day", WED);
    expect(iso(from)).toBe("2026-07-29");
    expect(iso(to)).toBe("2026-07-30");
  });

  it("covers Monday to the following Monday for the week view", () => {
    const { from, to } = calendarRange("week", WED);
    expect(iso(from)).toBe("2026-07-27");
    expect(iso(to)).toBe("2026-08-03");
  });

  // The query must cover the whole grid, not the calendar month — a task shown
  // in a trailing cell has to be a task the query actually fetched.
  it("covers the whole six-week grid for the month view", () => {
    const { from, to } = calendarRange("month", WED);
    expect(iso(from)).toBe("2026-06-29");
    expect(iso(to)).toBe("2026-08-10");
  });

  it("is half-open, so a boundary task lands in exactly one cell", () => {
    const a = calendarRange("day", WED);
    const b = calendarRange("day", new Date("2026-07-30T00:00:00.000Z"));
    expect(a.to.getTime()).toBe(b.from.getTime());
  });
});

describe("monthGrid", () => {
  const grid = monthGrid(WED);

  // A grid that changes height as you page through the year makes the whole
  // screen jump.
  it("is always six rows of seven", () => {
    expect(grid).toHaveLength(6);
    for (const week of grid) expect(week).toHaveLength(7);
  });

  it("starts on the Monday on or before the first of the month", () => {
    expect(iso(grid[0][0])).toBe("2026-06-29");
  });

  it("runs continuously with no gaps or repeats", () => {
    const flat = grid.flat();
    for (let i = 1; i < flat.length; i++) {
      expect(flat[i].getTime() - flat[i - 1].getTime()).toBe(24 * 60 * 60 * 1000);
    }
  });

  it("contains every day of the anchor month", () => {
    const days = new Set(grid.flat().map(iso));
    for (let d = 1; d <= 31; d++) {
      expect(days.has(`2026-07-${String(d).padStart(2, "0")}`)).toBe(true);
    }
  });

  it("matches the range the query fetches", () => {
    const { from, to } = calendarRange("month", WED);
    const flat = monthGrid(WED).flat();
    expect(flat[0].getTime()).toBe(from.getTime());
    expect(flat[flat.length - 1].getTime()).toBe(to.getTime() - 24 * 60 * 60 * 1000);
  });
});

describe("isInAppMonth", () => {
  it("distinguishes the anchor month from the grid's spill days", () => {
    expect(isInAppMonth(new Date("2026-07-01T00:00:00.000Z"), WED)).toBe(true);
    expect(isInAppMonth(new Date("2026-06-30T00:00:00.000Z"), WED)).toBe(false);
    expect(isInAppMonth(new Date("2026-08-01T00:00:00.000Z"), WED)).toBe(false);
  });

  it("does not confuse the same month in a different year", () => {
    expect(isInAppMonth(new Date("2025-07-15T00:00:00.000Z"), WED)).toBe(false);
  });
});

describe("isOverdueOnDay", () => {
  // isOverdue compares instants, so a task due at UTC midnight today is
  // "overdue" a millisecond later — which would paint today's whole column
  // red. A calendar asks whether the DAY has passed.
  it("does not call today overdue, at any time of day", () => {
    expect(isOverdueOnDay(WED, new Date("2026-07-29T00:00:00.001Z"))).toBe(false);
    expect(isOverdueOnDay(WED, new Date("2026-07-29T18:29:59.999Z"))).toBe(false);
  });

  it("calls yesterday overdue", () => {
    expect(isOverdueOnDay(new Date("2026-07-28T00:00:00.000Z"), WED)).toBe(true);
  });

  it("does not call tomorrow overdue", () => {
    expect(isOverdueOnDay(new Date("2026-07-30T00:00:00.000Z"), WED)).toBe(false);
  });

  it("treats an undated task as never overdue", () => {
    expect(isOverdueOnDay(null, WED)).toBe(false);
  });
});

describe("groupByAppDay", () => {
  const rows = [
    { id: "a", dueDate: new Date("2026-07-29T00:00:00.000Z") },
    { id: "b", dueDate: new Date("2026-07-29T00:00:00.000Z") },
    { id: "c", dueDate: new Date("2026-07-30T00:00:00.000Z") },
    { id: "d", dueDate: null },
  ];

  it("buckets by app day", () => {
    const map = groupByAppDay(rows, (r) => r.dueDate);
    expect(map.get(startOfAppDay(WED).getTime())?.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("drops undated rows — they have no cell to sit in", () => {
    const map = groupByAppDay(rows, (r) => r.dueDate);
    expect([...map.values()].flat().map((r) => r.id)).not.toContain("d");
  });

  // The dueDate column is a plain timestamp with no constraint forcing
  // midnight. Bucketing by string slice would be fine; bucketing by raw
  // getTime() would not. This proves we normalise.
  it("buckets a non-midnight timestamp into the right day", () => {
    const map = groupByAppDay([{ id: "x", dueDate: new Date("2026-07-29T16:45:00.000Z") }], (r) => r.dueDate);
    expect(map.get(startOfAppDay(WED).getTime())?.map((r) => r.id)).toEqual(["x"]);
  });

  it("returns an empty map for no rows", () => {
    expect(groupByAppDay([], (r: { dueDate: Date | null }) => r.dueDate).size).toBe(0);
  });
});

describe("stepAnchor", () => {
  it("steps a day", () => {
    expect(iso(stepAnchor("day", WED, 1))).toBe("2026-07-30");
    expect(iso(stepAnchor("day", WED, -1))).toBe("2026-07-28");
  });

  it("steps a week from the week's start", () => {
    expect(iso(stepAnchor("week", WED, 1))).toBe("2026-08-03");
  });

  // Stepping a month from the 31st must not skip February.
  it("steps months via the first, so no month is skipped", () => {
    const jan31 = new Date("2026-01-31T00:00:00.000Z");
    expect(iso(stepAnchor("month", jan31, 1))).toBe("2026-02-01");
    expect(iso(stepAnchor("month", new Date("2026-03-31T00:00:00.000Z"), -1))).toBe("2026-02-01");
  });

  it("crosses a year boundary", () => {
    expect(iso(stepAnchor("month", new Date("2026-12-15T00:00:00.000Z"), 1))).toBe("2027-01-01");
  });
});

describe("isSameAppDay", () => {
  it("ignores the time", () => {
    expect(isSameAppDay(WED, new Date("2026-07-29T18:29:59.999Z"))).toBe(true);
    expect(isSameAppDay(WED, new Date("2026-07-30T00:00:00.000Z"))).toBe(false);
  });
});

describe("calendarTitle", () => {
  it("names the month", () => {
    expect(calendarTitle("month", WED)).toBe("July 2026");
  });

  it("names the day in full", () => {
    expect(calendarTitle("day", WED)).toBe("Wednesday, 29 July 2026");
  });

  // Mon 6 – Sun 12 July: both ends in the same month, so the month is named
  // once rather than twice.
  it("names the month once for a week inside a single month", () => {
    expect(calendarTitle("week", new Date("2026-07-08T00:00:00.000Z"))).toBe("6 – 12 Jul 2026");
  });

  // The week containing WED runs 27 Jul – 2 Aug, so both months are named.
  it("names both months when a week straddles them", () => {
    expect(calendarTitle("week", WED)).toBe("27 Jul – 2 Aug 2026");
    expect(calendarTitle("week", new Date("2026-09-30T00:00:00.000Z"))).toBe("28 Sept – 4 Oct 2026");
  });

  it("names both months when a week straddles them", () => {
    expect(calendarTitle("week", new Date("2026-10-28T00:00:00.000Z"))).toBe(
      "26 Oct – 1 Nov 2026"
    );
  });

  it("names one month when the week does not straddle", () => {
    expect(calendarTitle("week", new Date("2026-06-03T00:00:00.000Z"))).toBe(
      "1 – 7 Jun 2026"
    );
  });
});

describe("startOfAppMonth", () => {
  it("returns the first, at midnight", () => {
    expect(startOfAppMonth(WED).toISOString()).toBe("2026-06-30T18:30:00.000Z");
  });
});
