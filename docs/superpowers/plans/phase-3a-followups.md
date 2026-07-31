# Phase 3a — Post-merge Follow-ups

Carried out of the Phase 3a final whole-branch review (branch `phase-3a-tasks-team`, 4 review lenses, every finding refutation-tested). Five must-fix items were applied in a single fix wave before merge and are **not** listed here.

**All nine items below were resolved on 2026-07-31.** The record of what each one was, and how it was settled, is kept here rather than deleted — several encode a decision a later phase could otherwise re-litigate.

## Resolved

1. **The P2002 retry in `setTaskAssignees` guarded an unreachable error.** *Premise proven false, retry removed.* A probe against this Postgres install showed `taskAssignee.createMany({ …, skipDuplicates: true })` returns `{ count: 0 }` on a duplicate without throwing, while the identical insert *without* `skipDuplicates` throws P2002 — confirming both that the conflict is absorbed and that the unique constraint is genuinely there. `setTaskAssignees` is now a single `attemptTaskAssigneeDiff` call, `isConcurrentInsertRace` is gone, and the two tests that only witnessed the fake throwing its own fixture were replaced by (a) an assertion that exactly one insert is ever issued and it carries `skipDuplicates`, and (b) the race that *is* reachable — two overlapping saves diffing against the same stale `current`, where the later save's `removedIds` deletes a row the earlier one just created and still returns `ok`. That is last-writer-wins, the intended semantics of a set replacement, and it is now pinned rather than accidental.
2. **`TaskRowSource.status`/`priority` were typed as plain `string`.** Now the `TaskStatus`/`TaskPriority` unions. All six casts in `toTaskListRow` and `getTaskDetail` deleted; `tsc` is clean without them, because Prisma already returns the enum types. Phase 3b's kanban builds on these rows cast-free.
3. **Checklist error state was list-scoped.** `error` is now `{ scope, message }`, where `scope` is the item id or `ADD_SCOPE`. A failed toggle renders under the row it happened on; an add failure still renders under the add form.
4. **`overdue` was computed and never rendered.** Now rendered, on the grounds that the milestone strip already shows overdue milestones in `--bad` on the same screen. `<TaskRow>` recolours its subtitle and the task detail page recolours its due line — no new string, so the Vocabulary Lock is untouched.
5. **A personal task moving *into* a project logged under no client.** Fixed in `updateTask`: the project lookup on the move path now also selects `clientId`, and the activity row is scoped `scope.clientId ?? destinationClientId`. Clearing a project still logs under the pre-move client, because `destinationClientId` stays null there. **Reproduced live in the browser before the fix** (`task.updated` written with `clientId: null`, visible on no timeline). Two tests: the mirror of the existing clear-to-personal case, plus a guard that a project-to-project move still leaves its old timeline, so the asymmetry cannot be "tidied" away.
6. **`createTaskAction` silently fell back on a bad status.** Now returns `err("Invalid input")`, reading identically to `setTaskStatusAction` four lines below. Confirmed safe: `<TaskForm>` renders `name="status"` exactly when `!task`, and `createTaskAction` is only reached from that branch, so the field is always present on a legitimate submit.
7. **A stale doc comment on `taskSchema`.** Reworded — R15 constrains `updateTask`, not creation; creation parses status separately and `<TaskForm>` renders a status select in create mode.
8. **A weak assertion in `tests/team-queries.test.ts`.** Now asserts the whole `where` object, so dropping `userId: { in: ids }` fails. Noted in the test why that omission has no visible symptom: the in-memory fold discards unknown members anyway, so every card would still render correctly while production hydrated every IN_PROGRESS assignment row on each `/team` render.
9. **The inline pluralisation ternary on `src/app/(app)/projects/page.tsx`** (was on master, not the branch). Extracted as `projectCountLabel` in `src/lib/project.ts` with three tests, including the zero case — a filtered view legitimately reaches zero and must stay a bare count, not `projectListSummary`'s "No projects yet".

## Accepted — no action planned

- Schema column alignment and seed block formatting: cosmetic.
- `taskRowSubtitle`'s all-or-nothing client/project join: unreachable while `Project.clientId` is required.
- `pick()`'s widened cast: Prisma's `data` argument is partial; no runtime effect.
- The `not.toContain("assigneeIds")` assertion: tautological today, but a cheap guard against a future implementation that spreads `input` into the update payload.
- Duplicate-ish assignment assertions: redundant, not wrong; both still fail against a no-delete implementation.
- `loadChecklistScope`'s redundant `taskId` and unused `task.id`/`title` select: literal parity with its declared signature.
- Redundant `byMember.set` after in-place mutation in `team-queries.ts`.
- `<TaskAssigneesForm>`'s "Save assignees" label instead of the locked "Save": justified, since two identical Save buttons on one screen is worse. **Still to be recorded as a Vocabulary Lock exception in the plan so the lock stays audit-complete.**

## Browser QA — done 2026-07-31

The Tasks 10–12 click-through was executed against a temporary QA account (since deleted, along with every task, activity row and account it created; the deactivated member was reactivated). Everything exercised passed. Highlights:

- Progress flipped **50% (2/4 milestones) → 0% (0/1 task)** the moment a project got its first task, and to **100%** on completion — identically on the project page, `/projects` and the client page. A move to Review did not shift it.
- Milestone fallback intact (a project with milestones and no tasks stayed milestone-derived); a project with neither read `—` plus "Add tasks or set progress manually", never `0%`.
- One correctly client-scoped activity row per mutation, including checklist rows resolving the client through the two-level walk-up; personal-task rows written `clientId: null` and absent from the client timeline.
- A save adding two people and removing one produced exactly two rows, each naming everyone affected.
- A deactivated member stayed checked in the picker, survived an unrelated save, and produced no `task.unassigned` row.
- A rejected submit preserved every field including three selects and both checkboxes.

**Not exercised**, needing data or setup judged not worth building at the time: the five-assignee `+2` avatar cap (only three users exist), the sort ordering across dated/undated/priority, and the "under 15 seconds" timing claim.

**Two observations from the click-through**, neither a defect, both unresolved:

- The checklist affordance is a button labelled **"Add"**, while the Vocabulary Lock specifies "Add checklist item" (that string is the input's placeholder). Worth recording as a lock exception the way "Save assignees" was, or relabelling.
- A project row still reads "4 milestones · due 14 Aug" while its progress is task-derived. Mildly self-contradictory once the basis flips; `projectRowSubtitle`'s own comment anticipates the basis change.

## Still open

- **QA finding 1**, carried from Phase 2: next-themes emits "Encountered a script tag while rendering React component" on the `notFound()` path. Re-confirmed on `/tasks/does-not-exist`. Pre-existing Phase 1 architecture — the theme script lives inside a client component, and next-themes 0.4.6 offers no way to suppress it. A real fix means replacing next-themes; only `theme-provider.tsx` and `topbar.tsx` use it.
