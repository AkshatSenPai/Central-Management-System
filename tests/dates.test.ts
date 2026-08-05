import { describe, it, expect } from "vitest";
import {
  parseDateInput,
  toDateInputValue,
  shortDate,
  monthYear,
  isOverdue,
  relativeTime,
  parseTimeInput,
  toTimeInputValue,
  appDateTime,
  appTimeLabel,
} from "@/lib/dates";

/** Every fixture sits at 12:00:00Z so formatting never straddles a day
 * boundary in any timezone the suite might run in. */
const NOON = "T12:00:00.000Z";

describe("parseDateInput", () => {
  it("returns null for an empty string", () => {
    expect(parseDateInput("")).toBeNull();
  });

  it("parses YYYY-MM-DD as UTC midnight", () => {
    expect(parseDateInput("2026-08-14")?.toISOString()).toBe("2026-08-14T00:00:00.000Z");
  });

  it("returns null for a malformed value", () => {
    expect(parseDateInput("14/08/2026")).toBeNull();
  });
});

describe("toDateInputValue", () => {
  it("formats a date as YYYY-MM-DD", () => {
    expect(toDateInputValue(new Date(`2026-08-14${NOON}`))).toBe("2026-08-14");
  });

  it("returns an empty string for null", () => {
    expect(toDateInputValue(null)).toBe("");
  });
});

describe("shortDate", () => {
  it('formats as "12 Jun"', () => {
    expect(shortDate(new Date(`2026-06-12${NOON}`))).toBe("12 Jun");
  });
});

describe("monthYear", () => {
  it('formats as "Mar 2024"', () => {
    expect(monthYear(new Date(`2024-03-01${NOON}`))).toBe("Mar 2024");
  });
});

describe("isOverdue", () => {
  const now = new Date(`2026-07-30${NOON}`);

  it("is false when there is no due date", () => {
    expect(isOverdue(null, now)).toBe(false);
  });

  it("is true for a past due date", () => {
    expect(isOverdue(new Date(`2026-07-01${NOON}`), now)).toBe(true);
  });

  it("is false for a future due date", () => {
    expect(isOverdue(new Date(`2026-08-14${NOON}`), now)).toBe(false);
  });
});

describe("parseTimeInput", () => {
  it("returns null for an empty string", () => {
    expect(parseTimeInput("")).toBeNull();
  });

  it("parses HH:MM as minutes since app-midnight", () => {
    expect(parseTimeInput("00:00")).toBe(0);
    expect(parseTimeInput("15:00")).toBe(900);
    expect(parseTimeInput("23:59")).toBe(1439);
  });

  // Same refusal to guess parseDateInput already applies: a value that
  // isn't exactly what <input type="time"> submits is absent, never
  // coerced into a plausible minute count.
  it("refuses to guess a single-digit hour", () => {
    expect(parseTimeInput("9")).toBeNull();
  });

  it("refuses to guess a single-digit minute", () => {
    expect(parseTimeInput("9:5")).toBeNull();
  });

  it("rejects an hour past 23", () => {
    expect(parseTimeInput("25:00")).toBeNull();
  });

  it("rejects a minute past 59", () => {
    expect(parseTimeInput("12:60")).toBeNull();
  });
});

describe("toTimeInputValue", () => {
  it('formats an instant as "HH:MM" in the app zone', () => {
    // Same fixture as appTimeLabel's own test: 09:30Z + 05:30 = 15:00 IST.
    expect(toTimeInputValue(new Date("2026-08-04T09:30:00.000Z"))).toBe("15:00");
  });

  it("pads to two digits", () => {
    // 00:00Z + 05:30 = 05:30 IST.
    expect(toTimeInputValue(new Date("2026-08-04T00:00:00.000Z"))).toBe("05:30");
  });
});

describe("appDateTime", () => {
  it("returns null when the date half fails to parse", () => {
    expect(appDateTime("14/08/2026", "15:00")).toBeNull();
  });

  it("returns null when the time half fails to parse", () => {
    expect(appDateTime("2026-08-05", "25:00")).toBeNull();
  });

  it("returns null when both halves fail to parse", () => {
    expect(appDateTime("", "")).toBeNull();
  });

  // The property that matters: appDateTime is the only place a wall-clock
  // time becomes a stored instant, so building one from "YYYY-MM-DD" +
  // "HH:MM" and reading it back through the app-zone accessors must return
  // exactly the date and time that went in. parseDateInput's result is UTC
  // midnight of the calendar day, not app midnight — adding minutes to it
  // directly would land 5:30 off for any time before 18:30 IST, which is
  // exactly the bug this round trip would catch.
  it("round-trips: appDateTime(date, time) reads back as the same date and time in the app zone", () => {
    const at = appDateTime("2026-08-05", "15:00");
    expect(at).not.toBeNull();
    expect(appTimeLabel(at as Date)).toBe("15:00");
    expect(toDateInputValue(at)).toBe("2026-08-05");
  });

  // The exact instant, not just the round trip: app-midnight for 5 Aug IST
  // is 2026-08-04T18:30:00.000Z (D2's offset), plus 15:00 (900 minutes) is
  // 2026-08-05T09:30:00.000Z. Pinning this catches an implementation that
  // happens to round-trip through appTimeLabel/toDateInputValue by luck —
  // e.g. one that never left the app-midnight boundary correctly — while
  // landing on the wrong absolute instant.
  it("lands on the exact instant app-midnight-plus-minutes predicts", () => {
    expect(appDateTime("2026-08-05", "15:00")?.toISOString()).toBe("2026-08-05T09:30:00.000Z");
  });

  it("round-trips at the app-midnight boundary itself", () => {
    const at = appDateTime("2026-08-05", "00:00");
    expect(appTimeLabel(at as Date)).toBe("00:00");
    expect(toDateInputValue(at)).toBe("2026-08-05");
  });

  it("round-trips at the last minute of the app day", () => {
    const at = appDateTime("2026-08-05", "23:59");
    expect(appTimeLabel(at as Date)).toBe("23:59");
    expect(toDateInputValue(at)).toBe("2026-08-05");
  });
});

describe("relativeTime", () => {
  const now = new Date(`2026-07-30${NOON}`);

  it('reads "just now" under a minute, "2h ago" at two hours and "3d ago" at three days', () => {
    expect(relativeTime(new Date(now.getTime() - 30_000), now)).toBe("just now");
    expect(relativeTime(new Date(now.getTime() - 5 * 60_000), now)).toBe("5m ago");
    expect(relativeTime(new Date(now.getTime() - 2 * 3_600_000), now)).toBe("2h ago");
    expect(relativeTime(new Date(now.getTime() - 3 * 86_400_000), now)).toBe("3d ago");
  });

  it("falls back to a short date past 30 days", () => {
    const at = new Date(`2026-06-12${NOON}`);
    expect(relativeTime(at, now)).toBe("12 Jun");
  });
});
