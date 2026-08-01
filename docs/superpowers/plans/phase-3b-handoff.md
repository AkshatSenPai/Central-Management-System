# Phase 3b — Handoff (as of 2026-08-01)

Written to survive a chat switch. Everything here was verified against the working tree, not recalled.

## Where the project is

| Phase | State |
|---|---|
| 1 — Foundation (auth, members, app shell) | merged to `master` |
| 2 — Clients & Projects | merged to `master` |
| 3a — Tasks & Team Visibility | merged to `master`; all nine follow-ups resolved, browser QA executed |
| **3b — Board, member profiles, quick-add** | **in progress on `phase-3b-board-people`, 5 commits ahead of `master`** |

Gates on the branch right now: **461 tests across 33 files passing**, `npx tsc --noEmit` clean, `npm run lint` clean.

## Phase 3b progress

Plan: `docs/superpowers/plans/2026-08-01-phase-3b-board-people.md` · design: `docs/superpowers/specs/2026-08-01-phase-3b-board-people-design.md`
Execution ledger (gitignored, may be deleted): `.superpowers/sdd/2026-08-01-phase-3b-board-people/progress.md`

| Task | State |
|---|---|
| 1 — Rename `listMyTasks` → `listAssignedTasks` | complete, review clean (`af6e378`) |
| 2 — `groupTasksByStatus` + corrected `order` comment (TDD) | complete, review clean (`19a3b48`) |
| 3 — Board card, column and route (no drag) | complete, review clean, no findings (`368f3d8`) |
| 4 — Drag between columns with optimistic movement | complete after one fix round (`f73467f`, `be69b6f`) |
| **5 — `getMemberProfile` read model (TDD)** | **next; brief already extracted, not yet dispatched** |
| 6 — `/team/[memberId]` page and links from the grid | not started |
| 7 — Global quick-add | not started |
| 8 — Browser QA and final gates | not started |

Two plan mandates were passed to reviewers as constraints so they would not be mistaken for defects: every board card renders `<TaskStatusControl>` alongside drag (design D4 — it is the keyboard and touch path, not redundancy), and Tasks 3, 4, 6 and 7 add no unit tests (pages and components are carried by the Task 8 browser QA).

## Open question — needs a human ruling before Task 8

Task 4's review found two Important issues, **both originating in the plan's own text rather than implementer error**. Both are fixed in code, but one leaves a live question:

The board comment claimed `setTaskStatusAction` revalidates only on success. That is false — `src/server/actions/tasks.ts` revalidates unconditionally. The optimistic rollback is still correct, but for a different reason: the database is unchanged on failure, so the refetch returns the original status.

The consequence is what matters: on a `"Task not found"` failure the row is revalidated away, so **the card disappears and its per-card error never renders**. Plan Task 8, step 1, item 11 tests exactly that error appearing — it asserts a scenario the code cannot produce.

**Recommendation:** rewrite item 11 to assert the card disappears cleanly rather than showing an inline error. Not yet applied — awaiting the ruling.

## Deferred minors carried on the branch

- Task 1 also fixed a stale `listMyTasks` comment in `tests/task.test.ts`, outside its brief's file list — correct, but unlisted.
- `task-2-report.md` quotes wrong line counts for its own diff — documentation only.
- The drag-over highlight can stick after an aborted drag (Esc, or dropping outside a column): `BoardColumn` exposes no `onDragLeave` and `BoardCard` no `onDragEnd`, both frozen during Task 4.

## Carried from earlier phases

- **Vocabulary Lock exceptions still to be recorded in the plan** so the lock stays audit-complete: `<TaskAssigneesForm>`'s "Save assignees" (justified — two identical Save buttons on one screen is worse), and the checklist's **"Add"** button where the lock says "Add checklist item" (that string is the input's placeholder).
- **A project row still reads "4 milestones · due 14 Aug" while its progress is task-derived.** Mildly self-contradictory once the basis flips; `projectRowSubtitle`'s own comment anticipates this.
- **Open bug, pre-existing since Phase 1:** next-themes emits "Encountered a script tag while rendering React component" on the `notFound()` path (re-confirmed on `/tasks/does-not-exist`). A real fix means replacing next-themes; only `theme-provider.tsx` and `topbar.tsx` use it.

## How this work is being run

Plan first (`superpowers:writing-plans`), then `superpowers:subagent-driven-development`: a fresh implementer subagent per task, an independent task-scoped review after each, fix rounds dispatched back to the original implementer, and a multi-lens whole-branch review before merge. Merges are local (`git merge`, delete the branch); there is no remote configured.

**Browser QA needs the owner.** Every authenticated click-through is theirs to run — no session is created on their behalf, so those lines are recorded as pending rather than passing.
