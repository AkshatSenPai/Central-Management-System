import Link from "next/link";
import { InitialsAvatar } from "@/components/ui/initials-avatar";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import type { TeamCard } from "@/lib/team-queries";

const CARD = "flex flex-col gap-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4";

/** One member, one glance — the whole of D5. `listTeamCards` already seeded
 * every active member, folded the open-task count through `openTaskSummary`
 * and sorted `inProgress` with `sortMyTasks`, so this component renders the
 * strings and rows it is given: no arithmetic, no pluralisation, no
 * sorting, and no null-check on `inProgress` (a member with nothing in
 * flight is just an empty list, never absent). */
export function MemberCard({ card }: { card: TeamCard }) {
  return (
    <div className={CARD}>
      <div className="flex items-start justify-between gap-3">
        <Link href={`/team/${card.id}`} className="flex min-w-0 items-center gap-3">
          <InitialsAvatar initials={card.initials} shape="circle" size={40} />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-[var(--text)] hover:underline">
              {card.name}
            </p>
            {card.title ? <p className="truncate text-xs text-[var(--text-3)]">{card.title}</p> : null}
          </div>
        </Link>
        <Badge kind="neutral">{card.openTaskLabel}</Badge>
      </div>

      {card.inProgress.length === 0 ? (
        <EmptyState message="Nothing in progress." />
      ) : (
        <ul className="space-y-1">
          {card.inProgress.map((task) => (
            <li key={task.id}>
              <Link
                href={`/tasks/${task.id}`}
                className="-mx-2 block rounded-md px-2 py-1.5 hover:bg-[var(--surface-2)]"
              >
                <p className="truncate text-sm text-[var(--text)]">{task.title}</p>
                {task.clientName && task.projectName ? (
                  <p className="truncate text-xs text-[var(--text-3)]">
                    {task.clientName} · {task.projectName}
                  </p>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
