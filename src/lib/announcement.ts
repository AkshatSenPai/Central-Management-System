import { z } from "zod";
import { APP_TIMEZONE, startOfAppDay } from "@/lib/dates";

/** Pure announcement rules — no Prisma, no session, so they unit-test without
 * a database. */

export const announcementSchema = z.object({
  title: z.string().trim().min(1, "Give the announcement a title").max(140),
  body: z.string().trim().min(1, "Write something first").max(4000),
  /** "YYYY-MM-DD" or empty. Empty means not pinned. */
  pinnedUntil: z.string().trim().optional().or(z.literal("")),
});

export type AnnouncementInput = z.infer<typeof announcementSchema>;

/** Pinned means: a pin date exists and today has not passed it.
 *
 * Compared as whole UTC days, so an announcement pinned "until 5 August" stays
 * up for the whole of the 5th rather than dropping off at midnight — which is
 * what an instant comparison would do, and what people would read as the pin
 * failing a day early. Same day-granular reasoning as the calendar's
 * isOverdueOnDay.
 */
export function isPinned(pinnedUntil: Date | null, now: Date): boolean {
  if (!pinnedUntil) return false;
  return startOfAppDay(pinnedUntil).getTime() >= startOfAppDay(now).getTime();
}

/** Pinned first, then newest. Within the pinned group, the one pinned to
 * expire soonest sits top — it is the most urgent, and it is the one about to
 * disappear. */
export function sortAnnouncements<T extends { pinnedUntil: Date | null; createdAt: Date }>(
  rows: T[],
  now: Date
): T[] {
  return [...rows].sort((a, b) => {
    const aPinned = isPinned(a.pinnedUntil, now);
    const bPinned = isPinned(b.pinnedUntil, now);
    if (aPinned !== bPinned) return aPinned ? -1 : 1;
    if (aPinned && bPinned) {
      return (a.pinnedUntil?.getTime() ?? 0) - (b.pinnedUntil?.getTime() ?? 0);
    }
    return b.createdAt.getTime() - a.createdAt.getTime();
  });
}

/** "Pinned until 5 Aug", or null when it is not pinned. */
export function pinLabel(pinnedUntil: Date | null, now: Date): string | null {
  if (!isPinned(pinnedUntil, now) || !pinnedUntil) return null;
  const date = pinnedUntil.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: APP_TIMEZONE,
  });
  return `Pinned until ${date}`;
}

export function announcementSummary(total: number, pinned: number): string {
  if (total === 0) return "Nothing posted yet";
  const word = total === 1 ? "announcement" : "announcements";
  return pinned > 0 ? `${total} ${word} · ${pinned} pinned` : `${total} ${word}`;
}
