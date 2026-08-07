import Link from "next/link";
import { InitialsAvatar } from "@/components/ui/initials-avatar";
import { Badge } from "@/components/ui/badge";
import { cardClass } from "@/components/ui/card";
import { TaskRow } from "@/components/tasks/task-row";
import type { TaskListRow } from "@/lib/task-queries";

/** One member's block on /all-tasks: a **sticky** name bar over a card of
 * their rows.
 *
 * Deliberately not a <SectionCard>, which every other grouped surface uses.
 * That component sets `overflow-hidden` on the frame so full-bleed rows clip
 * to its rounded corners — and `overflow-hidden` on any ancestor silently
 * kills `position: sticky` in a descendant. The header therefore sits
 * *outside* the card rather than in its head slot, which is the whole reason
 * this file exists.
 *
 * Sticky is the point. The page was reported as reading "too continuous":
 * scroll into a member with eleven tasks and by the fourth row there is
 * nothing on screen saying whose they are. Pinning the bar means the answer
 * to "who am I looking at" is always visible, and the next member's bar
 * pushing the previous one off is itself the boundary marker.
 *
 * The negative margins cancel the page's padding so the bar spans the full
 * width and reads as a rule across the page rather than a floating pill —
 * which is why they must mirror the page's `p-4 sm:p-8` exactly, breakpoint
 * for breakpoint: a mismatch either side shows as a notch in the rule.
 * `bg-[var(--bg)]` must stay opaque — rows scroll *underneath* this, and a
 * transparent bar would show them through the text.
 *
 * The avatar leads rather than trailing, unlike the earlier version of this
 * page: the eye starts at the left edge, so that is where the identity
 * belongs. */
export function MemberTaskGroup({
  id,
  name,
  initials,
  tasks,
}: {
  /** Null for the synthetic Unassigned group, which has no profile to link. */
  id: string | null;
  name: string;
  initials: string;
  tasks: TaskListRow[];
}) {
  const count = `${tasks.length} ${tasks.length === 1 ? "task" : "tasks"}`;

  return (
    <section>
      <header className="sticky top-0 z-20 -mx-4 mb-3 flex items-center gap-2.5 border-b border-[var(--border)] bg-[var(--bg)] px-4 py-2.5 sm:-mx-8 sm:px-8">
        <InitialsAvatar initials={initials} shape="circle" size={26} />
        {id ? (
          <Link
            href={`/team/${id}`}
            transitionTypes={["nav-forward"]}
            className="truncate text-[13.5px] font-bold tracking-[-0.01em] text-[var(--text)] hover:underline"
          >
            {name}
          </Link>
        ) : (
          <span className="truncate text-[13.5px] font-bold tracking-[-0.01em] text-[var(--text)]">
            {name}
          </span>
        )}
        <Badge kind="neutral">{count}</Badge>
      </header>

      <div className={cardClass({ className: "overflow-hidden" })}>
        {tasks.map((row) => (
          <TaskRow key={row.id} row={row} />
        ))}
      </div>
    </section>
  );
}
