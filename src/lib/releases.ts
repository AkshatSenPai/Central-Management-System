/** What the team is told changed, newest first.
 *
 * **In the repo, not a table.** These ship in the same commit as the feature
 * they describe, so a note cannot survive a reverted feature or describe
 * something that never deployed. A table's only advantage is editing without a
 * deploy — and this studio deploys BY pushing to master, so that is no
 * advantage at all, and it would cost an admin CRUD surface nobody asked for.
 *
 * `id` is a plain date string a human writes. It is compared, never parsed or
 * ordered — see `shouldShowRelease`. **Add new entries at the TOP**, and only
 * when there is something a teammate would want to be told; a release nobody
 * needs to hear about simply gets no entry, and nothing pops up. */
export type Release = { id: string; date: string; title: string; items: string[] };

export const RELEASES: Release[] = [
  {
    id: "2026-08-12",
    date: "12 August 2026",
    title: "Contracts, and marking your own part done",
    items: [
      "You can now generate a client document from the CMS — a proposal, a one-time agreement, a maintenance agreement, or either agreement with a trial first month. Start one from a client's page, under Contracts.",
      "Fill in the client and the plan; the app picks the right document, fills it in, and checks it for blanks and numbering before it will let you issue it.",
      "Issuing gives the contract its agreement number and freezes it — an issued contract is the record of what was sent and cannot be edited afterwards, only voided and replaced.",
      "Download the finished contract as a PDF from the same page. Every contract you have made is listed together under Contracts in the sidebar.",
      "On a shared task, you can tick off just your own part with “My part done”. The task closes when everybody has ticked theirs.",
    ],
  },
  {
    id: "2026-08-10",
    date: "10 August 2026",
    title: "Task sequencing, and a few smaller things",
    items: [
      "Tasks can now be blocked until another task is done. Open a task and use “Blocked by” to set it up.",
      "A blocked task shows what it is waiting for, on the board and in your lists.",
      "My Tasks has a new Sequences view showing each chain in order, so you can see what to start next and who you are waiting on.",
      "My Tasks can now be filtered to client work, personal work, or a single project.",
      "Admins can see punch-in and punch-out times in Settings → Attendance.",
    ],
  },
];
