import { describe, it, expect } from "vitest";
import {
  announcementSchema,
  announcementSummary,
  isPinned,
  pinLabel,
  sortAnnouncements,
} from "@/lib/announcement";

const NOW = new Date("2026-08-02T14:30:00.000Z");
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("isPinned", () => {
  // A pin "until 5 August" must survive the whole of the 5th. An instant
  // comparison would drop it at midnight, which people read as the pin
  // failing a day early.
  it("keeps a pin up for the whole of its final day", () => {
    expect(isPinned(d("2026-08-02"), NOW)).toBe(true);
    expect(isPinned(d("2026-08-02"), new Date("2026-08-02T18:29:59.999Z"))).toBe(true);
  });

  it("has lapsed once the IST day has ended, even though the UTC day has not", () => {
    // Same discriminating window as the dashboard case: 20:00Z is the next
    // IST day, so a pin through 2026-08-02 is over.
    expect(isPinned(d("2026-08-02"), new Date("2026-08-02T20:00:00.000Z"))).toBe(false);
  });

  it("drops a pin the day after", () => {
    expect(isPinned(d("2026-08-01"), NOW)).toBe(false);
  });

  it("keeps a future pin", () => {
    expect(isPinned(d("2026-09-01"), NOW)).toBe(true);
  });

  it("treats a never-pinned announcement as unpinned", () => {
    expect(isPinned(null, NOW)).toBe(false);
  });
});

describe("sortAnnouncements", () => {
  const lapsed = { id: "lapsed", pinnedUntil: d("2026-07-01"), createdAt: d("2026-07-30") };
  const newest = { id: "newest", pinnedUntil: null, createdAt: d("2026-08-01") };
  const older = { id: "older", pinnedUntil: null, createdAt: d("2026-06-01") };
  const pinnedSoon = { id: "soon", pinnedUntil: d("2026-08-03"), createdAt: d("2026-05-01") };
  const pinnedLater = { id: "later", pinnedUntil: d("2026-09-01"), createdAt: d("2026-07-31") };

  it("puts live pins first, whatever their age", () => {
    const out = sortAnnouncements([newest, pinnedSoon], NOW);
    expect(out.map((a) => a.id)).toEqual(["soon", "newest"]);
  });

  // The one expiring soonest is the most urgent, and the one about to vanish.
  it("orders live pins by which expires first", () => {
    const out = sortAnnouncements([pinnedLater, pinnedSoon], NOW);
    expect(out.map((a) => a.id)).toEqual(["soon", "later"]);
  });

  it("orders the unpinned newest first", () => {
    const out = sortAnnouncements([older, newest], NOW);
    expect(out.map((a) => a.id)).toEqual(["newest", "older"]);
  });

  // A lapsed pin is just an old announcement; it must not keep priority.
  it("treats a lapsed pin as unpinned", () => {
    const out = sortAnnouncements([lapsed, newest], NOW);
    expect(out.map((a) => a.id)).toEqual(["newest", "lapsed"]);
  });

  it("does not mutate its input", () => {
    const input = [older, newest];
    const copy = [...input];
    sortAnnouncements(input, NOW);
    expect(input).toEqual(copy);
  });

  it("handles an empty list", () => {
    expect(sortAnnouncements([], NOW)).toEqual([]);
  });
});

describe("pinLabel", () => {
  it("names the date a live pin ends", () => {
    expect(pinLabel(d("2026-08-05"), NOW)).toBe("Pinned until 5 Aug");
  });

  it("is null when there is no live pin", () => {
    expect(pinLabel(null, NOW)).toBeNull();
    expect(pinLabel(d("2026-07-01"), NOW)).toBeNull();
  });
});

describe("announcementSchema", () => {
  it("requires a title and a body", () => {
    expect(announcementSchema.safeParse({ title: "", body: "x" }).success).toBe(false);
    expect(announcementSchema.safeParse({ title: "x", body: "  " }).success).toBe(false);
  });

  it("accepts an empty pin date — that means not pinned", () => {
    expect(
      announcementSchema.safeParse({ title: "t", body: "b", pinnedUntil: "" }).success
    ).toBe(true);
  });

  it("trims", () => {
    const parsed = announcementSchema.parse({ title: "  t  ", body: "  b  " });
    expect(parsed).toMatchObject({ title: "t", body: "b" });
  });
});

describe("announcementSummary", () => {
  it("counts, and mentions pins only when there are some", () => {
    expect(announcementSummary(0, 0)).toBe("Nothing posted yet");
    expect(announcementSummary(1, 0)).toBe("1 announcement");
    expect(announcementSummary(4, 0)).toBe("4 announcements");
    expect(announcementSummary(4, 2)).toBe("4 announcements · 2 pinned");
  });
});
