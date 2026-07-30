import { describe, it, expect } from "vitest";
import {
  parseDateInput,
  toDateInputValue,
  shortDate,
  monthYear,
  isOverdue,
  relativeTime,
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
