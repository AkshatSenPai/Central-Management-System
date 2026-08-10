/** The graph half of task sequencing: grouping connected tasks, ordering them,
 * and stating where the viewer sits.
 *
 * Its own file rather than more of `task.ts`, which is 438 lines and has a
 * different job — labels, sorts and predicates about ONE task, not traversal
 * over many. Everything here is pure and tested without a database.
 *
 * Spec: docs/superpowers/specs/2026-08-10-my-tasks-sequences-view-design.md */

import { isTaskBlocked, type TaskStatus } from "@/lib/task";

/** One dependency row, exactly as TaskDependency stores it: `blockedTaskId`
 * WAITS ON `blockerTaskId`. Both columns are Tasks and a reversed pair is a
 * silent logic inversion no type can catch, so read it twice. */
export type SequenceEdge = { blockedTaskId: string; blockerTaskId: string };

/** A task as a sequence node needs it. Deliberately not `TaskListRow`: this
 * renders inside a rail, not as a full row, and half of that type's fields
 * (subtitle, overdue, clientName) have nothing to say here. */
export type SequenceTask = {
  id: string;
  reference: number;
  title: string;
  status: TaskStatus;
  assignees: Array<{ id: string; name: string; initials: string }>;
};

/** Deliberately NOT `TaskStatus`. A task can be IN_PROGRESS and `waiting` at
 * the same time — its blocker was reopened — and one vocabulary cannot express
 * both. Spec §12. */
export type SequenceNodeState = "done" | "ready" | "waiting";

/** Connected groups containing at least one of the viewer's tasks and at least
 * two tasks in total.
 *
 * **Undirected on purpose** (spec §4). Following only "what blocks me" would
 * hide what is waiting on the viewer, which is half of what this view exists
 * for. Direction matters for ORDERING, not for membership — that is
 * `orderSequence`'s job.
 *
 * A task with no dependencies never appears in the adjacency map at all, so it
 * falls out naturally rather than needing a special case; the explicit
 * `length >= 2` guard is kept because the rule should be readable rather than
 * emergent. */
export function groupIntoSequences(edges: SequenceEdge[], myTaskIds: string[]): string[][] {
  const adjacent = new Map<string, Set<string>>();
  const link = (from: string, to: string) => {
    const set = adjacent.get(from) ?? new Set<string>();
    set.add(to);
    adjacent.set(from, set);
  };
  for (const edge of edges) {
    link(edge.blockedTaskId, edge.blockerTaskId);
    link(edge.blockerTaskId, edge.blockedTaskId);
  }

  const mine = new Set(myTaskIds);
  const seen = new Set<string>();
  const groups: string[][] = [];

  for (const start of adjacent.keys()) {
    if (seen.has(start)) continue;

    const group: string[] = [];
    const queue = [start];
    seen.add(start);
    while (queue.length > 0) {
      const id = queue.shift() as string;
      group.push(id);
      for (const neighbour of adjacent.get(id) ?? []) {
        if (seen.has(neighbour)) continue;
        seen.add(neighbour);
        queue.push(neighbour);
      }
    }

    if (group.length >= 2 && group.some((id) => mine.has(id))) groups.push(group);
  }

  return groups;
}

/** Kahn's algorithm: repeatedly take every task whose blockers are all placed,
 * sorted by reference so the order is deterministic and matches creation order
 * rather than whichever key a Map happened to yield first.
 *
 * Taking a whole LAYER at a time is what produces spec §5's linearisation: for
 * a diamond D → (B, C) → A the layers are [D], [B, C], [A], so it reads
 * D, B, C, A. That loses the fact that B and C are parallel, which is the
 * documented trade — drawing true branches needs a graph renderer, and nothing
 * in the request asks for one.
 *
 * The empty-layer break is a backstop for a cycle, which cannot exist because
 * `addTaskDependency` refuses one at write time. It is here because a page
 * that hangs is worse than one rendering an incomplete order. */
export function orderSequence(edges: SequenceEdge[], tasks: SequenceTask[]): SequenceTask[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const blockerCount = new Map<string, number>(tasks.map((t) => [t.id, 0]));
  const dependents = new Map<string, string[]>(tasks.map((t) => [t.id, []]));

  for (const edge of edges) {
    // An edge with either end outside this group is not this group's business.
    if (!byId.has(edge.blockedTaskId) || !byId.has(edge.blockerTaskId)) continue;
    blockerCount.set(edge.blockedTaskId, (blockerCount.get(edge.blockedTaskId) as number) + 1);
    (dependents.get(edge.blockerTaskId) as string[]).push(edge.blockedTaskId);
  }

  const ordered: SequenceTask[] = [];
  const remaining = new Map(blockerCount);

  while (remaining.size > 0) {
    const layer = [...remaining.entries()]
      .filter(([, count]) => count === 0)
      .map(([id]) => id)
      .sort(
        (a, b) => (byId.get(a) as SequenceTask).reference - (byId.get(b) as SequenceTask).reference
      );

    if (layer.length === 0) break;

    for (const id of layer) {
      ordered.push(byId.get(id) as SequenceTask);
      remaining.delete(id);
      for (const dependent of dependents.get(id) as string[]) {
        const left = remaining.get(dependent);
        if (left !== undefined) remaining.set(dependent, left - 1);
      }
    }
  }

  return ordered;
}

/** Done, ready or waiting. Delegates to `isTaskBlocked` rather than restating
 * the rule — there must stay exactly one definition of blocked in this
 * codebase. */
export function sequenceNodeState(
  task: { status: TaskStatus },
  blockers: { status: TaskStatus }[]
): SequenceNodeState {
  if (task.status === "DONE") return "done";
  return isTaskBlocked(blockers) ? "waiting" : "ready";
}
