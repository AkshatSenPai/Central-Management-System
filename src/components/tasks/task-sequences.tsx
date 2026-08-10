import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { SectionCard } from "@/components/ui/section-card";
import { TaskRow } from "@/components/tasks/task-row";
import { taskReference } from "@/lib/task";
import type { Sequence, SequenceNodeState } from "@/lib/sequences";
import type { TaskListRow } from "@/lib/task-queries";

/** Deliberately not TASK_STATUS_BADGE: these are the derived states, not
 * TaskStatus, and a task can be In Progress while Waiting. Spec §12. */
const STATE_LABEL: Record<SequenceNodeState, string> = {
  done: "Done",
  ready: "Ready",
  waiting: "Waiting",
};

const STATE_BADGE: Record<SequenceNodeState, "ok" | "strong" | "warn"> = {
  done: "ok",
  ready: "strong",
  waiting: "warn",
};

/** Built as their own constants: Tailwind v4 scans source text, and a literal
 * class written flush against a `${` is silently dropped from the build. */
const DOT_BASE = "absolute left-0 top-[7px] h-[11px] w-[11px] rounded-full border-2 border-[var(--surface)]";
const DOT_DONE = "bg-[var(--ok)]";
const DOT_READY = "bg-[var(--text)]";
const DOT_WAITING = "bg-[var(--warn)]";

function dotClass(state: SequenceNodeState): string {
  if (state === "done") return `${DOT_BASE} ${DOT_DONE}`;
  if (state === "ready") return `${DOT_BASE} ${DOT_READY}`;
  return `${DOT_BASE} ${DOT_WAITING}`;
}

/** The rail: a vertical line with a dot per task. CSS only — no SVG and no
 * measuring, so it reflows at any width. Vertical rather than horizontal is
 * what makes 375px work without a sideways scroller. */
function SequenceRail({ sequence }: { sequence: Sequence }) {
  return (
    <ol className="relative space-y-3 before:absolute before:bottom-2 before:left-[5px] before:top-2 before:w-px before:bg-[var(--border)]">
      {sequence.nodes.map((node) => (
        <li key={node.task.id} className="relative flex items-start gap-3 pl-6">
          <span aria-hidden className={dotClass(node.state)} />

          <div className="min-w-0 flex-1">
            <Link
              href={`/tasks/${node.task.id}`}
              transitionTypes={["nav-forward"]}
              className="block min-w-0 truncate text-sm text-[var(--text)] hover:underline"
            >
              <span className="font-medium">{taskReference(node.task.reference)}</span>{" "}
              {node.task.title}
            </Link>
            <p className="truncate text-xs text-[var(--text-3)]">
              {node.isMine
                ? "You"
                : node.task.assignees.map((a) => a.name).join(", ") || "Unassigned"}
              {node.waitingOn.length > 0
                ? ` · waiting on ${node.waitingOn.map(taskReference).join(", ")}`
                : ""}
            </p>
          </div>

          <div className="flex flex-none items-center gap-2">
            {node.isUpNext ? <Badge kind="strong">Start here</Badge> : null}
            <Badge kind={STATE_BADGE[node.state]}>{STATE_LABEL[node.state]}</Badge>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** The Sequences view's body. A server component — nothing here is
 * interactive, and the rows inside "Not sequenced" bring their own client
 * behaviour through TaskRow. */
export function TaskSequences({
  sequences,
  unsequenced,
}: {
  sequences: Sequence[];
  unsequenced: TaskListRow[];
}) {
  return (
    <div className="space-y-6">
      {sequences.length === 0 ? (
        <SectionCard title="Sequences">
          {/* Never a blank page. With no dependencies anywhere this view is
              working correctly and has nothing to draw, and an empty screen
              that is working correctly reads as a broken one. */}
          <p className="text-sm text-[var(--text-3)]">
            None of your tasks are part of a sequence yet. Add a blocker on a task to build one.
          </p>
        </SectionCard>
      ) : (
        sequences.map((sequence) => (
          <SectionCard
            key={sequence.id}
            title={`${sequence.nodes.length} tasks`}
            meta={sequence.actionable ? "you're up" : "waiting"}
          >
            <SequenceRail sequence={sequence} />
          </SectionCard>
        ))
      )}

      <SectionCard title="Not sequenced" meta={unsequenced.length || null} flush>
        {unsequenced.length === 0 ? (
          <p className="p-4 text-sm text-[var(--text-3)]">Everything of yours is in a sequence.</p>
        ) : (
          unsequenced.map((row) => <TaskRow key={row.id} row={row} />)
        )}
      </SectionCard>
    </div>
  );
}
