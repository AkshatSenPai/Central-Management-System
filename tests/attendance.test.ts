import { describe, it, expect } from "vitest";
import {
  ATTENDANCE_RESOLUTIONS,
  ATTENDANCE_RESOLUTION_LABEL,
  MAX_SESSION_MS,
  PRESENCE_BADGE,
  dayMs,
  formatDuration,
  isActive,
  isOpen,
  isSameAppDay,
  isUnresolved,
  overlapsExisting,
  presenceOf,
  sessionMs,
  validateCorrectedEnd,
  type AttendanceResolution,
  type AttendanceSessionLike,
} from "@/lib/attendance";

/** IST is UTC+5:30, so an app day runs 18:30Z the previous day to 18:30Z.
 * Every fixture below is written as the UTC instant a wall clock in the office
 * would correspond to, and the comment says the local time it represents. */
const ist = (isoUtc: string) => new Date(isoUtc);

// Tuesday 4 Aug 2026, local times.
const TUE_09_00 = ist("2026-08-04T03:30:00.000Z");
const TUE_13_00 = ist("2026-08-04T07:30:00.000Z");
const TUE_14_00 = ist("2026-08-04T08:30:00.000Z");
const TUE_15_30 = ist("2026-08-04T10:00:00.000Z");
const TUE_22_00 = ist("2026-08-04T16:30:00.000Z");
const TUE_23_50 = ist("2026-08-04T18:20:00.000Z");
// Wednesday 5 Aug 2026, local times.
const WED_00_00 = ist("2026-08-04T18:30:00.000Z");
const WED_00_20 = ist("2026-08-04T18:50:00.000Z");
const WED_06_00 = ist("2026-08-05T00:30:00.000Z");
const WED_10_00 = ist("2026-08-05T04:30:00.000Z");

function session(overrides: Partial<AttendanceSessionLike> = {}): AttendanceSessionLike {
  return { startedAt: TUE_09_00, endedAt: null, resolution: null, ...overrides };
}

describe("attendance vocabulary", () => {
  it("labels every resolution, so no surface can render undefined", () => {
    for (const r of ATTENDANCE_RESOLUTIONS) expect(ATTENDANCE_RESOLUTION_LABEL[r]).toBeTruthy();
  });
});

describe("isOpen", () => {
  // The single most important line in this file. Keying openness off
  // `endedAt === null` instead would leave a DISCARDED row — which keeps a
  // null endedAt forever by design — looking open, holding the one open slot
  // the database's partial unique index allows, and locking that member out
  // of punching in permanently.
  it("is keyed on resolution, not on endedAt", () => {
    expect(isOpen(session({ resolution: null, endedAt: null }))).toBe(true);

    const discarded = session({ resolution: "DISCARDED", endedAt: null });
    expect(discarded.endedAt).toBeNull();
    expect(isOpen(discarded)).toBe(false);
  });

  it("treats every resolved session as closed, whatever the resolution", () => {
    for (const r of ATTENDANCE_RESOLUTIONS) {
      expect(isOpen(session({ resolution: r as AttendanceResolution }))).toBe(false);
    }
  });
});

describe("isActive and isUnresolved", () => {
  it("is Active while open on the same app day", () => {
    expect(isActive(session({ startedAt: TUE_09_00 }), TUE_15_30)).toBe(true);
    expect(isUnresolved(session({ startedAt: TUE_09_00 }), TUE_15_30)).toBe(false);
  });

  // The owner's core ruling. If this ever fails, the app has started guessing.
  it("flips a forgotten punch-in to Offline at the day roll without closing it", () => {
    const forgotten = session({ startedAt: TUE_23_50 });
    expect(isActive(forgotten, WED_00_20)).toBe(false);
    expect(isUnresolved(forgotten, WED_00_20)).toBe(true);
    expect(forgotten.endedAt).toBeNull();
  });

  it("is neither Active nor unresolved once resolved", () => {
    const closed = session({ startedAt: TUE_09_00, endedAt: TUE_13_00, resolution: "PUNCH_OUT" });
    expect(isActive(closed, TUE_15_30)).toBe(false);
    expect(isUnresolved(closed, WED_10_00)).toBe(false);
  });

  it("splits open sessions into exactly Active or unresolved, never both", () => {
    for (const now of [TUE_15_30, WED_10_00]) {
      const s = session({ startedAt: TUE_09_00 });
      expect(isActive(s, now) !== isUnresolved(s, now)).toBe(true);
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

describe("sessionMs and dayMs", () => {
  it("sums many pairs across one day", () => {
    const rows = [
      session({ startedAt: TUE_09_00, endedAt: TUE_13_00, resolution: "PUNCH_OUT" }),
      session({ startedAt: TUE_14_00, endedAt: TUE_15_30, resolution: "PUNCH_OUT" }),
    ];
    expect(formatDuration(dayMs(rows, TUE_15_30))).toBe("5h 30m");
  });

  it("counts an open session as zero — there is no end yet to measure", () => {
    expect(sessionMs(session({ startedAt: TUE_09_00, endedAt: null }))).toBe(0);
  });

  it("counts a DISCARDED session as zero and does not crash on its null end", () => {
    const discarded = session({ startedAt: TUE_09_00, endedAt: null, resolution: "DISCARDED" });
    expect(sessionMs(discarded)).toBe(0);
    expect(dayMs([discarded], TUE_15_30)).toBe(0);
  });

  it("still refuses to count a DISCARDED session that somehow has an end", () => {
    const backfilled = session({ startedAt: TUE_09_00, endedAt: TUE_13_00, resolution: "DISCARDED" });
    expect(sessionMs(backfilled)).toBe(0);
  });

  it("counts a CORRECTED session exactly like a punch-out", () => {
    const corrected = session({ startedAt: TUE_09_00, endedAt: TUE_13_00, resolution: "CORRECTED" });
    expect(formatDuration(sessionMs(corrected))).toBe("4h 0m");
  });

  // Asserted explicitly so nobody later "fixes" this by splitting the session
  // at midnight — that would invent two events where one happened.
  it("attributes an overnight shift wholly to the day it started", () => {
    const nightShift = session({ startedAt: TUE_22_00, endedAt: WED_06_00, resolution: "PUNCH_OUT" });
    expect(formatDuration(dayMs([nightShift], TUE_22_00))).toBe("8h 0m");
    expect(dayMs([nightShift], WED_10_00)).toBe(0);
  });

  it("is zero for a day with nothing on it", () => {
    expect(dayMs([], TUE_09_00)).toBe(0);
  });
});

describe("formatDuration", () => {
  it("renders zero, sub-hour, exact-hour and mixed", () => {
    expect(formatDuration(0)).toBe("0m");
    expect(formatDuration(48 * 60000)).toBe("48m");
    expect(formatDuration(60 * 60000)).toBe("1h 0m");
    expect(formatDuration((6 * 60 + 12) * 60000)).toBe("6h 12m");
  });

  it("floors to whole minutes and never renders a negative", () => {
    expect(formatDuration(59_999)).toBe("0m");
    expect(formatDuration(-5000)).toBe("0m");
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
});

describe("validateCorrectedEnd", () => {
  it("accepts a legitimate same-day close", () => {
    expect(validateCorrectedEnd(TUE_09_00, TUE_13_00, TUE_15_30)).toBeNull();
  });

  // The night shift is real, so crossing the app-day boundary must be legal
  // even though such a session is no longer Active.
  it("accepts a close that crosses into the next app day", () => {
    expect(validateCorrectedEnd(TUE_22_00, WED_06_00, WED_10_00)).toBeNull();
  });

  it("refuses an unparseable date and time rather than clamping it", () => {
    expect(validateCorrectedEnd(TUE_09_00, null, TUE_15_30)).toBe("Enter a valid date and time.");
  });

  it("refuses an end at or before the start", () => {
    const message = "The end time must be after the start.";
    expect(validateCorrectedEnd(TUE_13_00, TUE_09_00, TUE_15_30)).toBe(message);
    expect(validateCorrectedEnd(TUE_09_00, TUE_09_00, TUE_15_30)).toBe(message);
  });

  it("refuses an end in the future", () => {
    expect(validateCorrectedEnd(TUE_09_00, WED_10_00, TUE_15_30)).toBe(
      "The end time cannot be in the future."
    );
  });

  it("refuses a session longer than 24 hours and points at Discard", () => {
    const tooLong = new Date(TUE_09_00.getTime() + MAX_SESSION_MS + 60000);
    expect(validateCorrectedEnd(TUE_09_00, tooLong, new Date(tooLong.getTime() + 1000))).toBe(
      "A session cannot run longer than 24 hours. Discard it instead."
    );
  });

  it("accepts exactly 24 hours", () => {
    const exactly = new Date(TUE_09_00.getTime() + MAX_SESSION_MS);
    expect(validateCorrectedEnd(TUE_09_00, exactly, new Date(exactly.getTime() + 1000))).toBeNull();
  });

  // Order matters: an end that is both in the future and over 24h should name
  // the future problem, because that is the one the person can see is wrong.
  it("reports the future before the length when both are true", () => {
    const far = new Date(TUE_09_00.getTime() + MAX_SESSION_MS + 60000);
    expect(validateCorrectedEnd(TUE_09_00, far, TUE_15_30)).toBe(
      "The end time cannot be in the future."
    );
  });
});

describe("overlapsExisting", () => {
  const morning = session({ startedAt: TUE_09_00, endedAt: TUE_13_00, resolution: "PUNCH_OUT" });

  it("allows a session that begins exactly when another ends", () => {
    expect(overlapsExisting({ startedAt: TUE_13_00, endedAt: TUE_15_30 }, [morning])).toBe(false);
  });

  it("refuses a genuine overlap", () => {
    const oneMinuteIn = new Date(TUE_13_00.getTime() - 60000);
    expect(overlapsExisting({ startedAt: oneMinuteIn, endedAt: TUE_15_30 }, [morning])).toBe(true);
  });

  it("refuses a candidate wholly inside an existing session", () => {
    const inside = { startedAt: new Date(TUE_09_00.getTime() + 60000), endedAt: TUE_13_00 };
    expect(overlapsExisting(inside, [morning])).toBe(true);
  });

  it("ignores an open neighbour — it has no end to overlap with", () => {
    const open = session({ startedAt: TUE_09_00, endedAt: null });
    expect(overlapsExisting({ startedAt: TUE_09_00, endedAt: TUE_13_00 }, [open])).toBe(false);
  });

  // A discarded session contributes nothing to any total, so it cannot cause
  // the double-count this check exists to prevent.
  it("ignores a DISCARDED neighbour", () => {
    const discarded = session({ startedAt: TUE_09_00, endedAt: TUE_13_00, resolution: "DISCARDED" });
    expect(overlapsExisting({ startedAt: TUE_09_00, endedAt: TUE_13_00 }, [discarded])).toBe(false);
  });

  it("is false against an empty list", () => {
    expect(overlapsExisting({ startedAt: TUE_09_00, endedAt: TUE_13_00 }, [])).toBe(false);
  });
});
