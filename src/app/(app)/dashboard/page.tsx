import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getDashboard } from "@/lib/dashboard-queries";
import { bucketMyTasks, todayLabel, weekStats } from "@/lib/dashboard";
import { computeProgress } from "@/lib/progress";
import { relativeTime } from "@/lib/dates";
import { Icon } from "@/components/ui/icon";
import { ActivityTimeline } from "@/components/activity/activity-timeline";
import { DashboardSection, OverdueSection } from "@/components/dashboard/dashboard-section";
import { DashboardTaskRow } from "@/components/dashboard/dashboard-task-row";
import { WeekStatsCard } from "@/components/dashboard/week-stats";
import { EmptyState } from "@/components/ui/empty-state";
import { ProgressBar } from "@/components/ui/progress-bar";

const SWATCH: Record<number, string> = {
  1: "bg-[var(--pj1)]",
  2: "bg-[var(--pj2)]",
  3: "bg-[var(--pj3)]",
  4: "bg-[var(--pj4)]",
  5: "bg-[var(--pj5)]",
  6: "bg-[var(--pj6)]",
};

/** The design's "6h 12m logged this week" is still absent — time tracking is
 * Phase 6 and has no data behind it. The pinned announcement banner and the
 * notification bell, both of which were absent for the same reason, are now
 * real.
 *
 * The rule has not changed: a dashboard that renders a zero for a feature
 * that does not exist is worse than one that never mentions it. */
export default async function DashboardPage() {
  const session = await auth();
  // The layout already redirects. Repeated here because this page reads
  // session.user.id directly, and TypeScript cannot see a guard that lives in
  // another file.
  if (!session?.user) redirect("/login");

  // One `now` for the whole render. Taking it separately in each helper would
  // let the page cross midnight mid-render and disagree with itself about
  // which tasks are overdue.
  const now = new Date();
  const { openTasks, inProgress, completedThisWeek, activity, pinned } = await getDashboard(
    prisma,
    session.user.id,
    now
  );
  const { overdue, today } = bucketMyTasks(openTasks, now);
  const stats = weekStats(openTasks, completedThisWeek, now);
  const firstName = (session.user.name ?? "").split(/\s+/)[0];

  return (
    <div className="mx-auto max-w-[1240px] px-6 pb-10 pt-5">
      {/* Above the greeting, because a pinned notice is the one thing on this
          screen that somebody deliberately put in front of everyone. */}
      {pinned ? (
        <Link
          href="/announcements"
          className="mb-5 flex items-start gap-3 rounded-[10px] border border-[var(--accent-line)] bg-[var(--accent-soft)] px-3.5 py-3 transition-colors hover:brightness-[0.98]"
        >
          <Icon name="campaign" size="sm" className="mt-0.5 flex-none text-[var(--accent)]" />
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-semibold text-[var(--text)]">{pinned.title}</span>
            <span className="block text-[12.5px] text-[var(--text-2)]">
              {pinned.authorName} posted this {relativeTime(pinned.at, now)}
            </span>
          </span>
          <span className="flex-none text-[12.5px] font-semibold text-[var(--accent)]">Read</span>
        </Link>
      ) : null}

      <h1 className="text-2xl font-semibold tracking-[-0.01em] text-[var(--text)]">
        {firstName ? `Good to see you, ${firstName}` : "Dashboard"}
      </h1>
      <p className="mt-1 text-sm text-[var(--text-3)]">{todayLabel(now)}</p>

      <div className="mt-5 flex flex-wrap items-start gap-5">
        <div className="flex min-w-0 flex-1 basis-[480px] flex-col gap-5">
          {/* Rendered only when there is something overdue. An empty
              "0 overdue" panel would give the loudest treatment on the screen
              to the best possible news. */}
          {overdue.length > 0 ? (
            <OverdueSection count={overdue.length}>
              {overdue.map((row) => (
                <DashboardTaskRow key={row.id} row={row} variant="overdue" />
              ))}
            </OverdueSection>
          ) : null}

          <DashboardSection
            title="Today"
            meta={todayLabel(now)}
            linkHref="/my-tasks"
            linkLabel="All tasks"
          >
            {today.length > 0 ? (
              today.map((row) => <DashboardTaskRow key={row.id} row={row} variant="today" />)
            ) : (
              <div className="px-3.5 py-4">
                <EmptyState
                  message={
                    openTasks.length > 0
                      ? "Nothing is due today."
                      : "No open tasks are assigned to you."
                  }
                />
              </div>
            )}
          </DashboardSection>

          <DashboardSection
            title="My in-progress work"
            meta={inProgress.length === 1 ? "1 active" : `${inProgress.length} active`}
          >
            {inProgress.length > 0 ? (
              inProgress.map((t) => (
                <Link
                  key={t.id}
                  href={`/tasks/${t.id}`}
                  transitionTypes={["nav-forward"]}
                  className="flex items-center gap-3 border-b border-[var(--border)] px-3.5 py-3 transition-colors last:border-b-0 hover:bg-[var(--surface-2)]"
                >
                  <span
                    aria-hidden="true"
                    className={`h-[30px] w-[3px] flex-none rounded-sm ${SWATCH[t.colorIndex]}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-medium text-[var(--text)]">
                      {t.title}
                    </p>
                    <p className="truncate text-[11.5px] text-[var(--text-3)]">
                      {t.projectName ?? "Personal"}
                      {t.checklistTotal > 0
                        ? ` · ${t.checklistDone}/${t.checklistTotal} subtasks`
                        : ""}
                    </p>
                  </div>
                  {/* The design puts "6h 12m logged" in this column. There is
                      no time tracking, so the slot carries the only progress
                      the app actually knows — the checklist — and stays empty
                      rather than lying when there is no checklist at all. */}
                  {t.checklistTotal > 0 ? (
                    <span className="w-24 flex-none">
                      <ProgressBar
                        view={computeProgress(
                          { progressMode: "AUTO", manualProgress: null },
                          { completed: t.checklistDone, total: t.checklistTotal }
                        )}
                        showLabel={false}
                      />
                    </span>
                  ) : (
                    <span className="w-24 flex-none" />
                  )}
                </Link>
              ))
            ) : (
              <div className="px-3.5 py-4">
                <EmptyState message="Nothing in progress. Move a task to In Progress and it will show up here." />
              </div>
            )}
          </DashboardSection>
        </div>

        <div className="flex min-w-0 max-w-[340px] flex-1 basis-[296px] flex-col gap-5">
          <WeekStatsCard stats={stats} />

          <section className="overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow)]">
            <h2 className="border-b border-[var(--border)] px-3.5 py-3 text-[13.5px] font-bold tracking-[-0.01em] text-[var(--text)]">
              Recent activity
            </h2>
            <div className="px-3.5 py-3">
              <ActivityTimeline entries={activity} />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
