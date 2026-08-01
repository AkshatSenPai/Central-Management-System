# Phase 3b — Board & People

**Goal:** Give each project a kanban board its tasks can be dragged across, give each member a page answering "what is this person working on", and make task capture reachable from anywhere in the app.

**Status:** design approved 2026-08-01; implementation plan not yet written.

**Inputs:** spec `docs/superpowers/specs/2026-07-29-internal-cms-design.md` (§5.3, §5.4, §9, §11) · Phase 3a design `docs/superpowers/specs/2026-07-31-phase-3a-tasks-team-design.md` (D1–D9, the Vocabulary Lock, the progress seam) · Phase 3a plan and its follow-up record.

---

## 1. Position in the split

Phase 3 was split into three slices in the 3a design. 3a shipped the task core, universal assignment, checklists, My Tasks and the Team grid. This is the second slice.

| Slice | Delivers | Status |
|---|---|---|
| 3a | Task core, universal assignment, checklists, My Tasks, Team grid, progress-basis flip | Complete |
| **3b** (this document) | **Kanban board per project, member profile page, global quick-add** | This phase |
| 3c | Comments with @mentions, attachments (R2 setup), rich-text editor | Not started |

3b closes the two items 3a deferred by name: D5's per-member profile ("moves to 3b, next to the by-person view it overlaps with") and D6's global quick-add ("deliberately deferred to 3b, to be judged on real usage rather than guessed at now").

---

## 2. What 3b does not add

This is the defining property of the phase and it shapes everything below.

**No new Prisma model. No migration. No new mutation.**

- The board moves a card by calling `setTaskStatusAction`, which exists, is tested, and already writes the correctly scoped `task.status_changed` activity row.
- Quick-add calls `createTaskAction`, which exists.
- The member profile is read models only.

3b is therefore the first slice that is entirely **read models plus UI**. Two consequences the implementation plan must honour rather than discover:

1. There is no schema task and no service-layer TDD for mutations. The Vitest surface is two functions.
2. The risk concentrates in the browser. Drag, optimistic movement and rollback cannot be covered by the closure-fake convention, so the browser QA checklist *is* this phase's verification, not a supplement to it. The plan should say so plainly instead of implying otherwise.

No new activity verbs. `describeActivity` is untouched.

---

## 3. Decisions (settled — do not relitigate)

| # | Decision |
|---|---|
| D1 | **The board moves cards between columns only.** No reordering within a column. This removes rank assignment, a reorder mutation, and the concurrency question of two people sorting simultaneously. Hand-sorting can be revisited once there is evidence anyone wants it. |
| D2 | **`Task.order` stays inert, and 3a's comment about it is corrected.** 3a wrote *"3b's kanban is what gives it meaning"*; under D1 it does not. The comment becomes an honest statement that `order` is reserved and currently read by nothing, so nobody goes hunting for ranking logic that does not exist. |
| D3 | **Native HTML5 drag events. No drag library.** Column-to-column is the case native DnD handles well; the pain of native DnD is sortable lists, which D1 removes. Adding the codebase's first client-interaction dependency for an interaction this small is not justified. |
| D4 | **`<TaskStatusControl>` stays on every card.** It is the keyboard and touch path. Accessibility does not depend on drag working, and the board degrades to a readable layout rather than an unusable one. |
| D5 | **The board is its own route, `/projects/[projectId]/board`.** Four columns need full width beside a fixed sidebar, and the project page stays a summary that keeps its Tasks list. A `/board` segment is a *view*, not a CRUD verb, so it does not contradict Phase 2's D5 or 3a's D4, both of which rejected `/new` and `/edit`. |
| D6 | **Optimistic movement via `useOptimistic`; rollback is implicit.** `setTaskStatusAction` calls `revalidatePath` only on success, so a failed `ActionResult` leaves server state untouched and React drops the optimistic overlay when the transition ends. There is no revert code to write and none to get wrong — *provided* the action is awaited **inside** the same transition that applied the optimistic update. Applying the update and then awaiting outside it ends the transition early, and the card snaps back before the server has answered. That is the one way to get this wrong, so it is stated here rather than left to be rediscovered. |
| D7 | **The by-person view and the per-member profile are one surface**, `/team/[memberId]`. Design spec §5.3 wants "pick a teammate, see their list" and §5.4 wants a profile listing their assigned tasks and active projects. One page satisfies both; two would duplicate a query and a layout. |
| D8 | **"Projects they are active on" means the distinct projects across their non-`DONE` assigned tasks.** Derived in memory from rows the page already fetched, so it costs no extra query. |
| D9 | **Quick-add is a minimal capture panel** — title and assignees — creating a personal task at `TO_DO`/`MEDIUM`, then linking to it for anything further. It introduces one modest popover, not a modal system. |
| D10 | **Leave status is omitted from the profile.** §5.4 names it, but it has no data model until the leave calendar in Phase 7, and 3a already flagged this. Inventing a schema this phase was not asked to design would be scope. |
| D11 | **A deactivated member's profile still renders**, marked "Deactivated". Their history is deliberately preserved (`TaskAssignee.user` is RESTRICT precisely for this). The Team grid simply stops linking to them, as it already does. |

---

## 4. The board

### Data

No new query. `listProjectTasks(db, projectId)` already returns every task for the project ordered `[status asc, order asc, createdAt asc]`, which is exactly a board's read shape.

The only new pure function:

```
groupTasksByStatus(rows: TaskListRow[]): Record<TaskStatus, TaskListRow[]>
```

in `src/lib/task.ts`. Every one of the four statuses is present as a key even when its column is empty, so the board never null-checks and a column can always be a drop target. Input order is preserved within each group, which is what makes the existing `[status, order, createdAt]` sort carry through untouched.

### Interaction

- The card is `draggable`. `onDragStart` puts the task id on `dataTransfer`.
- The column calls `preventDefault` on `dragOver` (without it, no drop fires) and reads the id on `drop`.
- A drop onto the card's current column is a no-op. This is cheap by construction: `setTaskStatus` already returns `ok` early when the submitted status equals the stored one, so even a redundant call writes nothing and logs nothing.
- On a real move: add the optimistic change, call `setTaskStatusAction`, and on `ok: false` surface the message **on the card that failed** — which by then has already snapped back to its original column, so the error and the card the user was dragging are in the same place. Error state is keyed by task id, matching the per-item scoping applied to the checklist in the 3a follow-up wave; a board-scoped banner would repeat the mistake that follow-up fixed, and worse here, since a board can show forty cards.

### Layout

Four columns in `TASK_STATUSES` order, each headed by its locked label and a count. An empty column renders no text but keeps a minimum height so it stays a drop target. A project with no tasks at all reuses the locked "No tasks yet." rather than inventing a second empty string.

Breadcrumb: `Clients / {client} / {project} / Board`, following 3a's rule that ancestors are names and the final segment is the literal noun of the current view. The project page links to it; the board links back through the breadcrumb.

---

## 5. Member profile

`/team/[memberId]`, fed by one new read model in `team-queries.ts`:

```
getMemberProfile(db, userId, { status }): Promise<MemberProfile | null>
```

Returns the member (name, job title, initials, active flag), their assigned tasks as `TaskListRow[]`, and the projects they are active on per D8.

**It must not write its own task query.** `listMyTasks(db, { userId, status })` already means "tasks assigned to this user, filtered by status, sorted for reading" — which is precisely what this page needs. `getMemberProfile` composes it rather than duplicating the select, the subtitle construction and the sort.

That makes the function's name wrong: it is called for someone other than the viewer. **Rename `listMyTasks` to `listAssignedTasks`** and update its two call sites and its tests. A read model whose name asserts a viewer it does not have is how a later phase ends up writing a third copy of the same query.

**Query budget: three, constant.** One `user.findUnique`, one from `listAssignedTasks` for the filtered task list, and one narrow query for the project list.

The project list gets its own query deliberately. Folding it out of the filtered task rows would have been two queries, but then filtering the page to "Done" would empty it — the member would appear active on no projects, because the fact was computed from a view. **"Projects they are active on" must not move when a view filter moves.** The dedicated query is `task.findMany` where the member is an assignee and `status` is not `DONE`, selecting only the project and client names, deduplicated in memory.

Constant-query-count is the property the anti-N+1 standard protects, and three satisfies it as well as two; correctness does not.

- Status filter reuses the `method="get"` form pattern, so it survives a reload and is shareable as a URL — identical to My Tasks and the project filters.
- An unknown id renders `notFound()`.
- Task rows reuse `<TaskRow>` unchanged. Because the viewer is not the assignee, each row keeps the client and project in its subtitle, which is `taskRowSubtitle`'s default behaviour and needs no new branch.
- Every `<MemberCard>` on `/team` becomes a link to this page.

---

## 6. Quick-add

A topbar control on every `(app)` page: a button that opens a small panel containing a title input, the active-member checkbox list, and Save.

- The active-members list is fetched once in the `(app)` layout and passed to the topbar, so no page pays for it individually.
- **The panel must submit hidden `status="TO_DO"` and `priority="MEDIUM"`.** `createTaskAction` was changed in the 3a follow-up wave to reject a missing or invalid status rather than silently defaulting; omitting these fields would surface as an unexplained "Invalid input". This is recorded here because it is self-inflicted and would otherwise cost an implementation debugging cycle.
- No project is submitted, so the result is a personal task. On success the panel closes and links to the new task, using the `{ id }` that `createTaskAction` already returns.
- Closes on Escape and on click-outside. It is a popover, not a modal: no focus trap, no backdrop, no scroll lock. That boundary is what keeps D9 from growing into an overlay system.
- The form follows the house pattern: one controlled `values` object and an `attempt` key incremented only on a rejected submit.

This is what makes §11's *"any member can assign a task to any other member in under 15 seconds from anywhere in the app"* literally true rather than true only on two pages.

---

## 7. Routes, components and vocabulary

| Route | Change |
|---|---|
| `/projects/[projectId]/board` | New — the kanban board |
| `/team/[memberId]` | New — member profile |
| `/projects/[projectId]` | Modify — link to the board |
| `/team` | Modify — cards link to profiles |
| `(app)/layout.tsx`, `topbar.tsx` | Modify — quick-add and its member list |

**Components:** `tasks/{board, board-column, board-card, quick-add}.tsx`, `team/member-profile-header.tsx`.

### Vocabulary lock additions

Exact strings. Everything from 3a's lock carries over unchanged.

- **Breadcrumbs:** `Clients / {client} / {project} / Board` · `Team / {member}`
- **Links and buttons:** "Board" (from the project page) · "Quick add" (topbar) · "Save" / "Saving…" (unchanged)
- **Empty states:** profile with no matching tasks → "Nothing assigned." (the third-person counterpart to My Tasks' "Nothing assigned to you.") · board with no tasks → "No tasks yet." (reused) · an empty column renders no text
- **Profile marker:** "Deactivated"
- **Column headers:** the four locked status labels, each with a count

Styling rules carry over unchanged: every colour is `[var(--token)]`, no `dark:` variant, no hardcoded palette colour.

---

## 8. Testing

The Phase 2/3a split holds. Pure modules and read models are TDD'd with hand-rolled closure fakes — no `vi.fn`, `vi.spyOn`, `vi.mock`, `@testing-library/react` or jsdom.

Only two functions are testable at that layer, and both must be:

1. `groupTasksByStatus` — every status key present when its column is empty; input order preserved within a group; a status the enum does not contain never appears.
2. `getMemberProfile` — the three-query budget asserted by call count; the derived project list containing each project once even when the member holds several tasks on it, excluding personal tasks, which have no project to contribute; **the project list identical under a status filter and without one**, which is the whole reason it has its own query; an unknown id returning null.

The rename of `listMyTasks` to `listAssignedTasks` is covered by its existing tests, which move with it. No behaviour changes.

Everything else — drag, the optimistic move, the rollback, the quick-add panel, the board layout — is carried by a browser QA checklist. Per §2 that checklist is this phase's primary verification, and the plan must budget for it accordingly rather than treating it as a formality. The 3a QA is the model: every line executed and its result recorded, with anything not exercised stated explicitly instead of quietly skipped.

---

## 9. Done criteria

- A project's board shows every task in four columns, and dragging a card to another column changes its status.
- The moved card appears in its new column immediately, before the server responds.
- A rejected move returns the card to its original column and shows the reason on that card.
- Dropping a card back on its own column writes nothing and logs nothing.
- Every card still offers its status select, and moving a task that way works identically.
- Each move writes exactly one correctly scoped `task.status_changed` activity row, visible on the client timeline.
- Completing a task on the board moves the project's AUTO progress, on the board's own project page, `/projects` and the client page.
- `/team/[memberId]` lists that member's tasks with a status filter that survives a reload, and the projects they are active on.
- A deactivated member's profile renders and is marked; the Team grid does not link to it.
- Quick-add creates an assigned personal task from any page, and the new task appears on its assignees' My Tasks.
- All Vitest suites pass; `npx tsc --noEmit` clean; `npm run lint` clean; `npm run build` succeeds.
- No `dark:` variant and no hardcoded palette colour anywhere in `src/`.

---

## 10. Explicitly out of scope

Reordering within a column and any persisted rank. Comments, @mentions, attachments, R2 and rich-text editing (all 3c). Notifications of any kind, including on assignment — the notification centre and Resend are Phase 4, so a task assigned through quick-add notifies nobody until then. Leave status and the leave calendar (Phase 7). Board filtering by assignee or priority; the board shows the whole project. A board for personal tasks — boards are per project, and a personal task has none. Bulk operations, task templates, and time tracking.
