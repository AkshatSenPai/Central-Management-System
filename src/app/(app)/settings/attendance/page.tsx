import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { listAttendanceDays } from "@/lib/attendance-queries";
import { formatDuration } from "@/lib/attendance";
import {
  addDays,
  appTimeLabel,
  parseDateInput,
  shortDate,
  startOfAppDay,
  toDateInputValue,
} from "@/lib/dates";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";

/** Matches the activity export's window rule. */
const MAX_RANGE_DAYS = 366;
const DEFAULT_RANGE_DAYS = 13;

/** What the Total cell says.
 *
 * **Never "0h".** A day whose only session was left open is not a day of zero
 * work, it is a day with no punch-out — which is the whole reason
 * `sessionDuration` returns null rather than zero. */
function totalLabel(ms: number, unclosed: number): string {
  if (ms === 0 && unclosed > 0) return "no punch-out";
  const base = formatDuration(ms);
  return unclosed > 0 ? `${base} · ${unclosed} unclosed` : base;
}

export default async function AttendancePage(props: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  // Guards itself. A nav that omits a link is presentation, not access
  // control — the same rule /all-tasks follows.
  if (session.user.role !== "ADMIN") notFound();

  const raw = await props.searchParams;
  const today = startOfAppDay(new Date());
  // Exclusive upper bound, so "to = today" includes all of today.
  const to = parseDateInput(raw.to ?? "") ?? addDays(today, 1);
  const requestedFrom = parseDateInput(raw.from ?? "") ?? addDays(today, -DEFAULT_RANGE_DAYS);
  // Clamped rather than rejected: a silly range still renders, which is
  // friendlier than an error page and matches the activity export.
  const earliest = addDays(to, -MAX_RANGE_DAYS);
  const from = requestedFrom < earliest ? earliest : requestedFrom;

  const days = await listAttendanceDays(prisma, { from, to });

  return (
    <div className="mx-auto max-w-[900px] space-y-6 p-4 sm:p-8">
      <PageHeader title="Attendance" subtitle="Punch times, by member and day." />

      <SectionCard title="Range">
        {/* `Field` rather than a bare element — gate 3 forbids those outside
            ui/, and Field is what carries the focus-visible ring gate 5 checks
            for. (Gate 3 is a text scan, so naming the tag in a comment fails it
            too.) A plain GET form: this only reads, so there is no action and
            no client state to hold. */}
        <form className="flex flex-wrap items-end gap-3">
          <Field label="From" type="date" name="from" defaultValue={toDateInputValue(from)} />
          <Field label="To" type="date" name="to" defaultValue={toDateInputValue(to)} />
          <Button type="submit" size="sm">
            Show
          </Button>
        </form>
      </SectionCard>

      {/* flush gives the table overflow-x-auto inside the card, so a narrow
          screen scrolls the table rather than the whole page. */}
      <SectionCard title="Days" meta={days.length || null} flush>
        {days.length === 0 ? (
          <p className="p-4 text-sm text-[var(--text-3)]">No punches in this range.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--text-3)]">
                <th className="px-4 py-2 font-medium">Member</th>
                <th className="px-4 py-2 font-medium">Day</th>
                <th className="px-4 py-2 font-medium">First in</th>
                <th className="px-4 py-2 font-medium">Last out</th>
                <th className="px-4 py-2 font-medium">Time present</th>
                <th className="px-4 py-2 font-medium">Sessions</th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr
                  key={`${d.memberId}:${d.day.getTime()}`}
                  className="border-b border-[var(--border)] last:border-b-0"
                >
                  <td className="whitespace-nowrap px-4 py-2 text-[var(--text)]">{d.memberName}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-[var(--text-2)]">
                    {shortDate(d.day)}
                  </td>
                  {/* Through appTimeLabel, never toLocaleTimeString on a raw
                      Date: every timestamp in this app renders in APP_TIMEZONE,
                      and a local format would show a different clock to anyone
                      whose machine is set elsewhere. */}
                  <td className="whitespace-nowrap px-4 py-2 text-[var(--text-2)]">
                    {appTimeLabel(d.firstIn)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-[var(--text-2)]">
                    {d.lastOut ? appTimeLabel(d.lastOut) : "—"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-[var(--text)]">
                    {totalLabel(d.ms, d.unclosed)}
                  </td>
                  <td className="px-4 py-2 text-[var(--text-2)]">{d.sessions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SectionCard>
    </div>
  );
}
