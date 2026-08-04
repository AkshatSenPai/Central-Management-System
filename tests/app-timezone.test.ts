import { describe, expect, it } from "vitest";
import {
  APP_TIMEZONE,
  appDayOfMonth,
  appMonth,
  appWeekday,
  appYear,
  parseDateInput,
  startOfAppDay,
  toDateInputValue,
} from "@/lib/dates";

/** Deliberately NOT imported from dates.ts. This is the oracle: if the
 * fixed-offset arithmetic and the IANA zone ever disagree, these fail. */
const istDate = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);

describe("APP_TIMEZONE", () => {
  it("is Asia/Kolkata", () => {
    expect(APP_TIMEZONE).toBe("Asia/Kolkata");
  });

  it("has exactly one offset across three years — no DST, ever", () => {
    // D2 rests on this. If India ever adopts DST the fixed-offset arithmetic
    // silently breaks, and this is the test that says so.
    const offsets = new Set<string>();
    for (let i = 0; i < 1100; i++) {
      const d = new Date(Date.UTC(2025, 0, 1) + i * 86400000);
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Kolkata",
        timeZoneName: "longOffset",
      }).formatToParts(d);
      offsets.add(parts.find((p) => p.type === "timeZoneName")!.value);
    }
    expect([...offsets]).toEqual(["GMT+05:30"]);
  });
});

describe("startOfAppDay", () => {
  it("returns the app-midnight instant, which is 18:30Z the previous day", () => {
    expect(startOfAppDay(new Date("2026-07-29T10:00:00.000Z")).toISOString()).toBe(
      "2026-07-28T18:30:00.000Z"
    );
  });

  it("treats 18:30Z as the first instant of the next app day", () => {
    expect(startOfAppDay(new Date("2026-07-29T18:30:00.000Z")).toISOString()).toBe(
      "2026-07-29T18:30:00.000Z"
    );
    expect(startOfAppDay(new Date("2026-07-29T18:29:59.999Z")).toISOString()).toBe(
      "2026-07-28T18:30:00.000Z"
    );
  });

  it("agrees with Intl for 800 consecutive UTC-midnight instants", () => {
    // The proof that no stored row moves: every dueDate, startDate,
    // clientSince and pinnedUntil is a UTC-midnight instant, and each must
    // still name the same calendar day it names today.
    for (let i = 0; i < 800; i++) {
      const utcMidnight = new Date(Date.UTC(2025, 0, 1) + i * 86400000);
      expect(istDate(startOfAppDay(utcMidnight))).toBe(istDate(utcMidnight));
    }
  });

  it("keeps every parseDateInput value naming its own day", () => {
    for (const s of ["2026-01-01", "2026-02-28", "2026-03-01", "2026-12-31"]) {
      expect(istDate(startOfAppDay(parseDateInput(s)!))).toBe(s);
    }
  });
});

describe("app field accessors", () => {
  it("read app-local fields off an app-midnight instant", () => {
    // 2026-07-28T18:30:00Z IS app-midnight on Wednesday 29 July.
    const appMidnight = startOfAppDay(new Date("2026-07-29T10:00:00.000Z"));
    expect(appYear(appMidnight)).toBe(2026);
    expect(appMonth(appMidnight)).toBe(6); // zero-based, July
    expect(appDayOfMonth(appMidnight)).toBe(29);
    expect(appWeekday(appMidnight)).toBe(3); // Wednesday
  });

  it("disagrees with the getUTC* equivalents, which is the whole point", () => {
    const appMidnight = startOfAppDay(new Date("2026-07-29T10:00:00.000Z"));
    expect(appDayOfMonth(appMidnight)).not.toBe(appMidnight.getUTCDate());
  });
});

describe("toDateInputValue", () => {
  it("formats an app-midnight instant as its own app day", () => {
    // D4: a UTC slice would return the previous day here.
    expect(toDateInputValue(startOfAppDay(new Date("2026-07-29T10:00:00.000Z")))).toBe(
      "2026-07-29"
    );
  });

  it("round-trips with parseDateInput", () => {
    expect(toDateInputValue(parseDateInput("2026-08-04")!)).toBe("2026-08-04");
  });

  it("returns an empty string for null", () => {
    expect(toDateInputValue(null)).toBe("");
  });
});
