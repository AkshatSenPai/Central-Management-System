# Phase 3a — Tasks & Team Visibility

**Goal:** Ship task records with universal assignment, checklists, a My Tasks view and a Team grid — so any member can assign work to anyone and the team can see who is doing what, without asking.

**Status: complete (2026-07-31).** Design approved, planned as `docs/superpowers/plans/2026-07-31-phase-3a-tasks-team.md`, implemented across twelve tasks and merged to master. Every done criterion in §8 is met, the Tasks 10–12 browser QA click-through has been executed, and all nine post-merge follow-ups are cleared — see `docs/superpowers/plans/phase-3a-followups.md`, which also records what that QA did *not* cover and the two Vocabulary Lock exceptions still to be reconciled. One issue remains open and is tracked there: next-themes emits a console error on the `notFound()` path, carried from Phase 1.

**Inputs:** spec `docs/superpowers/specs/2026-07-29-internal-cms-design.md` (§5.3, §5.4, §7, §10, §11) · Phase 2 plan `docs/superpowers/plans/2026-07-30-phase-2-clients-projects.md` (architecture, conventions, D1–D9).

---

## 1. Why Phase 3 is split

The roadmap's Phase 3 bundles subsystems that are independent of one another: task core, comments with @mentions, attachments, kanban drag-and-drop, and three read surfaces. Phase 2 took twelve tasks and thirteen commits for five models and two page-pairs; Phase 3 as written has four new models, four-plus new surfaces, a drag-and-drop interaction model, and an external storage integration. Planned as one unit it would produce a plan too large to execute reliably, and it would drag an infrastructure decision (Cloudflare R2, per spec §4) into an otherwise pure product phase.

| Slice | Delivers |
|---|---|
| **3a** (this document) | Task core, universal assignment, checklists, My Tasks, Team grid, progress-basis flip |
| **3b** | Kanban board per project, drag between columns with optimistic UI, by-person view, per-member profile page |
| **3c** | Comments with @mentions, attachments (R2 setup), rich-text editor |

3a satisfies both headline success criteria in spec §11: *"any member can assign a task to any other member in under 15 seconds"* and *"the Team page answers what is X working on in one click"*.

---

## 2. Decisions (settled — do not relitigate)

| # | Decision |
|---|---|
| D1 | **AUTO progress counts tasks when a project has any, milestones otherwise.** Preserves Phase 2's rule that a unit is "the finest-grained trackable work item the project has", and avoids regressing existing projects to `—`. Accepted wrinkle: adding a project's first task switches the basis, so progress can jump at that moment. |
| D2 | **Task description is a plain textarea in 3a.** Rich text moves to 3c, where the editor is chosen, sanitised and styled once for both descriptions and comments. |
| D3 | **Personal tasks are supported** — `Task.projectId` is nullable (spec §5.3). A personal task has no client, so its activity rows carry `clientId: null` and never appear on a client timeline. This is correct, not a defect; the Phase 2 `ActivityLog` design already allows it. |
| D4 | **Flat route `/tasks/[taskId]`**, consistent with Phase 2's D5. No `/new` or `/edit` segments — create and edit are inline forms. |
| D5 | **Team page is the member card grid only.** The per-member profile moves to 3b, next to the by-person view it overlaps with. The grid alone answers the §11 criterion. |
| D6 | **No overlay primitive.** Task creation uses inline expanding forms on `/my-tasks` and the project page. A global topbar quick-add is deliberately deferred to 3b, to be judged on real usage rather than guessed at now. |
| D7 | **`DONE` is the only status that counts as complete.** `REVIEW` is in-flight work. |
| D8 | **Assignment is a set replacement inside one transaction** — diff current against new, delete and create in a single `$transaction`, log the affected names. Structurally the same invariant-preserving move as Phase 2's `setPrimaryContact`. |
| D9 | **The progress seam uses two batched count queries folded in memory** (see §4). Rejected: a hand-written correlated sub-select (bypasses Prisma typing, hardest thing to change later) and a denormalised `progressPercent` column (a cache to invalidate on every task write, for a table that will never be large). |

---

## 3. Data model

```prisma
enum TaskStatus   { TO_DO  IN_PROGRESS  REVIEW  DONE }
enum TaskPriority { LOW  MEDIUM  HIGH  URGENT }

model Task {
  id          String       @id @default(cuid())
  title       String
  description String?
  project     Project?     @relation(fields: [projectId], references: [id])
  projectId   String?
  milestone   Milestone?   @relation(fields: [milestoneId], references: [id])
  milestoneId String?
  creator     User         @relation("TaskCreator", fields: [creatorId], references: [id])
  creatorId   String
  status      TaskStatus   @default(TO_DO)
  priority    TaskPriority @default(MEDIUM)
  dueDate     DateTime?
  order       Int
  assignees   TaskAssignee[]
  checklist   ChecklistItem[]
  createdAt   DateTime     @default(now())
  updatedAt   DateTime     @updatedAt

  @@index([projectId])
  @@index([milestoneId])
  @@index([status])
}

model TaskAssignee {
  task   Task   @relation(fields: [taskId], references: [id], onDelete: Cascade)
  taskId String
  user   User   @relation(fields: [userId], references: [id])
  userId String

  @@id([taskId, userId])
  @@index([userId])
}

model ChecklistItem {
  id        String   @id @default(cuid())
  task      Task     @relation(fields: [taskId], references: [id], onDelete: Cascade)
  taskId    String
  title     String
  done      Boolean  @default(false)
  order     Int
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([taskId])
}
```

`order` is stored but inert in 3a, exactly as `Milestone.order` is — 3b's kanban is what gives it meaning. Assigned `max + 1` on create, never a count, scoped to the task's `projectId`; personal tasks (`projectId: null`) form their own scope per creator.

`milestoneId` is only meaningful when the milestone belongs to the task's own project. The service rejects a mismatch with "That milestone belongs to a different project" rather than silently storing a cross-project link, and clearing a task's project also clears its milestone.

### Referential actions

| Relation | Rule | Reason |
|---|---|---|
| `Task.project` | SetNull | A task outlives its project, and this is what makes a nullable `projectId` coherent |
| `Task.milestone` | SetNull | Phase 2 committed to this explicitly: *"Phase 3's `Task.milestoneId` will be nullable + SetNull"* |
| `Task.creator` | RESTRICT | Members are deactivated, never deleted (§5.1); history keeps its people |
| `TaskAssignee.user` | RESTRICT | Same reason |
| `TaskAssignee.task` | Cascade | Join row, owned wholly by the task |
| `ChecklistItem.task` | Cascade | Wholly owned, referenced by nothing |

`Project.client` remains RESTRICT, so Phase 2's D7 rule — a client cannot be deleted while it has projects — is unaffected.

---

## 4. The progress seam

`getProjectProgressCounts(db, projectIds): Promise<Map<string, ProgressCounts>>` in `src/lib/project-queries.ts` keeps its signature, its batching contract and every caller. Only the body changes:

1. One grouped count over tasks for all requested ids, where completed means `status === "DONE"` and nothing else (D7 — `REVIEW` is in-flight work).
2. One count over milestones for all requested ids, where completed means `completedAt !== null`, unchanged from Phase 2.
3. Per project: if `taskTotal > 0`, use task counts; otherwise use milestone counts.

Two Phase 2 invariants must survive, and both are already covered by existing tests:

- Every requested id is seeded `{ completed: 0, total: 0 }` first, so no caller null-checks.
- AUTO with no units returns `hasUnits: false`, rendering `—` and never `0%`.

`listProjects` goes from two queries to three, still constant regardless of row count. The existing anti-N+1 test keeps its intent with the expected number updated from 2 to 3. `listClients`, `getClientDetail` and `getProjectDetail` need no changes — they all read through this one function, which is the entire point of the seam.

The empty-state affordance changes from "Add milestones or set progress manually" to **"Add tasks or set progress manually"**.

---

## 5. Modules

Pure (`src/lib/task.ts`): `TASK_STATUSES`, `TASK_PRIORITIES`, label and badge maps, `taskSchema`, `checklistItemSchema`, `isTaskOpen`, `taskListSummary`, `taskRowSubtitle`, `nextTaskOrder`. `BadgeKind` is imported from `badges.ts`; no new colour vocabulary is introduced.

Domain (`db`-injected):

| Module | Functions |
|---|---|
| `task-service.ts` | `createTask`, `updateTask`, `setTaskStatus`, `setTaskAssignees`, `removeTask` |
| `checklist-service.ts` | `addChecklistItem`, `setChecklistItemDone`, `removeChecklistItem` |
| `task-queries.ts` | `listMyTasks`, `listProjectTasks`, `getTaskDetail` |
| `team-queries.ts` | `listTeamCards` |

Modified: `project-queries.ts` (seam body), `activity.ts` (new verbs).

Actions: `src/server/actions/tasks.ts`, all `requireUser` — 3a adds no admin-gated mutation.

### The client-scope walk-up

A task knows its `projectId`, but every activity row is scoped by **client**. This is the same trap as Phase 2's milestone service: every task and checklist mutation must load the parent project selecting `clientId` and pass it to `recordActivity`. An event logged with the wrong scope never reaches the client timeline. For a personal task there is no project and `clientId: null` is correct — carried as an explicit tested case.

### New activity verbs

`task.created`, `task.updated`, `task.status_changed`, `task.assigned`, `task.unassigned`, `checklist.added`, `checklist.completed`, `checklist.removed`.

`ActivityLog.entityType` and `ActivityLog.action` are plain `String` columns specifically so this needs no migration. `describeActivity` gains a case per verb; its existing forward-compatibility test — feed it an invented verb, expect `"{actor} updated this record"` and no throw — is what makes adding verbs safe and must not be deleted.

---

## 6. Routes and UI

| Route | Change | Contents |
|---|---|---|
| `/my-tasks` | replaces `PlaceholderPage` | Tasks assigned to me; the default landing view |
| `/tasks/[taskId]` | new | Task detail |
| `/team` | replaces `PlaceholderPage` | Member card grid |
| `/projects/[projectId]` | modify | Gains a Tasks section above the milestone strip |

Breadcrumbs extend Phase 2's rule — ancestors are names, the final segment is the literal noun of the current entity:

- Project task → `Clients / {client} / {project} / Task`
- Personal task → `My Tasks / Task`

**My Tasks** lists tasks assigned to the viewer excluding `DONE`, sorted by due date (undated last) then priority, with a status filter built as a `method="get"` form — the same server-side pattern as `HealthFilter`, so the filter survives a reload and is shareable as a URL.

**Team grid** renders one card per active member: avatar, job title, open-task count (open meaning any status other than `DONE`), and their current In Progress tasks with the client and project each belongs to. Deactivated members are excluded from the grid but keep their task history, per §5.1. `listTeamCards` is held to the same anti-N+1 standard as `listProjects` — one query for members, one grouped open-task count, one for In Progress tasks with their project and client names; constant regardless of team size.

**Assignee picker** is a checkbox list of active members, not an overlay (D6). The spec sizes the team at roughly fifteen people, so a list is honest. Assignees render on rows as existing circular `InitialsAvatar`s, up to three plus `+N`.

**Components**: `tasks/{task-form, task-row, task-status-control, assignee-picker, checklist}.tsx`, `team/member-card.tsx`.

All new forms follow the house pattern established by the 2026-07-31 fix (commit `5fc2963`): values held in a single controlled state object, and the `<form>` keyed on an attempt counter incremented only on a rejected submit, so every field — including selects, which React does not restore after its post-action reset — re-reads from state.

### Vocabulary lock

Exact strings. No synonyms, no re-casing.

- **Status:** `TO_DO` → "To Do" (`neutral`) · `IN_PROGRESS` → "In Progress" (`strong`) · `REVIEW` → "Review" (`warn`) · `DONE` → "Done" (`ok`)
- **Priority:** `LOW` → "Low" (`neutral`) · `MEDIUM` → "Medium" (`neutral`) · `HIGH` → "High" (`warn`) · `URGENT` → "Urgent" (`bad`)
- **Buttons:** "New task" · "Add checklist item" · "Save" / "Saving…" · "Remove"
- **Empty states:** My Tasks "Nothing assigned to you." · project "No tasks yet." · checklist "No checklist items yet."
- **Progress affordance:** "Add tasks or set progress manually"
- **Service errors:** "Task title is required" · "Task not found" · "Project not found" · "Checklist item title is required" · "Checklist item not found" · "That milestone belongs to a different project" · "Invalid input"

A task may have no assignees. An unassigned task is a legitimate backlog item; it simply appears on its project page and on nobody's My Tasks.

Styling rules carry over from Phase 2 unchanged: every colour is `[var(--token)]`, no `dark:` variant anywhere, no hardcoded palette colour.

---

## 7. Testing

The Phase 2 split holds. Pure modules and services are TDD'd with hand-rolled closure fakes — zero `vi.fn`, `vi.spyOn`, `vi.mock`, `@testing-library/react` or jsdom. `ActionResult` failures are asserted with whole-object `toEqual` against the exact literal error strings above.

Pages, components and action wrappers stay deliberately untested; a browser QA checklist carries their verification, as it did for Phase 2. Three cases are named here because they are the ones fakes let you get wrong:

1. A milestone-style scope test proving `task.*` activity rows carry the grandparent `clientId`, and `clientId: null` for a personal task.
2. An anti-N+1 assertion on `listTeamCards` and the updated one on `listProjects`.
3. A seam test proving a project with tasks uses task counts and a project with only milestones still uses milestone counts.

---

## 8. Done criteria

- Any member can create a task and assign it to one or more people, including themselves, from `/my-tasks` or a project page.
- `/my-tasks` is the default landing view and lists the viewer's open tasks with a status filter that survives a reload.
- `/team` shows one card per active member with their open-task count and current In Progress work, naming the client and project.
- A project with tasks derives AUTO progress from tasks; a project with only milestones still derives it from milestones; a project with neither reads `—`, never `0%`.
- Completing a task visibly moves progress on the project page, the projects list and the client page.
- Every task and checklist mutation writes exactly one correctly scoped activity row, visible on the client timeline — and personal tasks write `clientId: null` and appear on no client timeline.
- Switching a project MANUAL → AUTO → MANUAL still preserves the stored manual value.
- All Vitest suites pass; `npx tsc --noEmit` clean; `npm run lint` clean; `npm run build` succeeds.
- No `dark:` variant and no hardcoded palette colour anywhere in `src/`.

---

## 9. Explicitly out of scope

Kanban and drag-and-drop, the by-person view, the per-member profile page, comments, @mentions, attachments and R2, rich-text editing, notifications, time tracking, recurring tasks, and a global topbar quick-add. Milestones are not reorderable in 3a, as they were not in Phase 2.

Leave status is named in spec §5.4's member profile but has no data model until a later phase; it is not built here and the profile page itself is 3b.
