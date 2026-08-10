import { describe, it, expect } from "vitest";
import { groupIntoSequences, orderSequence, sequenceNodeState } from "@/lib/sequences";

/** [blockedTaskId, blockerTaskId] — "the first waits on the second". */
function edges(pairs: [string, string][]) {
  return pairs.map(([blockedTaskId, blockerTaskId]) => ({ blockedTaskId, blockerTaskId }));
}

describe("groupIntoSequences", () => {
  it("finds a pair the viewer is part of", () => {
    const groups = groupIntoSequences(edges([["a", "b"]]), ["a"]);
    expect(groups).toHaveLength(1);
    expect([...groups[0]].sort()).toEqual(["a", "b"]);
  });

  // Spec §4: the traversal is UNDIRECTED. Following only "what blocks me"
  // would hide what is waiting on the viewer, which is half the feature —
  // and is the half a naive implementation drops.
  it("follows the graph in both directions", () => {
    // b waits on a. The viewer owns a, and must still see b.
    const groups = groupIntoSequences(edges([["b", "a"]]), ["a"]);
    expect([...groups[0]].sort()).toEqual(["a", "b"]);
  });

  it("reaches a task connected only through someone else's", () => {
    // c waits on b waits on a; the viewer owns only a.
    const groups = groupIntoSequences(edges([["c", "b"], ["b", "a"]]), ["a"]);
    expect([...groups[0]].sort()).toEqual(["a", "b", "c"]);
  });

  it("keeps separate groups separate", () => {
    const groups = groupIntoSequences(edges([["a", "b"], ["c", "d"]]), ["a", "c"]);
    expect(groups).toHaveLength(2);
  });

  // Spec §4: a group of one is noise, and falls through to unsequenced.
  it("drops a group the viewer is not part of", () => {
    expect(groupIntoSequences(edges([["x", "y"]]), ["a"])).toEqual([]);
  });

  it("returns nothing when there are no edges at all", () => {
    expect(groupIntoSequences([], ["a", "b", "c"])).toEqual([]);
  });

  // A diamond is one group, not two paths.
  it("treats a diamond as a single group", () => {
    const groups = groupIntoSequences(
      edges([
        ["a", "b"],
        ["a", "c"],
        ["b", "d"],
        ["c", "d"],
      ]),
      ["a"]
    );
    expect(groups).toHaveLength(1);
    expect([...groups[0]].sort()).toEqual(["a", "b", "c", "d"]);
  });
});

function task(id: string, reference: number, status = "TO_DO" as const) {
  return { id, reference, title: `Task ${id}`, status, assignees: [] };
}

describe("orderSequence", () => {
  it("puts the blocker before the task that waits on it", () => {
    const ordered = orderSequence(edges([["a", "b"]]), [task("a", 24), task("b", 18)]);
    expect(ordered.map((t) => t.id)).toEqual(["b", "a"]);
  });

  it("orders a three-task chain end to end", () => {
    // c waits on b waits on a.
    const ordered = orderSequence(
      edges([
        ["c", "b"],
        ["b", "a"],
      ]),
      [task("a", 26), task("b", 25), task("c", 24)]
    );
    expect(ordered.map((t) => t.id)).toEqual(["a", "b", "c"]);
  });

  // Spec §5 pins this exact linearisation. A diamond reads D, B, C, A — a
  // defensible order that loses the fact B and C are parallel. Asserted so
  // the trade is deliberate rather than incidental.
  it("linearises a diamond as D, B, C, A", () => {
    const ordered = orderSequence(
      edges([
        ["a", "b"],
        ["a", "c"],
        ["b", "d"],
        ["c", "d"],
      ]),
      [task("a", 40), task("b", 20), task("c", 30), task("d", 10)]
    );
    expect(ordered.map((t) => t.id)).toEqual(["d", "b", "c", "a"]);
  });

  // Ties inside a layer break by reference ascending, so the order is
  // deterministic and matches creation order rather than map insertion.
  it("breaks ties by reference, not by input order", () => {
    const ordered = orderSequence(
      edges([
        ["a", "b"],
        ["a", "c"],
      ]),
      [task("a", 40), task("c", 30), task("b", 20)]
    );
    expect(ordered.map((t) => t.id)).toEqual(["b", "c", "a"]);
  });

  it("ignores edges pointing outside the group", () => {
    const ordered = orderSequence(
      edges([
        ["a", "b"],
        ["a", "ghost"],
      ]),
      [task("a", 24), task("b", 18)]
    );
    expect(ordered.map((t) => t.id)).toEqual(["b", "a"]);
  });

  // Cycles are refused at write time, so this should be unreachable — but a
  // page that hangs is worse than one that renders an odd order.
  it("terminates rather than hanging on an impossible cycle", () => {
    const ordered = orderSequence(
      edges([
        ["a", "b"],
        ["b", "a"],
      ]),
      [task("a", 1), task("b", 2)]
    );
    expect(ordered.length).toBeLessThanOrEqual(2);
  });
});

describe("sequenceNodeState", () => {
  it("is done for a DONE task whatever blocks it", () => {
    expect(sequenceNodeState({ status: "DONE" }, [{ status: "TO_DO" }])).toBe("done");
  });

  it("is ready when every blocker is finished", () => {
    expect(sequenceNodeState({ status: "TO_DO" }, [{ status: "DONE" }])).toBe("ready");
  });

  it("is ready with no blockers at all", () => {
    expect(sequenceNodeState({ status: "IN_PROGRESS" }, [])).toBe("ready");
  });

  it("is waiting while any blocker is unfinished", () => {
    expect(sequenceNodeState({ status: "TO_DO" }, [{ status: "REVIEW" }])).toBe("waiting");
  });

  // A task can be IN_PROGRESS and waiting at once — its blocker was reopened.
  // Conflating these two vocabularies would make that unsayable (spec §12).
  it("can be waiting while already in progress", () => {
    expect(sequenceNodeState({ status: "IN_PROGRESS" }, [{ status: "TO_DO" }])).toBe("waiting");
  });
});
