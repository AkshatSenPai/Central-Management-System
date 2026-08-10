import { describe, it, expect } from "vitest";
import { groupIntoSequences } from "@/lib/sequences";

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
