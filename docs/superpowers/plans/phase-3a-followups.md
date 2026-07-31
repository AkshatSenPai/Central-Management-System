# Phase 3a — Post-merge Follow-ups

Carried out of the Phase 3a final whole-branch review (branch `phase-3a-tasks-team`, 4 review lenses, every finding refutation-tested). Five must-fix items were applied in a single fix wave before merge and are **not** listed here. Nothing below blocks merge.

## Fix soon

1. **The P2002 retry in `setTaskAssignees` guards an unreachable error.** `src/lib/task-service.ts` retries once on a unique-constraint violation from `taskAssignee.createMany`, but the datasource is Postgres and `skipDuplicates: true` compiles to `INSERT … ON CONFLICT DO NOTHING`, which absorbs the conflict rather than raising P2002. Its two tests only witness the fake throwing what the fixture told it to. This was plan-mandated and passed two review rounds, so it was deliberately left alone rather than overturned same-day. Either prove the premise with one integration check on this install, or drop the retry and replace both tests with the race that *is* reachable: two overlapping saves diffing against the same stale `current` snapshot, where the later save's `removedIds` re-deletes rows the first just created and still returns `ok`. **That untested race is the real gap.**
2. **`TaskRowSource.status`/`priority` are typed as plain `string`**, forcing casts in `toTaskListRow` and `getTaskDetail` (`src/lib/task-queries.ts`). Phase 3b's kanban builds directly on these rows and inherits every cast. Highest-value of the deferred minors.
3. **Checklist error state is list-scoped** (`src/components/tasks/checklist.tsx`): a failed toggle on item 7 renders the error above item 1. Cheap to make per-item now, before 3c adds more per-row controls.
4. **`overdue` is computed and never rendered.** `task-queries.ts` derives it on every row and `TaskRow` shows an overdue task in the same muted colour as any other, while the milestone strip renders overdue milestones in `--bad` on the same screen. Either render it in the row subtitle or drop it from `TaskListRow`/`TaskDetail` and their mappers — carrying a computed-but-unread field into 3b is how it becomes load-bearing by accident.
5. **A personal task moving *into* a project logs under no client.** R13 scopes `task.updated` to the pre-move client, which is right for project-to-project moves, but a personal task has no pre-move client, so the row is written with `clientId: null` and appears on no timeline at all. Fix in `updateTask`: when the pre-move scope has no client and the write sets a non-null `projectId`, log under the destination client resolved from the project lookup already issued. Add the mirror test beside the existing "clearing the project to personal" case and note the asymmetry in the R13 comment so 3b does not re-derive it.
6. **`createTaskAction` silently falls back on a bad status** while `setTaskStatusAction` four lines later returns `err("Invalid input")` for the identical enum (`src/server/actions/tasks.ts`). Only reachable via a tampered or stale request. Make it return the error.
7. **A stale doc comment.** `src/lib/task.ts`'s `taskSchema` comment claims "a task is always created TO_DO; status only ever changes through `setTaskStatus`", which is false — `createTaskAction` parses status off FormData and `TaskForm` renders a status select in create mode. R15 only ever constrained `updateTask`. Reword it.
8. **A weak assertion in `tests/team-queries.test.ts`** asserts only the `where.task` fragment while its sibling asserts the whole `groupBy` object. Dropping `userId: { in: ids }` from `src/lib/team-queries.ts` would pass every test while making production hydrate every IN_PROGRESS assignment row on each `/team` render.

## On master, not this branch

- **`src/app/(app)/projects/page.tsx` still carries the inline pluralisation ternary** this phase removed from My Tasks, introduced by the earlier Done-project fix. Extract a `projectCountLabel` helper in `src/lib/project.ts` with tests.

## Accepted — no action planned

- Schema column alignment and seed block formatting: cosmetic.
- `taskRowSubtitle`'s all-or-nothing client/project join: unreachable while `Project.clientId` is required.
- `pick()`'s widened cast: Prisma's `data` argument is partial; no runtime effect.
- The `not.toContain("assigneeIds")` assertion: tautological today, but a cheap guard against a future implementation that spreads `input` into the update payload.
- Duplicate-ish assignment assertions ("never issues a blanket delete" duplicating the exact-`toEqual` before it): redundant, not wrong; both still fail against a no-delete implementation.
- `loadChecklistScope`'s redundant `taskId` and unused `task.id`/`title` select: literal parity with its declared signature.
- Redundant `byMember.set` after in-place mutation in `team-queries.ts`.
- `<TaskAssigneesForm>`'s "Save assignees" label instead of the locked "Save": justified, since two identical Save buttons on one screen is worse. **Record it as a third Vocabulary Lock exception in the plan so the lock stays audit-complete.**
- The redundant both-field gate and missing `shrink-0` on the member-card header badge: matches an unguarded pattern already present elsewhere; not a regression.

## Still to verify

The browser QA checklists across Tasks 10, 11 and 12 are **pending the owner's click-through** — they require an authenticated session, which was deliberately not created. Every non-authenticated gate (tests, type-check, lint, production build, the no-hardcoded-colour grep) passed, and each pending line has a recorded code-level walkthrough, but the click-through is the honest remaining gap. See `docs/superpowers/plans/2026-07-31-phase-3a-tasks-team.md` Tasks 10–12 for the line-by-line lists.
