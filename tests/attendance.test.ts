import { describe, it, expect } from "vitest";
import {
  ATTENDANCE_RESOLUTIONS,
  ATTENDANCE_RESOLUTION_LABEL,
  PRESENCE_BADGE,
  isActive,
  isOpen,
  isSameAppDay,
  isStale,
  presenceOf,
  sessionDuration,
  dayTotal,
  formatDuration,
  type AttendanceResolution,
  type AttendanceSessionLike,
} from "@/lib/attendance";

/** IST is UTC+5:30, so an app day runs 18:30Z the previous day to 18:30Z.
 * Every fixture is the UTC instant an office wall clock corresponds to, and
 * the name says the local time it represents. */
const ist = (isoUtc: string) => new Date(isoUtc);

// Tuesday 4 Aug 2026, local times.
const TUE_09_00 = ist("2026-08-04T03:30:00.000Z");
const TUE_15_30 = ist("2026-08-04T10:00:00.000Z");
const TUE_23_50 = ist("2026-08-04T18:20:00.000Z");
// Wednesday 5 Aug 2026, local times.
const WED_00_00 = ist("2026-08-04T18:30:00.000Z");
const WED_00_20 = ist("2026-08-04T18:50:00.000Z");
const WED_10_00 = ist("2026-08-05T04:30:00.000Z");

function session(overrides: Partial<AttendanceSessionLike> = {}): AttendanceSessionLike {
  return { startedAt: TUE_09_00, resolution: null, ...overrides };
}

describe("attendance vocabulary", () => {
  // Two values, not three. CORRECTED was removed when the owner ruled that
  // attendance is presence and not hours, which made the retroactive
  // end-time flow pointless.
  it("labels every resolution, so no surface can render undefined", () => {
    expect(ATTENDANCE_RESOLUTIONS).toEqual(["PUNCH_OUT", "DISCARDED"]);
    for (const r of ATTENDANCE_RESOLUTIONS) expect(ATTENDANCE_RESOLUTION_LABEL[r]).toBeTruthy();
  });
});

describe("isOpen", () => {
  // The single most important line in this file. Keying openness off an
  // `endedAt` would leave a DISCARDED row — which keeps a null endedAt
  // forever by design — looking open, holding the one open slot the
  // database's partial unique index allows, and locking that member out of
  // punching in permanently.
  it("is keyed on resolution, so a session closed without an end time is closed", () => {
    expect(isOpen(session({ resolution: null }))).toBe(true);
    expect(isOpen(session({ resolution: "DISCARDED" }))).toBe(false);
  });

  it("treats every resolved session as closed, whatever the resolution", () => {
    for (const r of ATTENDANCE_RESOLUTIONS) {
      expect(isOpen(session({ resolution: r as AttendanceResolution }))).toBe(false);
    }
  });
});

describe("isActive and isStale", () => {
  it("is Active while open on the same app day", () => {
    expect(isActive(session({ startedAt: TUE_09_00 }), TUE_15_30)).toBe(true);
    expect(isStale(session({ startedAt: TUE_09_00 }), TUE_15_30)).toBe(false);
  });

  // The owner's core ruling: a forgotten punch-out stops claiming presence at
  // the day roll, and is never auto-closed by a read.
  it("stops showing a forgotten punch-in as present once the day rolls over", () => {
    const forgotten = session({ startedAt: TUE_23_50 });
    expect(isActive(forgotten, WED_00_20)).toBe(false);
    expect(isStale(forgotten, WED_00_20)).toBe(true);
    // Still open — only the next punch-in resolves it.
    expect(isOpen(forgotten)).toBe(true);
  });

  it("is neither Active nor stale once resolved", () => {
    const closed = session({ startedAt: TUE_09_00, resolution: "PUNCH_OUT" });
    expect(isActive(closed, TUE_15_30)).toBe(false);
    expect(isStale(closed, WED_10_00)).toBe(false);
  });

  it("splits open sessions into exactly Active or stale, never both", () => {
    for (const now of [TUE_15_30, WED_10_00]) {
      const s = session({ startedAt: TUE_09_00 });
      expect(isActive(s, now) !== isStale(s, now)).toBe(true);
    }
  });
});

describe("isSameAppDay", () => {
  it("puts 23:50 and 00:20 either side of the IST boundary", () => {
    expect(isSameAppDay(TUE_23_50, WED_00_20)).toBe(false);
  });

  it("treats exactly 00:00:00 IST as the new day", () => {
    expect(isSameAppDay(TUE_23_50, WED_00_00)).toBe(false);
    expect(isSameAppDay(WED_00_00, WED_10_00)).toBe(true);
  });
});

describe("presenceOf", () => {
  it("reports Active only for an open session from today", () => {
    expect(presenceOf(session({ startedAt: TUE_09_00 }), TUE_15_30).label).toBe("Active");
    expect(presenceOf(session({ startedAt: TUE_23_50 }), WED_10_00).label).toBe("Offline");
    expect(presenceOf(null, TUE_15_30).label).toBe("Offline");
  });

  it("hands the card a resolved badge kind so it does no arithmetic", () => {
    expect(presenceOf(session({ startedAt: TUE_09_00 }), TUE_15_30).badge).toBe(
      PRESENCE_BADGE.active
    );
    expect(presenceOf(null, TUE_15_30).badge).toBe(PRESENCE_BADGE.offline);
  });

  // Presence is the entire public surface: a binary, with no time attached.
  // If a duration ever reappears here, the owner's ruling has been reversed
  // and this test is the place to notice.
  it("exposes only a label and a badge — never a time or a total", () => {
    const result = presenceOf(session({ startedAt: TUE_09_00 }), TUE_15_30);
    expect(Object.keys(result).sort()).toEqual(["badge", "label"]);
  });
});

const at = (iso: string) => new Date(iso);

describe("sessionDuration", () => {
  it("measures a closed session", () => {
    expect(
      sessionDuration({
        startedAt: at("2026-08-08T09:00:00.000Z"),
        endedAt: at("2026-08-08T11:30:00.000Z"),
        resolution: "PUNCH_OUT",
      })
    ).toBe(2.5 * 60 * 60 * 1000);
  });

  // THE rule of this feature. A DISCARDED session keeps a null endedAt
  // forever, because the app never invents an end time. Returning 0 would
  // flow silently into a sum and under-report every forgotten punch-out.
  it("is null, never 0, for a session that never ended", () => {
    expect(
      sessionDuration({
        startedAt: at("2026-08-08T09:00:00.000Z"),
        endedAt: null,
        resolution: "DISCARDED",
      })
    ).toBeNull();
  });

  it("is null for a session still open", () => {
    expect(
      sessionDuration({
        startedAt: at("2026-08-08T09:00:00.000Z"),
        endedAt: null,
        resolution: null,
      })
    ).toBeNull();
  });
});

describe("dayTotal", () => {
  it("sums closed sessions", () => {
    expect(
      dayTotal([
        {
          startedAt: at("2026-08-08T09:00:00.000Z"),
          endedAt: at("2026-08-08T10:00:00.000Z"),
          resolution: "PUNCH_OUT",
        },
        {
          startedAt: at("2026-08-08T11:00:00.000Z"),
          endedAt: at("2026-08-08T12:30:00.000Z"),
          resolution: "PUNCH_OUT",
        },
      ])
    ).toEqual({ ms: 2.5 * 60 * 60 * 1000, unclosed: 0 });
  });

  it("counts an unclosed session separately rather than as zero", () => {
    expect(
      dayTotal([
        {
          startedAt: at("2026-08-08T09:00:00.000Z"),
          endedAt: at("2026-08-08T10:00:00.000Z"),
          resolution: "PUNCH_OUT",
        },
        { startedAt: at("2026-08-08T11:00:00.000Z"), endedAt: null, resolution: "DISCARDED" },
      ])
    ).toEqual({ ms: 60 * 60 * 1000, unclosed: 1 });
  });

  // The case that must never render as "0h": a day whose only session was
  // left open is not a day of zero work, it is a day with no punch-out.
  it("reports zero milliseconds and a count when nothing closed", () => {
    expect(
      dayTotal([{ startedAt: at("2026-08-08T09:00:00.000Z"), endedAt: null, resolution: "DISCARDED" }])
    ).toEqual({ ms: 0, unclosed: 1 });
  });

  it("is zero and empty for no sessions at all", () => {
    expect(dayTotal([])).toEqual({ ms: 0, unclosed: 0 });
  });
});

describe("formatDuration", () => {
  it("renders minutes under an hour", () => {
    expect(formatDuration(45 * 60 * 1000)).toBe("45m");
  });

  it("renders exact hours without minutes", () => {
    expect(formatDuration(3 * 60 * 60 * 1000)).toBe("3h");
  });

  it("renders hours and minutes", () => {
    expect(formatDuration(6 * 60 * 60 * 1000 + 10 * 60 * 1000)).toBe("6h 10m");
  });
});
