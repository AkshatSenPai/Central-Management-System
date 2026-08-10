import { describe, it, expect } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { listAttendanceDays } from "@/lib/attendance-queries";

/** IST is UTC+5:30, so an app day runs from 18:30Z the previous day. Every
 * fixture below is the UTC instant an office wall clock corresponds to. */
function fakeDays(rows: unknown[]) {
  const args: unknown[] = [];
  const db = {
    attendanceSession: {
      findMany: async (a: unknown) => {
        args.push(a);
        return rows;
      },
    },
  } as unknown as PrismaClient;
  return { db, args };
}

const row = (memberId: string, name: string, startedAt: string, endedAt: string | null) => ({
  memberId,
  member: { name },
  startedAt: new Date(startedAt),
  endedAt: endedAt ? new Date(endedAt) : null,
  resolution: endedAt ? "PUNCH_OUT" : "DISCARDED",
});

const WINDOW = {
  from: new Date("2026-08-01T00:00:00.000Z"),
  to: new Date("2026-08-31T00:00:00.000Z"),
};

describe("listAttendanceDays", () => {
  it("returns one entry per member per day, not per session", async () => {
    const { db } = fakeDays([
      row("u1", "Rohit", "2026-08-08T04:00:00.000Z", "2026-08-08T07:00:00.000Z"),
      row("u1", "Rohit", "2026-08-08T08:00:00.000Z", "2026-08-08T11:00:00.000Z"),
    ]);

    const days = await listAttendanceDays(db, WINDOW);

    expect(days).toHaveLength(1);
    expect(days[0].sessions).toBe(2);
    expect(days[0].ms).toBe(6 * 60 * 60 * 1000);
  });

  it("separates two members on the same day", async () => {
    const { db } = fakeDays([
      row("u1", "Rohit", "2026-08-08T04:00:00.000Z", "2026-08-08T07:00:00.000Z"),
      row("u2", "Bhavya", "2026-08-08T04:00:00.000Z", "2026-08-08T06:00:00.000Z"),
    ]);

    expect(await listAttendanceDays(db, WINDOW)).toHaveLength(2);
  });

  it("separates one member across two days", async () => {
    const { db } = fakeDays([
      row("u1", "Rohit", "2026-08-08T04:00:00.000Z", "2026-08-08T07:00:00.000Z"),
      row("u1", "Rohit", "2026-08-09T04:00:00.000Z", "2026-08-09T07:00:00.000Z"),
    ]);

    expect(await listAttendanceDays(db, WINDOW)).toHaveLength(2);
  });

  it("carries an unclosed session as a count with a null lastOut", async () => {
    const { db } = fakeDays([row("u1", "Rohit", "2026-08-08T04:00:00.000Z", null)]);

    const days = await listAttendanceDays(db, WINDOW);

    expect(days[0]).toMatchObject({ ms: 0, unclosed: 1, lastOut: null });
  });

  // The day's final session is the one that decides lastOut, including when
  // its null means somebody never punched out after a closed earlier session.
  it("takes lastOut from the final session, null included", async () => {
    const { db } = fakeDays([
      row("u1", "Rohit", "2026-08-08T04:00:00.000Z", "2026-08-08T07:00:00.000Z"),
      row("u1", "Rohit", "2026-08-08T08:00:00.000Z", null),
    ]);

    const days = await listAttendanceDays(db, WINDOW);

    expect(days[0].lastOut).toBeNull();
    expect(days[0].ms).toBe(3 * 60 * 60 * 1000);
    expect(days[0].unclosed).toBe(1);
  });

  // A 22:00 IST punch-in is 16:30Z, and belongs to that app day whatever time
  // it ends. Grouped by startOfAppDay, never a SQL date cast — a second
  // definition of "day" is one that can disagree with the first.
  it("keeps a late-evening session on its own app day", async () => {
    const { db } = fakeDays([
      row("u1", "Rohit", "2026-08-08T16:30:00.000Z", "2026-08-08T19:30:00.000Z"),
    ]);

    expect(await listAttendanceDays(db, WINDOW)).toHaveLength(1);
  });

  it("returns nothing for a window with no punches", async () => {
    const { db } = fakeDays([]);
    expect(await listAttendanceDays(db, WINDOW)).toEqual([]);
  });
});
