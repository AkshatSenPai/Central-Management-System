/** The graph half of task sequencing: grouping connected tasks, ordering them,
 * and stating where the viewer sits.
 *
 * Its own file rather than more of `task.ts`, which is 438 lines and has a
 * different job — labels, sorts and predicates about ONE task, not traversal
 * over many. Everything here is pure and tested without a database.
 *
 * Spec: docs/superpowers/specs/2026-08-10-my-tasks-sequences-view-design.md */

/** One dependency row, exactly as TaskDependency stores it: `blockedTaskId`
 * WAITS ON `blockerTaskId`. Both columns are Tasks and a reversed pair is a
 * silent logic inversion no type can catch, so read it twice. */
export type SequenceEdge = { blockedTaskId: string; blockerTaskId: string };

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
