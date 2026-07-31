# Phase 3a — Tasks & Team Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship task records with universal assignment, checklists, a My Tasks landing view and a Team grid — so any member can assign work to anyone and the team can see who is doing what, without asking.

**Architecture:** Three new Prisma models behind the same layering Phase 2 established — pure vocabulary in `src/lib/task.ts`, `db`-injected services returning `ActionResult`, read models returning plain data, thin `requireUser` actions, server-component pages. The progress seam flips from milestones to tasks-when-present in Task 2, while no surface can yet create a task, so the riskiest shared-code change is provably behaviour-preserving the day it lands.

**Tech Stack:** Next.js 16 (App Router, Server Actions) · Prisma 7 + Neon Postgres (`PrismaPg` adapter) · zod 4 · Vitest (node env, hand-rolled closure fakes) · Tailwind v4 with CSS-variable tokens.

**Inputs:** approved design `docs/superpowers/specs/2026-07-31-phase-3a-tasks-team-design.md` (D1–D9, §3 model, §5 modules, §6 vocabulary, §8 done criteria, §9 scope) · decomposition brief `.superpowers/phase-3a-intel/DECOMPOSITION.md` (R1–R36 — read it when you want the reasoning behind a decision) · format and voice `docs/superpowers/plans/2026-07-30-phase-2-clients-projects.md`.

---

## Global Constraints

- **Phase 2's Global Constraints carry over in full** — TypeScript strict; `ActionResult` from every action and service; read models (`*-queries.ts`) returning plain data or `null`, never `ActionResult`; `db`-injected logic in `src/lib/*`; activity written only in the service layer inside the mutation's transaction; `ActivityLog.entityType`/`action` as plain `String` columns; `ActivityLog.clientId` with no relation; Prisma 7's datasource in `prisma.config.ts`; Next 16's `Promise` params awaited; zod 4 idioms; `parseDateInput` as the only date parser; `[var(--token)]` colours with **no `dark:` variant** and no hardcoded palette colour; hand-rolled closure fakes with zero `vi.fn`/`vi.spyOn`/`vi.mock`.
- **Progress is computed only by `computeProgress`, fed by `getProjectProgressCounts`.** Phase 3a rewrites that provider's body and nothing else — its signature, its `Map` contract, its seed-every-requested-id invariant and every caller are unchanged. **A unit is still the finest-grained trackable work item the project has**: in 3a that is the task when a project has any, the milestone otherwise (D1). **`DONE` is the only status that counts as complete** — `REVIEW` is in-flight work (D7).
- **The client-scope walk-up is mandatory.** A task knows its `projectId`; every activity row is scoped by *client*. Every task and checklist mutation loads its scope through `loadTaskScope` / `loadChecklistScope` and passes the resolved `clientId` to `recordActivity`. **`clientId: null` for a personal task is correct, not a bug** (D3), carried as an explicit tested case on every mutation. The row is scoped to the **pre-move** client, so a cross-client project move is narrated on the timeline it is leaving.
- **Assignment is a set replacement inside one transaction** (D8) — diff current against requested, delete and create only the difference, and log at most one `task.assigned` and one `task.unassigned` row, each carrying `meta.people` as an array of **names**, never ids.
- **Setting a value to the one it already holds writes nothing at all** — no update, no activity row — and is therefore not a mutation. Un-ticking a checklist item is a real change and logs `checklist.reopened`.
- **Members are deactivated, never deleted.** A task's current assignees are always offered in the picker even when inactive, and only newly **added** ids are validated against `active: true`. Any save that silently unassigns a deactivated member is a data-loss bug.
- **Exactly two activity verbs are added beyond design §5's list — `task.removed` and `checklist.reopened` — and no others.** Both are migration-free String values the existing tested unknown-verb fallback already tolerates; both exist because §8 requires exactly one row per mutation. This is a deliberate, reviewer-visible departure from §5, not a quiet addition. **That fallback test must not be deleted or reworded.**
- **`order` is stored but inert in 3a**, exactly as `Milestone.order` was in Phase 2. Assigned `max + 1` on create, never a count, scoped to the task's `projectId` — and for a personal task, scoped to `{ projectId: null, creatorId }` so each member's backlog forms its own sequence. Reordering is 3b.
- **Every batched read is held to the `listProjects` standard:** a constant number of queries regardless of row count, asserted at two fixture sizes with a **per-delegate breakdown**, never a bare total. `listProjects` is three; `listTeamCards` is three, or one when no member is active; `listMyTasks`, `listProjectTasks` and `getTaskDetail` are one each.
- **Service test fakes must falsify a non-transactional implementation.** `$transaction`'s `tx` carries its own capture arrays; every transactional case asserts the writes and every `recordActivity` row landed there while the outer `db` arrays stayed empty. The reviewer's source read is a backstop, not the only check.
- **Roles: 3a adds no admin-gated mutation.** Every action in `src/server/actions/tasks.ts` is `requireUser` — spec §3 gives Members full task management, and the phase's headline criterion is that *any* member can assign work to *any* other.
- **One documented deviation from the FormData invariant:** the assignee list is read as `formData.getAll("userId").map(String)` because a checkbox list is inherently multi-valued. It is called out in the action file's header comment; every other read is `String(formData.get("x") ?? "")`.
- **Pages, components and action wrappers stay deliberately untested.** The Vitest environment is `node` with no jsdom and no `@testing-library/react` — do not add a harness. Their verification is the written browser QA checklist in each page task, executed line by line and recorded in the task report.
- **No later-phase scope.** If a field is not in this plan's schema it is not stored and not rendered. Specifically: no kanban, no drag-and-drop, no by-person view, no per-member profile page, no comments, no @mentions, no attachments or R2, no rich text, no notifications, no time tracking, no recurring tasks, no global topbar quick-add, and no per-entity activity timeline on task detail.
- Commands shown as `npx`/`npm` run the same in PowerShell; PowerShell-specific syntax is called out where it differs (`$env:SEED_DEMO="true"; npx prisma db seed; Remove-Item Env:SEED_DEMO`).

---

## Decisions (settled — do not relitigate)

| # | Decision |
|---|---|
| D1 | **AUTO progress counts tasks when a project has any, milestones otherwise.** Preserves "a unit is the finest-grained trackable work item"; no existing project regresses to `—`. Accepted wrinkle: a project's first task switches the basis, so progress can jump at that moment. |
| D2 | **Task description is a plain textarea.** Rich text is 3c. |
| D3 | **Personal tasks are supported** — `Task.projectId` is nullable. A personal task has no client, so its activity rows carry `clientId: null` and appear on no client timeline. |
| D4 | **Flat route `/tasks/[taskId]`**, no `/new` or `/edit` segments. |
| D5 | **`/team` is the member card grid only.** The per-member profile is 3b. |
| D6 | **No overlay primitive** — task creation is an inline expanding form. No topbar quick-add. |
| D7 | **`DONE` is the only status that counts as complete.** `REVIEW` is in-flight work. |
| D8 | **Assignment is a set replacement inside one transaction** — diff, delete and create only the difference, log the affected names. |
| D9 | **The seam uses two batched count queries folded in memory.** Rejected: a correlated sub-select (bypasses Prisma typing) and a denormalised `progressPercent` column (a cache to invalidate on every task write). |
| R1 | **The seam flip lands in Task 2**, right after the migration, while zero tasks exist — so it is provably behaviour-preserving, and Tasks 3–12 are written against a final seam. |
| R6/R16 | **One activity row per verb per call**, carrying `meta: { name, people: string[] }` of names. `createTask` logs exactly one `task.created` row even when created with assignees. |
| R8 | **A deactivated current assignee is never touched by an unrelated save** — the picker offers the union of active members and current assignees; only added ids are validated. |
| R13 | **A cross-client project move is logged under the PRE-move client** — narrated on the timeline it is leaving. A documented limitation, not a defect. |
| R14 | **The `(projectId, milestoneId)` pair is validated together**, one rule and one string. Clearing the project clears the milestone structurally. |
| R15 | **`updateTask` never changes status** — `setTaskStatus` is the sole writer, so `taskSchema` has no `status` field. |
| R25 | **The project-detail Tasks section sits above the Milestones strip**, and shows every status with DONE last. |
| R26 | **`projectRowSubtitle` keeps saying "{N} milestones".** The only vocabulary change on an existing surface is the no-units affordance string. |
| R29 | **No activity timeline on task detail** — history lives on the client timeline. |
| R30 | **`/my-tasks` becomes the landing view** via four literal string changes; `/dashboard` survives as a route and a sidebar entry. |

---

## File Structure

**Pure module** (`src/lib/`, no Prisma, no Next, no I/O — TDD'd):

| File | Responsibility |
|---|---|
| `task.ts` (create) | Status/priority vocabulary and badge maps, `taskSchema`, `checklistItemSchema`, ordering, overdue-ness, the My Tasks comparator, every summary and subtitle string, the status-filter parser. |

**Domain modules** (`src/lib/`, `db`-injected — TDD'd):

| File | Responsibility |
|---|---|
| `activity.ts` (modify) | Two new entity types, ten new verbs, `formatNameList`, ten new `describeActivity` cases. Purely additive. |
| `task-service.ts` (create) | `createTask`, `updateTask`, `setTaskStatus`, `setTaskAssignees`, `removeTask` + module-private `loadTaskScope`, `resolveAssignees`. |
| `checklist-service.ts` (create) | `addChecklistItem`, `setChecklistItemDone`, `removeChecklistItem` + module-private `loadChecklistScope`. |
| `task-queries.ts` (create) | `listMyTasks`, `listProjectTasks`, `getTaskDetail`. |
| `team-queries.ts` (create) | `listTeamCards`. |
| `project-queries.ts` (modify) | `getProjectProgressCounts` **body only** — the Phase 3 swap point. |

**Actions:** `src/server/actions/tasks.ts` (create) — eight `requireUser` wrappers.

**Components:** `src/components/tasks/{task-row,task-form,task-status-control,assignee-picker,task-status-filter,checklist}.tsx`, `src/components/team/member-card.tsx`.

**Pages:** `(app)/my-tasks/page.tsx` (modify — replaces `PlaceholderPage`), `(app)/tasks/[taskId]/page.tsx` (create), `(app)/team/page.tsx` (modify — replaces `PlaceholderPage`), `(app)/projects/[projectId]/page.tsx` (modify — Tasks section), `src/app/page.tsx` and `src/app/(auth)/login/page.tsx` (modify — landing redirect), `src/components/ui/progress-bar.tsx` (modify — one string).

`src/components/placeholder-page.tsx` stays — `/dashboard`, `/calendar`, `/invoices`, `/announcements` and `/vault` still use it.

**Schema:** `prisma/schema.prisma` (modify), one generated migration (create), `prisma/seed.ts` (modify).

---

## Vocabulary Lock

Exact strings. No synonyms, no re-casing.

- **Task status:** `TO_DO` → "To Do" (badge `neutral`) · `IN_PROGRESS` → "In Progress" (`strong`) · `REVIEW` → "Review" (`warn`) · `DONE` → "Done" (`ok`)
- **Priority:** `LOW` → "Low" (`neutral`) · `MEDIUM` → "Medium" (`neutral`) · `HIGH` → "High" (`warn`) · `URGENT` → "Urgent" (`bad`)
- **Summaries:** `taskListSummary` → "5 tasks · 2 done" / "1 task · 0 done" / "No tasks yet" · `openTaskSummary` → "3 open tasks" / "1 open task" / "No open tasks"
- **Subtitles:** `taskRowSubtitle` → "Harlow & Fitch · Brand Guidelines v3 · due 14 Aug", dropping the due clause when undated, and the single word "Personal" when there is no project or client · `taskDueLabel` → "due 14 Aug" or `""`
- **Breadcrumbs:** project task → `Clients / {client} / {project} / Task` · personal task → `My Tasks / Task`
- **Buttons:** "New task" · "Add checklist item" · "Save" / "Saving…" · "Remove"
- **Empty states:** My Tasks "Nothing assigned to you." · project "No tasks yet." · checklist "No checklist items yet."
- **Progress affordance:** "Add tasks or set progress manually" (replacing "Add milestones or set progress manually")
- **Status filter options:** "Open tasks" (value `""`) · "All statuses" (`"ALL"`) · then the four status labels
- **Service errors** (asserted verbatim in tests): `"Task title is required"` · `"Task not found"` · `"Project not found"` · `"Checklist item title is required"` · `"Checklist item not found"` · `"That milestone belongs to a different project"` · `"Invalid input"`
- **Activity sentences:** `task.created` "{who} created task {what}" · `task.updated` "{who} updated task {what}" · `task.status_changed` "{who} moved {what} to {to}" · `task.assigned` "{who} assigned {what} to {names}" · `task.unassigned` "{who} unassigned {names} from {what}" · `task.removed` "{who} removed task {what}" · `checklist.added` / `.completed` / `.reopened` / `.removed` "{who} added|completed|reopened|removed checklist item {what}"

---

### Task 1: Task, TaskAssignee and ChecklistItem schema, migration and demo seed

**Files:**
- Modify: `prisma/schema.prisma`, `prisma/seed.ts`
- Create: `prisma/migrations/<timestamp>_add_tasks_and_checklists/migration.sql` (CLI-generated, committed)
- Test: none — schema task, non-TDD, mirroring Phase 2's Task 1.

**Interfaces:**
- Consumes: Phase 2 schema style; the Prisma 7 workflow (no datasource url in `schema.prisma`; `migrate dev` then `generate`); `prisma/seed.ts`'s `dotenv` + `PrismaPg` + idempotent-guard convention.
- Produces: delegates `prisma.task`, `prisma.taskAssignee`, `prisma.checklistItem`; enum literal unions `TaskStatus` and `TaskPriority`.

- [ ] **Step 1: Append the enums and models to `prisma/schema.prisma`**

```prisma
enum TaskStatus {
  TO_DO
  IN_PROGRESS
  REVIEW
  DONE
}

enum TaskPriority {
  LOW
  MEDIUM
  HIGH
  URGENT
}

model Task {
  id          String          @id @default(cuid())
  title       String
  description String?
  project     Project?        @relation(fields: [projectId], references: [id])
  projectId   String?
  milestone   Milestone?      @relation(fields: [milestoneId], references: [id])
  milestoneId String?
  creator     User            @relation("TaskCreator", fields: [creatorId], references: [id])
  creatorId   String
  status      TaskStatus      @default(TO_DO)
  priority    TaskPriority    @default(MEDIUM)
  dueDate     DateTime?
  order       Int
  assignees   TaskAssignee[]
  checklist   ChecklistItem[]
  createdAt   DateTime        @default(now())
  updatedAt   DateTime        @updatedAt

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

Add exactly these back-relation lines — nothing else on those models changes.

On `User`, immediately after `clientsLed`:

```prisma
  tasksCreated    Task[]         @relation("TaskCreator")
  taskAssignments TaskAssignee[]
```

On `Project`, immediately after `milestones`:

```prisma
  tasks          Task[]
```

On `Milestone`, immediately after `order`:

```prisma
  tasks       Task[]
```

Referential actions — **do not "tidy" these**:

| Relation | Rule | Reason |
|---|---|---|
| `Task.project` | *(optional → SetNull)* | A task outlives its project; this is what makes a nullable `projectId` coherent. |
| `Task.milestone` | *(optional → SetNull)* | Phase 2 committed to this in writing. |
| `Task.creator` | *(required → RESTRICT)* | Members are deactivated, never deleted; history keeps its people. |
| `TaskAssignee.user` | *(required → RESTRICT)* | Same reason — and it is why `resolveAssignees` must return an error rather than let a P2003 escape. |
| `TaskAssignee.task` | `onDelete: Cascade` | Join row, wholly owned by the task. |
| `ChecklistItem.task` | `onDelete: Cascade` | Wholly owned, referenced by nothing. |

`Project.client` remains RESTRICT — Phase 2's D7 is unaffected. `ActivityLog` is untouched.

- [ ] **Step 2: Generate and apply the migration**

Run: `npx prisma migrate dev --name add_tasks_and_checklists`, then `npx prisma generate`.
Expected: exactly one new timestamped folder, applied cleanly.

- [ ] **Step 3: Read the generated SQL and confirm seven things by eye**

1. `Task_projectId_fkey` is `ON DELETE SET NULL`.
2. `Task_milestoneId_fkey` is `ON DELETE SET NULL`.
3. `Task_creatorId_fkey` and `TaskAssignee_userId_fkey` are `ON DELETE RESTRICT`.
4. `TaskAssignee_taskId_fkey` and `ChecklistItem_taskId_fkey` are `ON DELETE CASCADE`.
5. `TaskAssignee`'s primary key is the composite `(taskId, userId)` — there is no separate `id` column.
6. The two new Postgres enum types `TaskStatus` and `TaskPriority` exist.
7. `ActivityLog` is untouched — `entityType` and `action` are still `TEXT`, and `clientId` still has no FK constraint.

- [ ] **Step 4: Extend the demo seed behind the existing flag**

Inside the existing `SEED_DEMO === "true"` block, after the current projects. Do **not** edit the existing seeded projects — "Brand Guidelines v3" must stay task-free, because it is the only milestone-fallback fixture in the database.

```ts
const launch = await prisma.project.upsert({
  where: { clientId_name: { clientId: harlow.id, name: "Launch Toolkit" } },
  update: {},
  create: {
    clientId: harlow.id,
    name: "Launch Toolkit",
    description: "Everything the team needs on launch day.",
    status: "IN_PROGRESS",
    health: "ON_TRACK",
    dueDate: new Date("2026-09-12T00:00:00Z"),
  },
});

// Task has no unique column and two tasks may legitimately share a title, so
// idempotency is a count guard rather than an upsert.
if ((await prisma.task.count({ where: { projectId: launch.id } })) === 0) {
  const rows: { title: string; status: "TO_DO" | "IN_PROGRESS" | "REVIEW" | "DONE"; order: number }[] = [
    { title: "Agree the launch checklist", status: "DONE", order: 0 },
    { title: "Write the announcement post", status: "DONE", order: 1 },
    { title: "Build the landing section", status: "IN_PROGRESS", order: 2 },
    { title: "Proof the press kit", status: "REVIEW", order: 3 },
    { title: "Schedule the social queue", status: "TO_DO", order: 4 },
  ];
  for (const row of rows) {
    await prisma.task.create({
      data: {
        projectId: launch.id,
        creatorId: adminId,
        title: row.title,
        status: row.status,
        priority: "MEDIUM",
        order: row.order,
        assignees: { create: [{ userId: adminId }] },
      },
    });
  }
}

if ((await prisma.task.count({ where: { projectId: null, creatorId: adminId } })) === 0) {
  await prisma.task.create({
    data: { creatorId: adminId, title: "Review the quarterly numbers", status: "IN_PROGRESS", priority: "HIGH", order: 0,
            assignees: { create: [{ userId: adminId }] } },
  });
  await prisma.task.create({
    data: { creatorId: adminId, title: "Book the team offsite", status: "TO_DO", priority: "LOW", order: 1,
            assignees: { create: [{ userId: adminId }] } },
  });
}
```

Two of five tasks DONE puts "Launch Toolkit" at 40% on the task basis. Together with "Brand Guidelines v3" (milestone basis), "Patient Portal UX" (MANUAL 40) and "Spring Campaign Site" (neither → `—`), all four progress states appear on `/projects` at once — which is the only thing that makes the Task 2 seam QA verifiable.

- [ ] **Step 5: Verify the seed both ways**

Run: `$env:SEED_DEMO="true"; npx prisma db seed; Remove-Item Env:SEED_DEMO`
Expected: succeeds. Run it a second time — succeeds again, identical end state, no duplicate rows.

Run: `npx prisma db seed` with the flag unset.
Expected: no task rows created.

- [ ] **Step 6: Gates and commit**

Run: `npx tsc --noEmit` → exits 0. Run: `npm test` → all 268 existing tests still pass.

```bash
git add prisma/schema.prisma prisma/migrations prisma/seed.ts
git commit -m "feat: add Task, TaskAssignee and ChecklistItem schema"
```

---

### Task 2: Flip the progress seam to tasks-first, milestones-fallback (TDD)

**Files:**
- Modify: `src/lib/project-queries.ts`, `src/components/ui/progress-bar.tsx`
- Test: `tests/project-queries.test.ts` (modify), `tests/client-queries.test.ts` (modify)

**Interfaces:**
- Consumes: Task 1's `task` delegate; the existing `ProgressCounts` shape and `computeProgress`.
- Produces: `getProjectProgressCounts(db, projectIds)` — **unchanged signature, new body**.

**Before you write the test:** verify that `db.task.groupBy({ by: ["projectId", "status"], ... })` type-checks under `npx tsc --noEmit` on this Prisma 7 install. If it fights the typing, take the documented fallback — `task.findMany({ where: { projectId: { in: projectIds } }, select: { projectId: true, status: true } })` folded in memory, identical query count and identical `Map` output — and write the captured-args assertion against the shape you actually shipped. Do **not** loosen types.

- [ ] **Step 1: Extend the fake in `tests/project-queries.test.ts`**

The fake gains a `task: { groupBy }` delegate that captures its args, and a **per-delegate** call counter alongside the existing total:

```ts
function fakeDb(parts: {
  projects?: ProjectRow[];
  milestones?: MilestoneRow[];
  taskGroups?: { projectId: string | null; status: string; _count: { _all: number } }[];
  detail?: unknown;
}) {
  const byDelegate = { project: 0, task: 0, milestone: 0 };
  const findManyArgs: unknown[] = [];
  const taskGroupByArgs: unknown[] = [];

  const db = {
    project: {
      findMany: async (args: unknown) => { byDelegate.project++; findManyArgs.push(args); return parts.projects ?? []; },
      findUnique: async () => { byDelegate.project++; return parts.detail ?? null; },
    },
    task: {
      groupBy: async (args: unknown) => { byDelegate.task++; taskGroupByArgs.push(args); return parts.taskGroups ?? []; },
    },
    milestone: {
      findMany: async () => { byDelegate.milestone++; return parts.milestones ?? []; },
    },
  } as unknown as PrismaClient;

  const calls = () => byDelegate.project + byDelegate.task + byDelegate.milestone;
  return { db, calls, callsByDelegate: () => ({ ...byDelegate }), findManyArgs, taskGroupByArgs };
}
```

- [ ] **Step 2: Write the failing `getProjectProgressCounts` cases (8)**

- *returns an empty Map and issues no db calls for an empty id list* — unchanged: `counts.size` is 0, `calls()` is 0.
- *asks only for the requested projects* — captured `task.groupBy` args `toEqual({ by: ["projectId", "status"], where: { projectId: { in: ["p1", "p2"] } }, _count: { _all: true } })`. **Without this, an implementation that omits the `where` — grouping every task row in the database on every render — passes every other case and the call count too.**
- *uses task counts for a project that has tasks and ignores its milestones* — p1 groups `[DONE×1, TO_DO×1, IN_PROGRESS×1, REVIEW×1]` alongside two completed milestones → `counts.get("p1")` `toEqual({ completed: 1, total: 4 })`.
- *counts only DONE as complete, never REVIEW* — p1 groups `[REVIEW×2]` → `toEqual({ completed: 0, total: 2 })` (D7).
- *falls back to milestone counts for a project with no tasks* — p2 has no task groups, milestones `[completedAt set, completedAt null]` → `toEqual({ completed: 1, total: 2 })`.
- *computes both bases in the same result set* — p1 task-based, p2 milestone-based, p3 with neither → `counts.get("p3")` `toEqual({ completed: 0, total: 0 })`.
- *still seeds every requested id* even when it appears in neither query result.
- *ignores a grouped row whose projectId is null* — a personal-task group leaks into the fake's return and no Map entry is created or incremented for it.

- [ ] **Step 3: Replace the anti-N+1 case and add the basis case in `describe("listProjects")`**

Delete `it("issues exactly two db calls regardless of row count")` with its `expect(calls()).toBe(2)`, and replace it with:

```ts
it("issues exactly three db calls regardless of row count", async () => {
  const many = fakeDb({
    projects: [projectRow({ id: "p1" }), projectRow({ id: "p2" }), projectRow({ id: "p3" }), projectRow({ id: "p4" }), projectRow({ id: "p5" })],
  });
  await listProjects(many.db);
  expect(many.callsByDelegate()).toEqual({ project: 1, task: 1, milestone: 1 });

  const one = fakeDb({ projects: [projectRow({ id: "p1" })] });
  await listProjects(one.db);
  expect(one.callsByDelegate()).toEqual({ project: 1, task: 1, milestone: 1 });
});
```

This is strictly stronger than the original: a bare total of three could be satisfied by three project queries, and one fixture size proves nothing about N+1.

Add one case: *a project with its first task reads the task basis on the list* — one project, 1 of 2 tasks DONE and 2 of 2 milestones complete → `rows[0].progress` `toEqual({ percent: 50, mode: "AUTO", hasUnits: true, label: "50%" })`.

Every other existing case passes unchanged with only the fake extended.

- [ ] **Step 4: Extend the `tests/client-queries.test.ts` fake**

Add a stub for whichever task delegate you shipped in Step 6 — `task: { groupBy: async () => [] }`, or `task: { findMany: async () => [] }` if you took the documented fallback — because `getClientDetail` reaches the seam through `listProjects`. Its existing cases pass unchanged; change no assertion in that file.

- [ ] **Step 5: Run the tests to verify they fail**

Run: `npm test`
Expected: the new `getProjectProgressCounts` cases fail (task counts ignored), and the three-call case fails asserting `{ project: 1, task: 0, milestone: 1 }`.

- [ ] **Step 6: Implement the new body**

Replace the body of `getProjectProgressCounts` — signature, `Map` return, empty-ids short-circuit and every caller stay exactly as they are; update the doc comment to say the swap has happened.

```ts
export async function getProjectProgressCounts(
  db: PrismaClient,
  projectIds: string[]
): Promise<Map<string, ProgressCounts>> {
  const counts = new Map<string, ProgressCounts>();
  if (projectIds.length === 0) return counts;

  // Invariant 1: every requested id is present, so no caller null-checks.
  for (const id of projectIds) counts.set(id, { completed: 0, total: 0 });

  // D1: tasks are the finest-grained unit when a project has any. One grouped
  // count, constant regardless of row count.
  const taskGroups = await db.task.groupBy({
    by: ["projectId", "status"],
    where: { projectId: { in: projectIds } },
    _count: { _all: true },
  });

  const taskCounts = new Map<string, ProgressCounts>();
  for (const g of taskGroups) {
    // Prisma types a nullable grouping key as string | null. The where clause
    // excludes personal tasks, but a stray null must never land in a project's
    // bucket — a mis-bucketed row is a wrong percentage with no error anywhere.
    if (g.projectId === null) continue;
    const entry = taskCounts.get(g.projectId) ?? { completed: 0, total: 0 };
    entry.total += g._count._all;
    if (g.status === "DONE") entry.completed += g._count._all; // D7: REVIEW is in flight
    taskCounts.set(g.projectId, entry);
  }

  // Unchanged from Phase 2, byte for byte.
  const milestones = await db.milestone.findMany({
    where: { projectId: { in: projectIds } },
    select: { projectId: true, completedAt: true },
  });

  const milestoneCounts = new Map<string, ProgressCounts>();
  for (const m of milestones) {
    const entry = milestoneCounts.get(m.projectId) ?? { completed: 0, total: 0 };
    entry.total += 1;
    if (m.completedAt !== null) entry.completed += 1;
    milestoneCounts.set(m.projectId, entry);
  }

  for (const id of projectIds) {
    const tasks = taskCounts.get(id);
    if (tasks && tasks.total > 0) {
      counts.set(id, tasks);
      continue;
    }
    const ms = milestoneCounts.get(id);
    if (ms) counts.set(id, ms);
    // else: the seeded { completed: 0, total: 0 } stands — invariant 2.
  }

  return counts;
}
```

Both queries run unconditionally, so the call count is deterministic at three regardless of data shape.

- [ ] **Step 7: Change the one affordance string**

In `src/components/ui/progress-bar.tsx`: "Add milestones or set progress manually" → **"Add tasks or set progress manually"**. `computeProgress` in `src/lib/progress.ts` is **not** touched — a project with neither tasks nor milestones still reaches it with `{ completed: 0, total: 0 }` and still renders `—`.

- [ ] **Step 8: Run the tests, gates and commit**

Run: `npm test` → green. `npx tsc --noEmit` → exits 0. `npm run lint` → clean.
Run: `grep -rn "Add milestones or set progress manually" src/` → no matches.

```bash
git add src/lib/project-queries.ts src/components/ui/progress-bar.tsx tests/project-queries.test.ts tests/client-queries.test.ts
git commit -m "feat: count tasks first and milestones as fallback for AUTO progress"
```

---

### Task 3: Pure task vocabulary, schemas, comparator and the ten activity verbs (TDD)

**Files:**
- Create: `src/lib/task.ts`, `tests/task.test.ts`
- Modify: `src/lib/activity.ts`, `tests/activity.test.ts`

**Interfaces:**
- Consumes: `BadgeKind` from `src/lib/badges.ts` (the single declaration in the repo); `shortDate` and `isOverdue` from `src/lib/dates.ts`; the zod 4 idioms in `src/lib/project.ts`; `parseStatusFilter` as the exact template for `parseTaskStatusFilter`; `activity.ts`'s existing `metaString`, `subject`, `humanizeEnum` and default branch.
- Produces:

```ts
// src/lib/task.ts
export const TASK_STATUSES: readonly ["TO_DO", "IN_PROGRESS", "REVIEW", "DONE"];
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TASK_STATUS_LABEL: Record<TaskStatus, string>;
export const TASK_STATUS_BADGE: Record<TaskStatus, BadgeKind>;
export const TASK_PRIORITIES: readonly ["LOW", "MEDIUM", "HIGH", "URGENT"];
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export const TASK_PRIORITY_LABEL: Record<TaskPriority, string>;
export const TASK_PRIORITY_BADGE: Record<TaskPriority, BadgeKind>;
export const TASK_PRIORITY_RANK: Record<TaskPriority, number>;   // URGENT 0 … LOW 3
export const taskSchema;          export type TaskInput = z.infer<typeof taskSchema>;
export const checklistItemSchema; export type ChecklistItemInput = z.infer<typeof checklistItemSchema>;
export function isTaskOpen(status: TaskStatus): boolean;
export function isTaskOverdue(t: { dueDate: Date | null; status: TaskStatus }, now?: Date): boolean;
export function nextTaskOrder(existing: { order: number }[]): number;
export function taskListSummary(rows: { status: string }[]): string;
export function taskRowSubtitle(input: { clientName: string | null; projectName: string | null; dueDate: Date | null }): string;
export function taskDueLabel(dueDate: Date | null): string;
export function openTaskSummary(count: number): string;
export function capAssignees<T>(list: T[], max?: number): { shown: T[]; extra: number };
export type TaskSortable = { dueDate: Date | null; priority: TaskPriority };
export function compareMyTasks(a: TaskSortable, b: TaskSortable): number;
export function sortMyTasks<T extends TaskSortable>(rows: T[]): T[];
export type TaskStatusFilter = TaskStatus | "ALL";
export function parseTaskStatusFilter(raw: string | string[] | undefined): TaskStatusFilter | null;

// src/lib/activity.ts — additive only
export function formatNameList(names: string[]): string;   // "" | "A" | "A and B" | "A, B and C"
```

`taskSchema` — note there is deliberately **no `status` field** (R15):

```ts
export const taskSchema = z.object({
  title: z.string().trim().min(1, "Task title is required").max(200),
  description: z.string().trim().max(4000).optional().or(z.literal("")),
  projectId: z.string().trim().optional().or(z.literal("")),
  milestoneId: z.string().trim().optional().or(z.literal("")),
  priority: z.enum(TASK_PRIORITIES),
  dueDate: z.string().trim().optional().or(z.literal("")),
});

export const checklistItemSchema = z.object({
  title: z.string().trim().min(1, "Checklist item title is required").max(200),
});
```

- [ ] **Step 1: Write `tests/task.test.ts`**

`describe("taskSchema")` — *rejects a blank title* (`"Task title is required"`); *trims the title* (`"  Ship the deck "` → `"Ship the deck"`); *rejects a title over 200 characters*; *accepts an empty description, due date, project and milestone*; *rejects an unknown priority*.
`describe("checklistItemSchema")` — *rejects a blank title* (`"Checklist item title is required"`); *trims the title*.
Vocabulary — *labels statuses To Do, In Progress, Review and Done* (whole-object `toEqual` on `TASK_STATUS_LABEL`); *maps TO_DO, IN_PROGRESS, REVIEW and DONE to the neutral, strong, warn and ok badge kinds*; *labels priorities Low, Medium, High and Urgent*; *maps them to neutral, neutral, warn and bad*.
`describe("isTaskOpen")` — *is false only for DONE and true for REVIEW* (pins D7).
`describe("isTaskOverdue")` — *is false when there is no due date*; *is true for a past due date on an open task*; *is false for a past due date on a DONE task*.
`describe("nextTaskOrder")` — *is 0 for an empty list*; *is one more than the highest order, never the count* (`[{order:0},{order:5},{order:2}]` → 6).
`describe("taskListSummary")` — *reads "5 tasks · 2 done"*; *reads "1 task · 0 done"*; *reads "No tasks yet" for an empty list*.
`describe("taskRowSubtitle")` — *reads "Harlow & Fitch · Brand Guidelines v3 · due 14 Aug"*; *drops the due clause when there is no due date*; *reads "Personal · due 14 Aug" for a task with no project or client*; *reads "Personal" for an undated personal task*.
`describe("taskDueLabel")` — *reads "due 14 Aug"*; *returns an empty string for no due date*.
`describe("openTaskSummary")` — *reads "3 open tasks", "1 open task" and "No open tasks"*.
`describe("compareMyTasks")` — *puts an earlier due date before a later one*; *puts every undated task after every dated task*; *orders URGENT, HIGH, MEDIUM then LOW when the due dates are equal*; *orders two undated tasks by priority*; *treats the due date as dominant over priority* (a LOW due today precedes an URGENT due next week); *returns 0 for an equal due date and priority*.
`describe("sortMyTasks")` — *sorts a mixed six-task fixture into the exact expected id order* (`toEqual` on mapped ids); *keeps input order for two tasks with the same due date and priority*, proving stability; *does not mutate the input array*.
`describe("capAssignees")` — *shows all of two and reports no overflow*; *shows three and reports no overflow*; *shows three of five and reports an overflow of two*; *returns an empty list and no overflow for nobody*.
`describe("parseTaskStatusFilter")` — *maps "IN_PROGRESS" to IN_PROGRESS*; *maps "ALL" to "ALL"*; *maps undefined to null*; *maps an unrecognised value to null rather than throwing*; *takes the first entry of an array-valued searchParam*.

- [ ] **Step 2: Write the additive `tests/activity.test.ts` cases**

`describe("formatNameList")` — *returns an empty string for nobody*; *returns the single name for one*; *joins two with " and "* (`"Tom Iversen and Dana Reeve"`); *joins three as "A, B and C"*.
`describe("describeActivity")` additions — *describes a created task* → `"Sarah Whitfield created task Ship the deck"`; *describes an updated task*; *describes a task status change using the locked labels* (meta `{ name, from: "TO_DO", to: "IN_PROGRESS" }` → `"Sarah Whitfield moved Ship the deck to In Progress"`); *describes an assignment naming everyone affected* (meta `{ name: "Ship the deck", people: ["Tom Iversen", "Dana Reeve"] }` → `"Sarah Whitfield assigned Ship the deck to Tom Iversen and Dana Reeve"`); *describes an unassignment* → `"Sarah Whitfield unassigned Tom Iversen from Ship the deck"`; *falls back to a generic task sentence when the people list is missing or is not an array of strings*, returning `"Sarah Whitfield updated task Ship the deck"` and not throwing, because `meta` comes back as `Prisma.JsonValue`; *describes a removed task*; *describes an added, completed, reopened and removed checklist item*.

**The existing invented-verb case stays exactly as it is** — still returns `"Sarah Whitfield updated this record"` without throwing. Do not delete or reword it; it is what makes adding verbs safe in every later phase.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test` → FAIL with "Cannot find module '@/lib/task'" plus the new activity cases.

- [ ] **Step 4: Implement `src/lib/task.ts` and extend `src/lib/activity.ts`**

`compareMyTasks`: a dated task always precedes an undated one; two dated tasks compare by timestamp ascending; ties and two undated tasks fall through to `TASK_PRIORITY_RANK`; a full tie returns 0 so `Array.prototype.sort`'s stability preserves the query's order. `sortMyTasks` copies before sorting.

In `activity.ts`: widen `ActivityEntityType` with `"TASK" | "CHECKLIST_ITEM"`, append the ten verbs to `ActivityAction`, add `formatNameList` plus a module-private `metaNames(meta, key): string[] | null` that returns `null` unless the value is an array of strings, and add the ten `describeActivity` cases from the Vocabulary Lock. The assignment cases fall back to `{who} updated task {what}` when `metaNames` returns `null`.

- [ ] **Step 5: Run the tests to verify they pass, then commit**

Run: `npm test` → green, with the existing 13 activity cases unchanged. `npx tsc --noEmit` → exits 0.

```bash
git add src/lib/task.ts src/lib/activity.ts tests/task.test.ts tests/activity.test.ts
git commit -m "feat: task vocabulary, schemas, comparator and activity verbs"
```

---

### Task 4: Task service core — create, update, status and remove (TDD)

**Files:**
- Create: `src/lib/task-service.ts`, `tests/task-service.test.ts`

**Interfaces:**
- Consumes: Task 1's `task`/`taskAssignee` delegates; Task 3's `nextTaskOrder`, `TaskStatus`, `TaskPriority`; `recordActivity` and `fieldDiff` (always passed the `tx`); `ok`/`err`/`ActionResult`; `src/lib/milestone-service.ts`'s walk-up and no-op-when-unchanged patterns.
- Produces:

```ts
export type TaskWriteInput = {
  title: string;
  description: string | null;
  projectId: string | null;
  milestoneId: string | null;
  priority: TaskPriority;
  dueDate: Date | null;
};

export async function createTask(db: PrismaClient, input: TaskWriteInput & { status: TaskStatus; assigneeIds: string[]; actorId: string }): Promise<ActionResult<{ id: string }>>;
export async function updateTask(db: PrismaClient, input: TaskWriteInput & { taskId: string; actorId: string }): Promise<ActionResult>;
export async function setTaskStatus(db: PrismaClient, input: { taskId: string; status: TaskStatus; actorId: string }): Promise<ActionResult>;
export async function removeTask(db: PrismaClient, input: { taskId: string; actorId: string }): Promise<ActionResult>;

// module-private, both reused by Task 5
async function loadTaskScope(db: PrismaClient, taskId: string): Promise<{ ok: false } | { ok: true; task: {...}; clientId: string | null }>;
async function resolveAssignees(db: PrismaClient, ids: string[]): Promise<{ id: string; name: string }[] | null>;
```

- [ ] **Step 1: Write the fake with separate transaction capture arrays**

This shape is what makes a non-transactional implementation fail instead of pass. Reads are shared; **writes go to the sink they were called on**.

```ts
function fakeDb(parts: FakeParts) {
  const dbW = { created: [] as Record<string, unknown>[], updated: [] as Record<string, unknown>[],
                deleted: [] as unknown[], activity: [] as Record<string, unknown>[] };
  const txW = { created: [] as Record<string, unknown>[], updated: [] as Record<string, unknown>[],
                deleted: [] as unknown[], activity: [] as Record<string, unknown>[] };
  // Reads are shared between db and tx, and each captures its args so the
  // scoping assertions can read them. Exactly these delegates are needed:
  //   task.findUnique      -> parts.task ?? null              (loadTaskScope)
  //   task.findMany        -> parts.siblings ?? []            (the order query; capture `where`)
  //   project.findUnique   -> parts.project ?? null           (createTask's parent lookup)
  //   milestone.findUnique -> parts.milestone ?? null         (the pair rule)
  //   user.findMany        -> parts.activeUsers ?? []         (resolveAssignees; capture `where`)
  //   taskAssignee.findMany-> parts.currentAssignees ?? []    (Task 5's diff)
  // Writers are per-sink: task.create, task.update, task.delete,
  // taskAssignee.createMany, taskAssignee.deleteMany, activityLog.create —
  // each pushing { args } into the sink it was called on.
  const writers = (sink: typeof dbW) => ({ /* the six writers above, writing into `sink` */ });
  const db = {
    ...reads,
    ...writers(dbW),
    activityLog: { create: log(dbW) },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ ...reads, ...writers(txW), activityLog: { create: log(txW) } }),
  } as unknown as PrismaClient;
  return { db, dbW, txW, calls, args };
}
```

- [ ] **Step 2: Write the failing `describe("createTask")` cases (18)**

*rejects a blank title* (`"Task title is required"`); *errors on an unknown project* (`"Project not found"`); *scopes the sibling order query to the project* — captured `where` `toEqual({ projectId: "p1" })`; *scopes the sibling order query to the creator's own personal tasks when there is no project* — captured `where` `toEqual({ projectId: null, creatorId: "u1" })`; *writes order 0 for the first task in its scope*; *writes one more than the highest existing order* (siblings `[{ order: 4 }]` → captured `order` is 5, proving `nextTaskOrder` rather than a count); *stores the creator as the actor*; *logs task.created carrying the grandparent clientId* (`"c1"`); *logs a personal task with a null client scope and issues no project query at all* (captured `clientId` is exactly `null`, and the counter shows no `project.findUnique`); *logs exactly one activity row even when created with assignees* (`txW.activity` length 1, `action: "task.created"` — R16); *creates one TaskAssignee row per assignee inside the same transaction as the task and its activity row* (all in `txW`, `dbW` empty); *passes skipDuplicates on the assignee insert*; *rejects an unknown or deactivated assignee id* (`"Invalid input"`, asserting no task and no join rows were written); *asks only for active users when resolving assignees* — captured `user.findMany` `where` `toEqual({ id: { in: ["u2"] }, active: true })`; *rejects a milestone belonging to a different project* (`"That milestone belongs to a different project"`); *rejects an unknown milestone with the same message*; *rejects a milestone supplied for a task with no project, with the same message*; *accepts a milestone belonging to the task's own project*.

- [ ] **Step 3: Write the failing `describe("updateTask")` cases (9)**

*errors on an unknown task* (`"Task not found"`); *writes no activity when nothing changed*; *logs task.updated with the changed fields in meta*; *clearing the project clears the milestone in the same write* (captured update data matches `{ projectId: null, milestoneId: null }`, and no milestone lookup was issued); *rejects moving a task to another project while it still carries the old project's milestone*; *rejects clearing the project while still carrying a milestone id*; *a cross-client project move logs task.updated under the OLD client's id* (pre-move project belongs to `c1`, new project to `c2`, captured `clientId` is `"c1"` — R13); *clearing the project to personal logs task.updated under the old client's id*; *never writes order, creatorId, status or the assignee set* (the captured update data has none of those keys).

- [ ] **Step 4: Write the failing `setTaskStatus` (4) and `removeTask` (3) cases**

`setTaskStatus` — *writes nothing at all when the status is unchanged*; *logs task.status_changed with from and to in meta and the grandparent clientId*; *logs a personal task's status change with a null client scope*; *writes the update and the activity row inside the transaction* (`txW` populated, `dbW` empty).
`removeTask` — *errors on an unknown task* (`"Task not found"`); *deletes the task and logs task.removed with the title captured before the delete*; *relies on the Cascade for its assignees and checklist* (no manual join-row or checklist deletes issued).

- [ ] **Step 5: Run the tests to verify they fail**

Run: `npm test` → FAIL with "Cannot find module '@/lib/task-service'".

- [ ] **Step 6: Implement `src/lib/task-service.ts`**

`loadTaskScope` does the walk-up in **one** query by selecting through the nullable relation:

```ts
const task = await db.task.findUnique({
  where: { id: taskId },
  select: {
    id: true, title: true, description: true, projectId: true, milestoneId: true,
    status: true, priority: true, dueDate: true,
    project: { select: { clientId: true } },
  },
});
if (!task) return { ok: false };
return { ok: true, task, clientId: task.project?.clientId ?? null };
```

`resolveAssignees` de-duplicates, issues `user.findMany({ where: { id: { in: ids }, active: true }, select: { id: true, name: true } })`, and returns `null` when fewer rows come back than distinct ids requested — both writers map that to `err("Invalid input")` with no write issued.

The `(projectId, milestoneId)` pair is validated together, one rule and one string: a milestone with no project → error; a milestone that is missing or belongs to another project → the same error; no milestone → nothing to check. Every mutation writes its row **and** its `recordActivity` call inside one `db.$transaction(async (tx) => …)`, passing `tx`.

- [ ] **Step 7: Run the tests to verify they pass, then commit**

Run: `npm test` → green. `npx tsc --noEmit` → exits 0.

```bash
git add src/lib/task-service.ts tests/task-service.test.ts
git commit -m "feat: task service with client-scope walk-up and scoped ordering"
```

---

### Task 5: `setTaskAssignees` as a set replacement in one transaction (TDD)

**Files:**
- Modify: `src/lib/task-service.ts`, `tests/task-service.test.ts`

**Interfaces:**
- Consumes: Task 4's `loadTaskScope` and `resolveAssignees`; Task 3's `task.assigned`/`task.unassigned` verbs and the `{ name, people }` meta shape; `setPrimaryContact` in `src/lib/contact-service.ts` as the interactive-transaction precedent.
- Produces: `setTaskAssignees(db, { taskId, userIds, actorId }): Promise<ActionResult>`.

- [ ] **Step 1: Write the failing cases (18)**

*errors on an unknown task* (`"Task not found"`); *deletes only the departed and creates only the newcomers* — current `[u1, u2]`, requested `[u2, u3]` → captured `deleteMany` `where` `toEqual({ taskId: "t1", userId: { in: ["u1"] } })` and captured `createMany` `data` `toEqual([{ taskId: "t1", userId: "u3" }])`, with u2 neither deleted nor recreated; *never issues a blanket delete of every assignee row* (no captured delete `where` equals `{ taskId: "t1" }` alone); *writes nothing at all when the requested set matches the current one* (requested `[u2, u1]` against current `[u1, u2]` → no delete, no create, no activity row); *de-duplicates repeated ids in the input*; *logs exactly one task.assigned row naming everyone added* — captured meta `toEqual({ name: "Ship the deck", people: ["Dana Reeve"] })`; *logs exactly one task.unassigned row naming everyone removed*, and a mixed add-and-remove produces exactly two activity rows; *stores names rather than ids in meta*; *resolves removed names from the current rows, not from an active-user lookup* (the captured `user.findMany` `where` contains only the ADDED ids); ***leaves a deactivated current assignee alone*** — current `[u1 (inactive), u2]`, requested `[u1, u2]` → no delete, no create, no activity row, and `u1` never reaches `resolveAssignees`; *rejects an unknown or deactivated NEW id* (`"Invalid input"`, asserting no delete and no create were issued); *asks only for active users when resolving additions*; *assigning everybody to an unassigned task creates every join row and logs one task.assigned*; *clearing every assignee is legitimate* (requested `[]` deletes both and logs one `task.unassigned` naming both); *logs the grandparent clientId for a project task and null for a personal task*; *passes skipDuplicates on the insert*; *maps a concurrent P2002 to a clean success* (the fake's `createMany` throws a real `Prisma.PrismaClientKnownRequestError` with `code: "P2002"`; the result is `toEqual({ ok: true, data: undefined })` and nothing throws); ***every write and both activity rows land inside the transaction*** (`txW.deleted`, `txW.created` and `txW.activity` populated, every `dbW` array empty).

**The deactivated-assignee case is the blocker case.** Without it, an unrelated save silently unassigns someone — data loss produced by an edit that had nothing to do with them.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test` → FAIL with "setTaskAssignees is not a function".

- [ ] **Step 3: Implement `setTaskAssignees`**

Load the current rows *with their names*, diff, and write only the difference inside one interactive `$transaction` — never a blanket delete:

```
scope   = loadTaskScope(db, taskId)                    // missing -> err("Task not found")
current = db.taskAssignee.findMany({ where: { taskId }, select: { userId: true, user: { select: { name: true } } } })
requested  = unique(input.userIds)
addedIds   = requested \ current.userIds
removedIds = current.userIds \ requested
if (addedIds.length === 0 && removedIds.length === 0) return ok(undefined)   // no write, no activity
added        = addedIds.length ? resolveAssignees(db, addedIds) : []          // null -> err("Invalid input")
removedNames = current.filter(c => removedIds.includes(c.userId)).map(c => c.user.name)
db.$transaction(async (tx) => {
  if (removedIds.length) tx.taskAssignee.deleteMany({ where: { taskId, userId: { in: removedIds } } })
  if (addedIds.length)   tx.taskAssignee.createMany({ data: addedIds.map(userId => ({ taskId, userId })), skipDuplicates: true })
  if (addedIds.length)   recordActivity(tx, { action: "task.assigned",   clientId: scope.clientId, meta: { name: scope.task.title, people: added.map(a => a.name) } })
  if (removedIds.length) recordActivity(tx, { action: "task.unassigned", clientId: scope.clientId, meta: { name: scope.task.title, people: removedNames } })
})
```

The add side resolves through `resolveAssignees` (which filters `active: true`); the remove side reads names off the already-loaded current rows. That asymmetry is exactly what leaves an inactive current assignee untouched. Catch a `P2002` from the `createMany` and return `ok(undefined)`.

- [ ] **Step 4: Run the tests to verify they pass, then commit**

Run: `npm test` → green. `npx tsc --noEmit` → exits 0.

> **Reviewer check, stated explicitly:** the `txW`/`dbW` split falsifies a non-transactional implementation, but read the source anyway and confirm both writes and both `recordActivity` calls sit inside `db.$transaction(async (tx) => …)` and receive `tx`, not `db`.

```bash
git add src/lib/task-service.ts tests/task-service.test.ts
git commit -m "feat: universal assignment as a transactional set replacement"
```

---

### Task 6: Checklist service (TDD)

**Files:**
- Create: `src/lib/checklist-service.ts`, `tests/checklist-service.test.ts`

**Interfaces:**
- Consumes: Task 1's `checklistItem` delegate; Task 3's `nextTaskOrder` (one rule, two callers) and the four `checklist.*` verbs; `recordActivity` passed the `tx`; `setMilestoneComplete` as the no-op-when-unchanged precedent.
- Produces:

```ts
export async function addChecklistItem(db: PrismaClient, input: { taskId: string; title: string; actorId: string }): Promise<ActionResult<{ id: string }>>;
export async function setChecklistItemDone(db: PrismaClient, input: { itemId: string; done: boolean; actorId: string }): Promise<ActionResult>;
export async function removeChecklistItem(db: PrismaClient, input: { itemId: string; actorId: string }): Promise<ActionResult>;

// module-private
async function loadChecklistScope(db: PrismaClient, itemId: string): Promise<{ ok: false } | { ok: true; item: {...}; taskId: string; clientId: string | null }>;
```

`loadChecklistScope` is `loadTaskScope` one level deeper — a single query selecting `task: { select: { id, title, project: { select: { clientId: true } } } }`, with `clientId = item.task.project?.clientId ?? null`.

- [ ] **Step 1: Write the failing cases (15), reusing Task 4's `txW`/`dbW` fake shape**

`describe("addChecklistItem")` — *errors on an unknown task* (`"Task not found"`); *rejects a blank title* (`"Checklist item title is required"`); *scopes the sibling order query to the task* (captured `where` `toEqual({ taskId: "t1" })`); *writes order 0 for a task's first item and one more than the highest existing order otherwise* (siblings `[{ order: 2 }]` → captured `order` is 3, reusing `nextTaskOrder`); *logs checklist.added carrying the great-grandparent clientId* (`"c1"`); *logs an item on a personal task with a null client scope* (captured `clientId` exactly `null`); *writes the item and its activity row inside the transaction* (`txW` populated, `dbW` empty).

`describe("setChecklistItemDone")` — *errors on an unknown item* (`"Checklist item not found"`); *ticking writes done true and logs checklist.completed with the item title in meta*; *unticking writes done false and logs checklist.reopened*; *writes nothing at all when done already holds the requested value*, asserted in both directions; *carries the client scope on the row it writes*.

`describe("removeChecklistItem")` — *errors on an unknown item* (`"Checklist item not found"`); *deletes it and logs checklist.removed with the title captured before the delete*; *carries the client scope on the removal row*.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test` → FAIL with "Cannot find module '@/lib/checklist-service'".

- [ ] **Step 3: Implement, then run the tests to verify they pass**

Run: `npm test` → green. `npx tsc --noEmit` → exits 0.

- [ ] **Step 4: Commit**

```bash
git add src/lib/checklist-service.ts tests/checklist-service.test.ts
git commit -m "feat: checklist service with two-level client scope walk-up"
```

---

### Task 7: Task read models — My Tasks, project tasks and task detail (TDD)

**Files:**
- Create: `src/lib/task-queries.ts`, `tests/task-queries.test.ts`

**Interfaces:**
- Consumes: Task 3's `sortMyTasks`, `taskRowSubtitle`, `taskDueLabel`, `isTaskOverdue`, `TaskStatusFilter`; `clientInitials` from `src/lib/client.ts` (already the repo's people-initials helper); `listProjects` as the read-model shape and `tests/project-queries.test.ts` as the call-counting fake style.
- Produces:

```ts
export type TaskListRow = {
  id: string; title: string;
  status: TaskStatus; priority: TaskPriority;
  dueDate: Date | null; overdue: boolean;
  projectId: string | null; projectName: string | null;
  clientId: string | null; clientName: string | null;
  subtitle: string;
  assignees: Array<{ id: string; name: string; initials: string }>;
};
export async function listMyTasks(db: PrismaClient, input: { userId: string; status?: TaskStatusFilter | null }): Promise<TaskListRow[]>;
export async function listProjectTasks(db: PrismaClient, projectId: string): Promise<TaskListRow[]>;

export type TaskDetail = {
  id: string; title: string; description: string | null;
  status: TaskStatus; priority: TaskPriority; dueDate: Date | null; overdue: boolean;
  projectId: string | null; projectName: string | null;
  clientId: string | null; clientName: string | null;
  milestoneId: string | null; milestoneTitle: string | null;
  creator: { id: string; name: string };
  assignees: Array<{ id: string; name: string; initials: string }>;
  checklist: Array<{ id: string; title: string; done: boolean; order: number }>;
  checklistDone: number; checklistTotal: number;
};
export async function getTaskDetail(db: PrismaClient, taskId: string): Promise<TaskDetail | null>;
```

Read models return plain data or `null`, **never `ActionResult`**.

- [ ] **Step 1: Write the failing `describe("listMyTasks")` cases (11)**

*returns only tasks assigned to the viewer* — captured `where.assignees` `toEqual({ some: { userId: "u1" } })`; *excludes DONE by default* — captured `where.status` `toEqual({ not: "DONE" })`; *drops the status constraint entirely when asked for ALL*; *filters to a single status when given one, including DONE*; *orders the query by createdAt ascending so the stable sort has a deterministic input* — captured `orderBy` `toEqual({ createdAt: "asc" })`; *sorts by due date with undated last, then priority* (a mixed fixture returns the exact expected id order); *issues exactly one db call regardless of row count*, asserted with 3 rows and again with 9; *carries a subtitle naming the client and project* (`"Harlow & Fitch · Brand Guidelines v3 · due 14 Aug"`); *carries "Personal" for a task with no project* (subtitle `"Personal · due 14 Aug"`, with `projectId`, `projectName`, `clientId` and `clientName` all null); *carries every assignee with initials* (`toEqual([{ id: "u1", name: "Dana Reeve", initials: "DR" }])`); *flags an overdue open task and never flags a DONE one*.

- [ ] **Step 2: Write the failing `listProjectTasks` (4) and `getTaskDetail` (7) cases**

`listProjectTasks` — *orders by status, then order, then createdAt* — captured `orderBy` `toEqual([{ status: "asc" }, { order: "asc" }, { createdAt: "asc" }])`, so DONE lands last by enum declaration order; *includes every status so completed work stays visible on the project page* — captured `where` `toEqual({ projectId: "p1" })` with no status constraint; *builds a subtitle that is the due clause alone* (`"due 14 Aug"`, never "Personal"); *issues exactly one db call regardless of row count*.

`getTaskDetail` — *returns null for an unknown id*; *issues exactly one db call*; *carries the project, client and milestone names for a project task*; *carries nulls for project, client and milestone on a personal task* (what drives the "My Tasks / Task" breadcrumb); *orders checklist items by order then createdAt* — captured nested `orderBy` `toEqual([{ order: "asc" }, { createdAt: "asc" }])`; *reports checklist done and total counts* (three items with one done → 1 and 3); *carries assignees with initials*.

- [ ] **Step 3: Run the tests to verify they fail, implement, and run again**

Run: `npm test` → FAIL with "Cannot find module '@/lib/task-queries'", then green after implementing. `npx tsc --noEmit` → exits 0.

- [ ] **Step 4: Commit**

```bash
git add src/lib/task-queries.ts tests/task-queries.test.ts
git commit -m "feat: task read models for My Tasks, project tasks and detail"
```

---

### Task 8: Team read model with the anti-N+1 contract (TDD)

**Files:**
- Create: `src/lib/team-queries.ts`, `tests/team-queries.test.ts`

**Interfaces:**
- Consumes: Task 1's `taskAssignee` delegate; Task 3's `openTaskSummary` and `sortMyTasks`; `clientInitials`; the empty-`in` short-circuit precedent in `getProjectProgressCounts`.
- Produces:

```ts
export type TeamCardTask = {
  id: string; title: string;
  projectId: string | null; projectName: string | null;
  clientId: string | null; clientName: string | null;
  dueDate: Date | null; priority: TaskPriority;
};
export type TeamCard = {
  id: string; name: string; initials: string; title: string | null;
  openTaskCount: number; openTaskLabel: string;
  inProgress: TeamCardTask[];
};
export async function listTeamCards(db: PrismaClient): Promise<TeamCard[]>;
```

Three queries, constant in team size, with an empty-members short-circuit after the first:

1. `user.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, title: true } })` — if it returns nothing, return `[]` having issued exactly **one** db call.
2. `taskAssignee.groupBy({ by: ["userId"], where: { userId: { in: ids }, task: { status: { not: "DONE" } } }, _count: { _all: true } })`.
3. `taskAssignee.findMany({ where: { userId: { in: ids }, task: { status: "IN_PROGRESS" } }, select: { userId: true, task: { select: { id, title, dueDate, priority, project: { select: { id, name, client: { select: { id, name } } } } } } } })`.

Every member is seeded `{ openTaskCount: 0, openTaskLabel: "No open tasks", inProgress: [] }` **before** the fold, and each member's `inProgress` is sorted with `sortMyTasks`.

**Before writing the captured-args assertions:** confirm that query 2's relation filter (`task: { status: { not: "DONE" } }` inside a `groupBy` `where`) type-checks under `npx tsc --noEmit`. If it does not, take the same documented fallback as Task 2 — a `findMany` folded in memory, same query count, same output — and assert against the shape you shipped.

- [ ] **Step 1: Write the failing cases (13)**

*asks only for active members, ordered by name* — captured `where` `toEqual({ active: true })` and captured `orderBy` `toEqual({ name: "asc" })`; *issues exactly one db call and returns an empty array when no member is active*; *issues exactly three db calls regardless of team size* — one `it` running a five-member fixture and then a one-member fixture, asserting `callsByDelegate()` `toEqual({ user: 1, taskAssigneeGroupBy: 1, taskAssigneeFindMany: 1 })` both times; *counts every non-DONE status as open* — captured `groupBy` `where` `toEqual({ userId: { in: ["u1", "u2"] }, task: { status: { not: "DONE" } } })`, so a REVIEW task counts as open (D7); *folds the grouped counts onto the right member and reports zero for a member with none*; *renders the open-task count through openTaskSummary* (`"3 open tasks"`, and `"No open tasks"` for a zero-count member); *asks only for IN_PROGRESS tasks in the third query* — captured `where.task` `toEqual({ status: "IN_PROGRESS" })`; *names the client and project on each In Progress task* — `cards[0].inProgress[0]` `toEqual({ id: "t1", title: "Draft the brief", projectId: "p1", projectName: "Brand Guidelines v3", clientId: "c1", clientName: "Harlow & Fitch", dueDate: …, priority: "HIGH" })`; *carries nulls for a personal In Progress task* and still renders the title; *orders each member's In Progress tasks by due date then priority*; *reports a member with no tasks as zero open with an empty In Progress list*, proving every member is seeded before the fold; *carries the job title and initials for each member*; *never returns a card for a deactivated member even when they still hold open tasks*.

- [ ] **Step 2: Run the tests to verify they fail, implement, and run again**

Run: `npm test` → FAIL, then green. `npx tsc --noEmit` → exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/lib/team-queries.ts tests/team-queries.test.ts
git commit -m "feat: team card read model with constant query count"
```

---

### Task 9: Server actions for tasks, assignment and checklists

**Files:**
- Create: `src/server/actions/tasks.ts`
- Test: none — action wrappers are untested by convention; the reviewer checks the invariants by eye.

**Interfaces:**
- Consumes: Tasks 4–6 services; Task 3's `taskSchema`, `checklistItemSchema`, `TASK_STATUSES`, `TASK_PRIORITIES`; `parseDateInput`; `requireUser`/`AuthError` from `@/server/guards`; the `prisma` singleton; `err`/`ActionResult`; `src/server/actions/projects.ts` as the verbatim template including its revalidation comment block.
- Produces:

```ts
export async function createTaskAction(_prev: ActionResult<{ id: string }> | null, formData: FormData): Promise<ActionResult<{ id: string }>>;
export async function updateTaskAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult>;
export async function setTaskStatusAction(formData: FormData): Promise<ActionResult>;
export async function setTaskAssigneesAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult>;
export async function removeTaskAction(formData: FormData): Promise<ActionResult>;
export async function addChecklistItemAction(_prev: ActionResult<{ id: string }> | null, formData: FormData): Promise<ActionResult<{ id: string }>>;
export async function setChecklistItemDoneAction(formData: FormData): Promise<ActionResult>;
export async function removeChecklistItemAction(formData: FormData): Promise<ActionResult>;
```

**Revalidation map — reproduce it verbatim as a comment block at the top of the file:**

| Mutation | `revalidatePath` calls |
|---|---|
| `createTaskAction` | `/my-tasks`, `/team`; when `projectId`: `/projects`, `` `/projects/${projectId}` ``; when `clientId`: `` `/clients/${clientId}` `` |
| `updateTaskAction` | the same set for **both** the submitted `projectId`/`clientId` and the hidden `prevProjectId`/`prevClientId` when present and different, plus `` `/tasks/${taskId}` `` |
| `setTaskStatusAction`, `setTaskAssigneesAction`, `removeTaskAction` | `/my-tasks`, `/team`, `` `/tasks/${taskId}` ``; when `projectId`: `/projects`, `` `/projects/${projectId}` ``; when `clientId`: `` `/clients/${clientId}` `` |
| `addChecklistItemAction`, `setChecklistItemDoneAction`, `removeChecklistItemAction` | `` `/tasks/${taskId}` ``; when `projectId`: `` `/projects/${projectId}` ``; when `clientId`: `` `/clients/${clientId}` `` |

Checklist mutations reach the client path because every one of them writes a client-scoped `ActivityLog` row, and the only reader of those rows is the client-detail timeline.

- [ ] **Step 1: Write the file against the nine invariants**

1. `"use server";` is the literal first line, before imports.
2. `requireUser()` is the first statement inside every `try`. There is no `requireAdmin` anywhere in the file.
3. Every `catch` is verbatim `catch (e) { if (e instanceof AuthError) return err(e.message); throw e; }` — nothing else caught.
4. Every scalar `FormData` read is `String(formData.get("x") ?? "")`. **The one documented exception** is the assignee list, `formData.getAll("userId").map(String)`, in `createTaskAction` and `setTaskAssigneesAction` — called out in the header comment, because a checkbox list is inherently multi-valued and `formData.get` would silently return only the first.
5. Enums go through `z.enum(TASK_STATUSES).safeParse` / `z.enum(TASK_PRIORITIES)` with an `"Invalid input"` fallback; booleans compare `=== "true"`; `parseDateInput` is the only date parser; cleared optionals use `field || null`.
6. Validation is `safeParse` with `parsed.error.issues[0]?.message ?? "Invalid input"`.
7. Every `revalidatePath` call matches the map above, with the project and client paths guarded by `if (projectId)` / `if (clientId)` from the form's hidden inputs.
8. `updateTaskAction` revalidates both the submitted and the `prevProjectId`/`prevClientId` pairs when they differ.
9. `setTaskAssigneesAction` has the `(_prev, formData)` `useActionState` signature, so its `ActionResult.error` has somewhere to render.

- [ ] **Step 2: Gates and commit**

Run: `npx tsc --noEmit` → exits 0. `npm run lint` → clean. `npm test` → still green with no new tests.

```bash
git add src/server/actions/tasks.ts
git commit -m "feat: server actions for tasks, assignment and checklists"
```

---

### Task 10: Task components and the My Tasks page

**Files:**
- Modify: `src/app/(app)/my-tasks/page.tsx`, `src/app/page.tsx`, `src/app/(auth)/login/page.tsx`
- Create: `src/components/tasks/{task-form,task-row,task-status-control,assignee-picker,task-status-filter}.tsx`
- Test: none (pages and components untested by convention)

**Interfaces:**
- Consumes: Task 7's `listMyTasks`; Task 9's task actions; Task 3's label and badge maps, `taskListSummary`, `capAssignees`, `parseTaskStatusFilter`; `components/ui/{badge,initials-avatar,page-header,empty-state}.tsx`; `src/components/projects/project-filters.tsx` as the GET-filter template; `src/components/projects/project-form.tsx` as the controlled-form template.
- Produces: route `/my-tasks`; `<TaskRow>`, `<TaskForm>`, `<TaskStatusControl>`, `<AssigneePicker>`, `<TaskStatusFilter>`; `/` and login redirecting to `/my-tasks`.

**Component contracts:**

```tsx
<TaskRow row={TaskListRow} />
<TaskForm
  task?={{ id; title; description; projectId; milestoneId; priority; dueDate }}
  projectId?={string | null}          // fixed context: no project select is rendered
  clientId?={string | null}
  projects={Array<{ id: string; name: string; clientId: string }>}
  milestones={{ projectId: string; options: Array<{ id: string; title: string }> } | null}
  members={Array<{ id: string; name: string; active: boolean }>}
  selectedAssigneeIds?={string[]}
/>
<TaskStatusControl taskId={string} projectId={string | null} clientId={string | null} status={TaskStatus} />
<AssigneePicker members={Array<{ id: string; name: string; active: boolean }>} selectedIds={string[]} />
<TaskStatusFilter status={TaskStatusFilter | null} />
```

**Page data sources — no page invents a query:**

| Page | Query |
|---|---|
| `/my-tasks` | `listMyTasks(prisma, { userId, status })` |
| `/my-tasks` | `prisma.project.findMany({ where: { status: { not: "DONE" } }, select: { id: true, name: true, clientId: true }, orderBy: { name: "asc" } })` — the project `<select>` options; `clientId` is what lets the form submit a matching hidden `clientId` |
| `/my-tasks` | `prisma.user.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } })` — the assignee picker, unioned with the task's current assignees when editing |

- [ ] **Step 1: Build the five components**

- Every colour is `[var(--token)]`; no `dark:` variant; no hardcoded palette colour.
- `<TaskForm>` follows the house pattern exactly: one controlled `values` state object, a `set()` helper, and an `attempt` counter incremented **only** on a rejected submit and used as `<form key={attempt}>`. Checkboxes and selects do not restore their DOM state from controlled state after React 19's post-action reset — the attempt key is what carries them.
- `<TaskForm>` derives and submits a hidden `clientId` from the selected project's `clientId` in the `projects` prop, plus hidden `prevProjectId`/`prevClientId` when editing.
- The milestone `<select>` renders **only** when `milestones !== null` **and** `values.projectId === milestones.projectId`; otherwise it is hidden and `milestoneId` submits `""`. This repo has no client-side data fetching, so a project chosen in the select cannot load its milestones — pairing the options with the id they were loaded for is what keeps the two selects from quietly contradicting each other.
- `<AssigneePicker>` renders every entry in `members` as a checkbox named `userId`, checked when in `selectedIds`. An entry with `active: false` renders identically — the vocabulary lock has no string for it.
- `<TaskStatusFilter>` is a copy of `ProjectFilters`: a `<form method="get">` with a `<select name="status">` calling `e.currentTarget.form?.requestSubmit()` on change, plus a `<noscript>` submit button. Options: "Open tasks" (`""`), "All statuses" (`"ALL"`), then the four status labels.
- `<TaskRow>` shows the title, `taskRowSubtitle`, a status `<Badge>`, a priority `<Badge>`, and up to three circular `<InitialsAvatar>`s plus `+N` from `capAssignees`. The row links to `/tasks/{id}`.
- Empty list renders `<EmptyState message="Nothing assigned to you." />`.

- [ ] **Step 2: Make `/my-tasks` the landing view — four literal strings**

`src/app/page.tsx`: `redirect("/dashboard")` → `redirect("/my-tasks")`. In `src/app/(auth)/login/page.tsx`: the already-authenticated `redirect("/dashboard")`, the credentials `redirectTo: "/dashboard"` and the Google `redirectTo: "/dashboard"` all become `/my-tasks`. `/dashboard` stays a route, stays in the sidebar and stays a `PlaceholderPage` — deleting a Phase 1 route this phase was not asked to remove would be scope.

- [ ] **Step 3: Browser QA — execute every line and record the result in the task report**

1. `/my-tasks` lists only tasks assigned to me and reads exactly "Nothing assigned to you." when there are none.
2. "New task" expands an inline form (no overlay); creating a task with no project produces a personal task that appears immediately with no client or project clause in its subtitle.
3. The assignee picker is a checkbox list of active members; ticking myself plus one colleague and saving takes **under 15 seconds** from a cold `/my-tasks`, and the row shows both circular initials avatars.
4. A task with five assignees renders three avatars plus "+2".
5. Changing a row's status updates in place; setting it to Done removes it from the default view.
6. The status filter narrows the list, the URL carries `?status=`, the filter survives a browser reload, and pasting the URL into a new tab still applies it.
7. "All statuses" brings the Done task back; "Review" shows only Review tasks.
8. A rejected submit (blank title) renders exactly "Task title is required" inline **and** every field the user had already filled keeps its value — including the priority select, the status select and the assignee checkboxes.
9. Signing out and back in lands on `/my-tasks`; visiting `/` redirects there; `/dashboard` is still reachable from the sidebar.
10. Sorting reads correctly — dated tasks ascending, undated last, Urgent above Low within the same date.
11. Both themes render via the topbar toggle.

- [ ] **Step 4: Gates and commit**

Run: `npm test` → green. `npx tsc --noEmit` → exits 0. `npm run lint` → clean. **`npm run build` → succeeds.**

```bash
grep -rnE "dark:|bg-(indigo|gray|slate|zinc|red|green|amber)-|#[0-9a-fA-F]{3,6}" src/components/tasks "src/app/(app)/my-tasks"
```

Expected: no matches.

```bash
git add src/components/tasks "src/app/(app)/my-tasks" src/app/page.tsx "src/app/(auth)/login/page.tsx"
git commit -m "feat: task components and the My Tasks landing view"
```

---

### Task 11: Task detail page, checklist, and the project-detail Tasks section

**Files:**
- Create: `src/app/(app)/tasks/[taskId]/page.tsx`, `src/components/tasks/checklist.tsx`
- Modify: `src/app/(app)/projects/[projectId]/page.tsx`
- Test: none

**Interfaces:**
- Consumes: Task 7's `getTaskDetail` and `listProjectTasks`; Task 9's task and checklist actions; Task 10's `<TaskForm>`, `<TaskRow>`, `<TaskStatusControl>`, `<AssigneePicker>`; Task 3's `taskListSummary`; `getProjectDetail`'s already-loaded `milestones`; `notFound()` and the awaited-params form proven on the existing project detail page.
- Produces: route `/tasks/[taskId]` typed `props: { params: Promise<{ taskId: string }> }`; `<Checklist taskId projectId clientId items>`; the project-detail Tasks section.

**Page data sources:**

| Page | Query |
|---|---|
| `/tasks/[taskId]` | `getTaskDetail(prisma, taskId)`; the project options and active-members queries from Task 10; plus `prisma.milestone.findMany({ where: { projectId: task.projectId }, orderBy: [{ order: "asc" }, { createdAt: "asc" }], select: { id: true, title: true } })` **only when `task.projectId !== null`** |
| `/projects/[projectId]` | `listProjectTasks(prisma, projectId)` and the active-members query; milestone options come from `getProjectDetail`'s already-loaded `milestones` |

- [ ] **Step 1: Build `/tasks/[taskId]`**

- Breadcrumb: project task → `Clients / {client} / {project} / Task` with the client and project segments linking; personal task → `My Tasks / Task`.
- Header: title, `<TaskStatusControl>`, priority `<Badge>`, due date.
- Description is a plain textarea in the edit form and renders as plain text (D2).
- Meta row: creator, milestone. **No activity timeline on this page** — task history reaches the client timeline through the scope walk-up, and `listClientActivity` is the only reader that exists.
- `<AssigneePicker>` is mounted inside a `useActionState` form over `setTaskAssigneesAction`, with `members` = the union of active members and the task's current assignees so a deactivated current assignee stays checked and is never dropped by an unrelated save.
- `<Checklist>` uses the fire-and-forget `run()` pattern from `member-row-actions.tsx`; empty renders "No checklist items yet."
- Unknown id → `notFound()`.

- [ ] **Step 2: Add the Tasks section to the project page**

Placed **between the header stat card and the Milestones section**. A `<section>` with `<h2>Tasks</h2>`, `taskListSummary(rows)` as a muted count, and a right-aligned `<TaskForm projectId clientId milestones={{ projectId, options }} members>` whose collapsed state is the "New task" button. Body is one `<TaskRow>` per row from `listProjectTasks`; empty renders `<EmptyState message="No tasks yet." />`. Because `listProjectTasks` orders by `status asc`, DONE tasks sort last and stay visible — a task that vanished on completion would read as data loss, and the denominator of the progress bar on the same screen would become unreadable.

- [ ] **Step 3: Browser QA — execute every line and record the result**

1. A project task's breadcrumb reads `Clients / {client} / {project} / Task` with both segments linking; a personal task's reads `My Tasks / Task`.
2. Editing title, description, priority and due date updates the page and produces exactly one client-timeline entry naming the changed fields.
3. "Add checklist item" adds an item; ticking and un-ticking both persist and each writes one client-timeline entry (added, completed, reopened); "Remove" deletes it; an empty list reads exactly "No checklist items yet."
4. Changing assignees adds and removes avatars and produces **at most two** timeline entries, each naming everyone affected — never one per person.
5. Changing the project in the edit form hides the milestone select and saves cleanly; the task moves and its milestone is cleared.
6. Clearing the project turns it into a personal task, the breadcrumb switches to `My Tasks / Task`, its milestone is cleared, and its later activity stops appearing on the client timeline.
7. The project page's Tasks section sits between the stat card and the Milestones section; "New task" there pre-fixes the client and project (no project select rendered) and offers only that project's milestones.
8. Created tasks appear immediately; DONE tasks sort last and stay visible; the section header reads "5 tasks · 2 done" and an empty project reads exactly "No tasks yet."
9. Adding a project's first task flips its AUTO progress from the milestone basis to the task basis, and the new value appears identically on `/projects`, the client page and the project page.
10. Completing that task moves the bar on all three surfaces; moving one to Review does not.
11. "Brand Guidelines v3" (milestones only, no tasks) still reads its milestone-derived value — no existing project regresses to `—`.
12. "Spring Campaign Site" (neither) reads `—` plus "Add tasks or set progress manually", never `0%`.
13. Switching a project MANUAL → AUTO → MANUAL still preserves the stored manual value.
14. Assigning a task from here makes it appear on that member's `/my-tasks` and, once In Progress, on their `/team` card.
15. **Deactivated-assignee safety:** deactivate a member who holds a task, open that task, change an unrelated field and save — the deactivated member is still assigned and no `task.unassigned` entry appears.
16. **Cross-project move revalidation:** move a task from project A to project B and confirm it disappears from A's Tasks section and appears in B's without a manual refresh.
17. `/tasks/does-not-exist` renders the 404 UI; both themes render.

- [ ] **Step 4: Gates and commit**

Run: `npm test` → green. `npx tsc --noEmit` → exits 0. `npm run lint` → clean.

```bash
git add "src/app/(app)/tasks" src/components/tasks/checklist.tsx "src/app/(app)/projects"
git commit -m "feat: task detail, checklist and the project tasks section"
```

---

### Task 12: Team grid

**Files:**
- Modify: `src/app/(app)/team/page.tsx`
- Create: `src/components/team/member-card.tsx`
- Test: none

**Interfaces:**
- Consumes: Task 8's `listTeamCards`; `components/ui/{initials-avatar,page-header,badge,empty-state}.tsx`; `src/components/projects/project-row.tsx` as the row-density reference.
- Produces: route `/team`; `<MemberCard card={TeamCard} />`.

- [ ] **Step 1: Build the grid**

`/team` replaces its `PlaceholderPage` with one `<MemberCard>` per entry from `listTeamCards(prisma)` — the whole of D5; the per-member profile page is 3b. Each card: circular `<InitialsAvatar>`, name, job title, the `openTaskLabel` string exactly as the read model composed it (the component does no arithmetic and no pluralisation), and the member's In Progress tasks each naming its client and project and linking to `/tasks/{id}`. A member with nothing in flight renders an empty-but-correct card.

- [ ] **Step 2: Browser QA — execute every line and record the result**

1. One card per active member, showing a circular avatar, job title and the open-task count phrased exactly "3 open tasks" / "1 open task" / "No open tasks".
2. Each card lists that member's current In Progress tasks, naming the client and project for each, each linking to `/tasks/{id}`.
3. A member's personal In Progress task appears with just its title and no client or project clause.
4. A member with nothing in flight renders an empty-but-correct card, not a broken one.
5. Deactivating a member removes their card while their tasks remain visible on the project page and their name still renders in past timeline entries.
6. Assigning a task on `/my-tasks` and moving it to In Progress makes it appear on that member's card; moving it to Done drops the open count by one and removes it from the In Progress list.
7. Both themes render; the grid reflows sensibly at a narrow width.

- [ ] **Step 3: Final gates and commit**

Run: `npm test` → green. `npx tsc --noEmit` → exits 0. `npm run lint` → clean. **`npm run build` → succeeds.**

```bash
grep -rnE "dark:|bg-(indigo|gray|slate|zinc|red|green|amber)-|#[0-9a-fA-F]{3,6}" src/app src/components src/lib
```

Expected: no matches.

```bash
git add "src/app/(app)/team" src/components/team
git commit -m "feat: team grid answering who is working on what"
```

---

## Phase 3a Done Criteria

- [ ] Any member can create a task and assign it to one or more people, including themselves, from `/my-tasks` or a project page.
- [ ] `/my-tasks` is the default landing view and lists the viewer's open tasks with a status filter that survives a reload.
- [ ] `/team` shows one card per active member with their open-task count and current In Progress work, naming the client and project.
- [ ] A project with tasks derives AUTO progress from tasks; a project with only milestones still derives it from milestones; a project with neither reads `—`, never `0%`.
- [ ] Completing a task visibly moves progress on the project page, the projects list and the client page; moving one to Review does not.
- [ ] Every task and checklist mutation writes exactly one correctly scoped activity row, visible on the client timeline — and personal tasks write `clientId: null` and appear on no client timeline.
- [ ] A deactivated member keeps their assignments; no unrelated save unassigns them.
- [ ] Switching a project MANUAL → AUTO → MANUAL still preserves the stored manual value.
- [ ] All Vitest suites pass (`npm test`); `npx tsc --noEmit` clean; `npm run lint` clean; `npm run build` succeeds.
- [ ] No `dark:` variant and no hardcoded palette colour anywhere in `src/`.
