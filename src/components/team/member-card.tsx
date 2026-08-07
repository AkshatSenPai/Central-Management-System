import Link from "next/link";
import { InitialsAvatar } from "@/components/ui/initials-avatar";
import { Badge } from "@/components/ui/badge";
import { cardClass } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { TASK_STATUS_BADGE, TASK_STATUS_LABEL } from "@/lib/task";
import type { TeamCard, TeamCardTask } from "@/lib/team-queries";

/** One task line. Extracted only so the two lists below cannot drift apart —
 * they render the same row, differing solely in whether a status badge is
 * shown. */
function TaskRow({ task, showStatus }: { task: TeamCardTask; showStatus?: boolean }) {
  return (
    <li>
      <Link
        href={`/tasks/${task.id}`}
        className="-mx-2 flex items-start justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-[var(--surface-2)]"
      >
        <span className="min-w-0">
          <span className="block truncate text-sm text-[var(--text)]">{task.title}</span>
          {task.clientName && task.projectName ? (
            <span className="block truncate text-xs text-[var(--text-3)]">
              {task.clientName} · {task.projectName}
            </span>
          ) : null}
        </span>
        {showStatus ? (
          <span className="shrink-0">
            <Badge kind={TASK_STATUS_BADGE[task.status]}>{TASK_STATUS_LABEL[task.status]}</Badge>
          </span>
        ) : null}
      </Link>
    </li>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-3)]">
      {children}
    </p>
  );
}

/** One member, one glance — the whole of D5. `listTeamCards` already seeded
 * every active member, folded the open-task count through `openTaskSummary`,
 * partitioned the open work and sorted both lists with `sortMyTasks`, so this
 * component renders the strings and rows it is given: no arithmetic, no
 * pluralisation, no sorting, and no null-check on either list (a member with
 * nothing in flight is just an empty list, never absent).
 *
 * The body used to render `inProgress` alone, which meant a member holding
 * five unstarted tasks and a member holding nothing at all produced the
 * identical card — "Nothing in progress." — and the small count badge beside
 * the name was not enough to overturn that impression. Now the empty state
 * appears only when there is genuinely nothing assigned, and unstarted work
 * gets its own labelled section rather than being invisible. */
export function MemberCard({ card }: { card: TeamCard }) {
  const hasNothingAssigned = card.inProgress.length === 0 && card.otherOpen.length === 0;

  return (
    <div className={cardClass({ className: "flex flex-col gap-4 p-4" })}>
      <div className="flex items-start justify-between gap-3">
        <Link
          href={`/team/${card.id}`}
          transitionTypes={["nav-forward"]}
          className="flex min-w-0 items-center gap-3"
        >
          <InitialsAvatar initials={card.initials} shape="circle" size={40} />
          <div className="min-w-0">
            <p
              style={{ viewTransitionName: `member-${card.id}` }}
              className="truncate text-sm font-medium text-[var(--text)] hover:underline"
            >
              {card.name}
            </p>
            {card.title ? <p className="truncate text-xs text-[var(--text-3)]">{card.title}</p> : null}
          </div>
        </Link>
        {/* Wraps, because two badges plus a name do not fit the 3-up grid on
            a narrow window or a phone. */}
        <div className="flex flex-none flex-wrap items-center justify-end gap-1.5">
          <Badge kind={card.presenceBadge} dot>
            {card.presenceLabel}
          </Badge>
          <Badge kind="neutral">{card.openTaskLabel}</Badge>
        </div>
      </div>

      {hasNothingAssigned ? (
        <EmptyState message="Nothing assigned." />
      ) : (
        <div className="flex flex-col gap-3">
          {card.inProgress.length > 0 ? (
            <div className="space-y-1">
              <SectionLabel>In progress</SectionLabel>
              <ul className="space-y-1">
                {card.inProgress.map((task) => (
                  <TaskRow key={task.id} task={task} />
                ))}
              </ul>
            </div>
          ) : null}

          {card.otherOpen.length > 0 ? (
            <div className="space-y-1">
              {/* Deliberately not "Not started" — this list also carries
                  REVIEW, and anything added to the status enum later. The
                  per-row badge says which, so the heading does not have to
                  guess and cannot become a lie. */}
              <SectionLabel>Open</SectionLabel>
              <ul className="space-y-1">
                {card.otherOpen.map((task) => (
                  <TaskRow key={task.id} task={task} showStatus />
                ))}
              </ul>
              {card.otherOpenExtra > 0 ? (
                <Link
                  href={`/team/${card.id}`}
                  className="-mx-2 block rounded-md px-2 py-1 text-xs font-semibold text-[var(--accent)] hover:bg-[var(--surface-2)]"
                >
                  +{card.otherOpenExtra} more
                </Link>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
