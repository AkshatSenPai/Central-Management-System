# Phase 3b — Handoff (as of 2026-08-01, updated after Tasks 5–7)

Written to survive a chat switch. Everything here was verified against the working tree, not recalled.

## Where the project is

| Phase | State |
|---|---|
| 1 — Foundation (auth, members, app shell) | merged to `master` |
| 2 — Clients & Projects | merged to `master` |
| 3a — Tasks & Team Visibility | merged to `master`; all nine follow-ups resolved, browser QA executed |
| **3b — Board, member profiles, quick-add** | **in progress on `phase-3b-board-people`, 10 commits ahead of `master`** |

Gates on the branch right now: **471 tests across 33 files passing**, `npx tsc --noEmit` clean, `npm run lint` clean, `npm run build` clean (route list carries `/projects/[projectId]/board` and `/team/[memberId]`), colour scan clean over `src/**/*.{ts,tsx}`.

## Phase 3b progress

Plan: `docs/superpowers/plans/2026-08-01-phase-3b-board-people.md` · design: `docs/superpowers/specs/2026-08-01-phase-3b-board-people-design.md`
Execution ledger (gitignored, may be deleted): `.superpowers/sdd/2026-08-01-phase-3b-board-people/progress.md`

| Task | State |
|---|---|
| 1 — Rename `listMyTasks` → `listAssignedTasks` | complete, review clean (`af6e378`) |
| 2 — `groupTasksByStatus` + corrected `order` comment (TDD) | complete, review clean (`19a3b48`) |
| 3 — Board card, column and route (no drag) | complete, review clean, no findings (`368f3d8`) |
| 4 — Drag between columns with optimistic movement | complete after one fix round (`f73467f`, `be69b6f`) |
| 5 — `getMemberProfile` read model (TDD) | complete after one review fix (`7dd7971`, `5284f57`) |
| 6 — `/team/[memberId]` page and links from the grid | complete, review clean (`8291a82`) |
| 7 — Global quick-add | complete after one fix round (`3c5f519`, `b8db13c`) |
| **8 — Browser QA and final gates** | **next; needs the owner's authenticated session** |

Two plan mandates were passed to reviewers as constraints so they would not be mistaken for defects: every board card renders `<TaskStatusControl>` alongside drag (design D4 — it is the keyboard and touch path, not redundancy), and Tasks 3, 4, 6 and 7 add no unit tests (pages and components are carried by the Task 8 browser QA).

## Open questions — need a human ruling before Task 8

Three, all edits to the plan's Task 8 text rather than to code. None blocks starting QA.

### 1. Item 11 tests a scenario the code cannot produce

Task 4's review found two Important issues, **both originating in the plan's own text rather than implementer error**. Both are fixed in code, but one leaves a live question:

The board comment claimed `setTaskStatusAction` revalidates only on success. That is false — `src/server/actions/tasks.ts` revalidates unconditionally. The optimistic rollback is still correct, but for a different reason: the database is unchanged on failure, so the refetch returns the original status.

The consequence is what matters: on a `"Task not found"` failure the row is revalidated away, so **the card disappears and its per-card error never renders**. Plan Task 8, step 1, item 11 tests exactly that error appearing — it asserts a scenario the code cannot produce.

**Recommendation:** rewrite item 11 to assert the card disappears cleanly rather than showing an inline error. Not yet applied — awaiting the ruling.

### 2. Step 4's colour gate can never pass as written

`git grep -nE "dark:|#[0-9a-fA-F]{3,6}" -- src/app src/components src/lib` is specified as "Expected: no output", but it always matches `src/app/globals.css` — the file where the tokens are *defined*. Run as written it reports failure on a clean branch, every time.

**Recommendation:** scope it to `'src/**/*.tsx' 'src/**/*.ts'`, which is what the constraint actually means and which is clean across the whole branch today. Not yet applied.

### 3. Whether to widen `taskSchema` instead of padding short forms

Task 7's fix (`b8db13c`) makes `<QuickAdd>` submit four empty hidden inputs because `taskSchema`'s optional fields accept `undefined` or `""` but never `null`, and `formData.get()` returns `null` for a field a form omits. The general fix — making the schema accept `null` — sits in `src/lib/task.ts`, outside Task 7's frozen file list, and changes validation for every existing caller.

**Recommendation:** leave the local fix in place for 3b and carry the schema change as a follow-up, so the next short form does not rediscover this. Not yet applied.

## Deferred minors carried on the branch

- Task 1 also fixed a stale `listMyTasks` comment in `tests/task.test.ts`, outside its brief's file list — correct, but unlisted.
- `task-2-report.md` quotes wrong line counts for its own diff — documentation only.
- The drag-over highlight can stick after an aborted drag (Esc, or dropping outside a column): `BoardColumn` exposes no `onDragLeave` and `BoardCard` no `onDragEnd`, both frozen during Task 4.
- The planned Task 5 test "issues exactly three queries whatever the row count" exercises only one row count, unlike `listTeamCards`' analogous test which runs 5 members and 1. The name overpromises.
- `MemberProfileProject.clientId` is selected, mapped and typed but never read — the profile chips link to `/projects/{id}` and render `clientName` only.
- The "Quick add" trigger has no `aria-expanded`/`aria-haspopup`, so the panel's open state is not announced. It is otherwise keyboard-dismissible.
- `(app)/layout.tsx` now issues a `user.findMany` on every page render to feed the topbar member list. Plan-specified; one extra query per page, not per component.
- `createTaskAction` and the task mutations revalidate `/my-tasks` and `/team` but not `/team/{memberId}`. Next 16 leaves dynamic routes uncached client-side by default and `next.config.ts` sets no `staleTimes`, so this is expected to be invisible — **Task 8 should confirm rather than assume.**

## Carried from earlier phases

- **Vocabulary Lock exceptions still to be recorded in the plan** so the lock stays audit-complete: `<TaskAssigneesForm>`'s "Save assignees" (justified — two identical Save buttons on one screen is worse), and the checklist's **"Add"** button where the lock says "Add checklist item" (that string is the input's placeholder).
- **A project row still reads "4 milestones · due 14 Aug" while its progress is task-derived.** Mildly self-contradictory once the basis flips; `projectRowSubtitle`'s own comment anticipates this.
- **Open bug, pre-existing since Phase 1:** next-themes emits "Encountered a script tag while rendering React component" on the `notFound()` path (re-confirmed on `/tasks/does-not-exist`). A real fix means replacing next-themes; only `theme-provider.tsx` and `topbar.tsx` use it.

## How this work is being run

Plan first (`superpowers:writing-plans`), then `superpowers:subagent-driven-development`: a fresh implementer subagent per task, an independent task-scoped review after each, fix rounds dispatched back to the original implementer, and a multi-lens whole-branch review before merge. Merges are local (`git merge`, delete the branch); there is no remote configured.

**Browser QA needs the owner.** Every authenticated click-through is theirs to run — no session is created on their behalf, so those lines are recorded as pending rather than passing.
