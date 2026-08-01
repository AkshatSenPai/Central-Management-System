# Phase 3b — Board & People Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a per-project kanban board with drag-between-columns, a member profile page at `/team/[memberId]`, and a global quick-add in the topbar.

**Architecture:** No new Prisma model, no migration, no new mutation. The board moves cards through the existing `setTaskStatusAction`; quick-add creates through the existing `createTaskAction`. Everything new is a read model, a pure helper, or UI. Optimistic movement uses React 19's `useOptimistic`, with rollback falling out of the fact that a failed `ActionResult` never revalidates.

**Tech Stack:** Next.js 16.2.12 (App Router, Turbopack, Server Actions), React 19.2.4, Prisma 7.9.1 + Neon Postgres, zod 4, Vitest 4 (node environment), Tailwind v4 with CSS-variable tokens.

**Spec:** `docs/superpowers/specs/2026-08-01-phase-3b-board-people-design.md`

## Global Constraints

- **Read `node_modules/next/dist/docs/` before writing framework code.** This Next.js differs from training data (project `AGENTS.md`).
- Every colour is `[var(--token)]`. **No `dark:` variant anywhere. No hardcoded palette colour.**
- No new Prisma model, no migration, no new server action, no new activity verb.
- Tests use hand-rolled closure fakes. **No `vi.fn`, `vi.spyOn`, `vi.mock`, `@testing-library/react`, jsdom.**
- `ActionResult` failures asserted with whole-object `toEqual` against exact literal error strings.
- Pages, components and action wrappers are **not** unit-tested; browser QA carries them (Task 8).
- Forms follow the house pattern: one controlled `values` state object, `<form key={attempt}>` where `attempt` increments **only** on a rejected submit.
- Every new string must match the Vocabulary Lock below exactly. No synonyms, no re-casing.
- After any `prisma generate` or migration, **restart the dev server** — a running server holds a stale Prisma Client.

## Vocabulary Lock

Everything from the 3a lock carries over unchanged. New strings:

- **Breadcrumbs:** `Clients / {client} / {project} / Board` · `Team / {member}`
- **Links and buttons:** "Board" · "Quick add" · "Save" / "Saving…"
- **Empty states:** profile with no matching tasks → "Nothing assigned." · board with no tasks → "No tasks yet." · an empty column renders **no text**
- **Profile marker:** "Deactivated"
- **Column headers:** the four locked status labels ("To Do", "In Progress", "Review", "Done"), each followed by a count

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/task.ts` (modify) | `groupTasksByStatus`; corrected `order` comment |
| `src/lib/task-queries.ts` (modify) | `listMyTasks` → `listAssignedTasks` |
| `src/lib/team-queries.ts` (modify) | `getMemberProfile` |
| `src/components/tasks/board-card.tsx` (create) | One draggable card |
| `src/components/tasks/board-column.tsx` (create) | One column, a drop target |
| `src/components/tasks/board.tsx` (create) | Client component owning optimistic state and drag |
| `src/components/tasks/quick-add.tsx` (create) | Topbar capture panel |
| `src/app/(app)/projects/[projectId]/board/page.tsx` (create) | Board route |
| `src/app/(app)/team/[memberId]/page.tsx` (create) | Member profile route |
| `src/app/(app)/projects/[projectId]/page.tsx` (modify) | "Board" link |
| `src/app/(app)/team/page.tsx`, `src/components/team/member-card.tsx` (modify) | Card links to profile |
| `src/app/(app)/layout.tsx`, `src/components/shell/topbar.tsx` (modify) | Quick-add wiring |
| `src/app/(app)/my-tasks/page.tsx` (modify) | Renamed query call |

**Deliberate deviation from spec §7:** the spec lists a `team/member-profile-header.tsx` component. It has exactly one consumer and no state, so it is inlined in the profile page instead. Extracting a single-use presentational header would add a file and an import without adding a boundary. If a second consumer appears, extract it then.

---

### Task 1: Rename `listMyTasks` to `listAssignedTasks`

Pure rename, zero behaviour change. Done first so Task 5 composes a correctly named function. The name asserts a viewer the function does not have once the profile page calls it for someone else.

**Files:**
- Modify: `src/lib/task-queries.ts`, `src/app/(app)/my-tasks/page.tsx`
- Test: `tests/task-queries.test.ts`

**Interfaces:**
- Produces: `listAssignedTasks(db: PrismaClient, input: { userId: string; status?: TaskStatusFilter | null }): Promise<TaskListRow[]>` — identical signature and behaviour to the old `listMyTasks`.

- [ ] **Step 1: Rename the function and update its doc comment**

In `src/lib/task-queries.ts`, rename the export and replace the first sentence of its doc comment:

```ts
/** Tasks assigned to one member, open work only unless asked otherwise — the
 * same "not DONE unless ALL or an explicit status" rule as listProjects.
 * Named for the assignee rather than the viewer because /team/[memberId]
 * reads it for someone other than the person looking. Ordered by createdAt
 * ascending so sortMyTasks' stable in-memory sort has a deterministic input;
 * exactly one db call, whatever the row count. */
export async function listAssignedTasks(
  db: PrismaClient,
  input: { userId: string; status?: TaskStatusFilter | null }
): Promise<TaskListRow[]> {
```

Leave the body untouched.

- [ ] **Step 2: Update the two call sites**

In `src/app/(app)/my-tasks/page.tsx`, change the import and the call:

```ts
import { listAssignedTasks } from "@/lib/task-queries";
```
```ts
    listAssignedTasks(prisma, { userId, status }),
```

In `tests/task-queries.test.ts`, change the import and every `listMyTasks(` call to `listAssignedTasks(`. Update the `describe("listMyTasks")` block name to `describe("listAssignedTasks")`. Do not change any assertion.

- [ ] **Step 3: Verify nothing still references the old name**

Run: `npx tsc --noEmit`
Expected: exits 0, no output.

Run: `git grep -n "listMyTasks" -- src tests`
Expected: no output. (`sortMyTasks` is a different function and must NOT be renamed — if the grep matches it, your rename was too broad.)

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: 457 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/task-queries.ts "src/app/(app)/my-tasks" tests/task-queries.test.ts
git commit -m "refactor: rename listMyTasks to listAssignedTasks"
```

---

### Task 2: `groupTasksByStatus` and the corrected `order` comment (TDD)

**Files:**
- Modify: `src/lib/task.ts`
- Test: `tests/task.test.ts`

**Interfaces:**
- Consumes: `TASK_STATUSES`, `TaskStatus` from `src/lib/task.ts`; `TaskListRow` from `src/lib/task-queries.ts`.
- Produces: `groupTasksByStatus(rows: TaskListRow[]): Record<TaskStatus, TaskListRow[]>` — every status key present even when empty; input order preserved within each group.

**Note on the import direction:** `task.ts` is the pure module and `task-queries.ts` imports *from* it. To avoid a cycle, `groupTasksByStatus` must be generic over a minimal shape, not import `TaskListRow`:

```ts
export function groupTasksByStatus<T extends { status: TaskStatus }>(rows: T[]): Record<TaskStatus, T[]>
```

- [ ] **Step 1: Write the failing tests**

Append to `tests/task.test.ts` (add `groupTasksByStatus` to the existing import from `@/lib/task`):

```ts
describe("groupTasksByStatus", () => {
  const row = (id: string, status: TaskStatus) => ({ id, status });

  it("returns every status as a key even when its column is empty", () => {
    const grouped = groupTasksByStatus([row("t1", "TO_DO")]);
    expect(Object.keys(grouped).sort()).toEqual(["DONE", "IN_PROGRESS", "REVIEW", "TO_DO"]);
    expect(grouped.IN_PROGRESS).toEqual([]);
    expect(grouped.REVIEW).toEqual([]);
    expect(grouped.DONE).toEqual([]);
  });

  it("files each row under its own status", () => {
    const grouped = groupTasksByStatus([
      row("t1", "TO_DO"),
      row("t2", "DONE"),
      row("t3", "TO_DO"),
    ]);
    expect(grouped.TO_DO.map((r) => r.id)).toEqual(["t1", "t3"]);
    expect(grouped.DONE.map((r) => r.id)).toEqual(["t2"]);
  });

  // listProjectTasks already sorts [status, order, createdAt]; the board must
  // not disturb that, or the column ordering silently becomes insertion order.
  it("preserves input order within a group", () => {
    const grouped = groupTasksByStatus([
      row("c", "REVIEW"),
      row("a", "REVIEW"),
      row("b", "REVIEW"),
    ]);
    expect(grouped.REVIEW.map((r) => r.id)).toEqual(["c", "a", "b"]);
  });

  it("returns all four empty groups for an empty list", () => {
    expect(groupTasksByStatus([])).toEqual({ TO_DO: [], IN_PROGRESS: [], REVIEW: [], DONE: [] });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/task.test.ts -t groupTasksByStatus`
Expected: FAIL — `groupTasksByStatus is not a function`.

- [ ] **Step 3: Implement**

Add to `src/lib/task.ts`:

```ts
/** The board's read shape. Every status is seeded before any row is filed,
 * so a column is always present and always a valid drop target — the board
 * never null-checks and an empty column is an empty array, never undefined.
 * Rows keep the order they arrived in, which is what carries
 * listProjectTasks' [status, order, createdAt] sort through untouched. */
export function groupTasksByStatus<T extends { status: TaskStatus }>(
  rows: T[]
): Record<TaskStatus, T[]> {
  const grouped = {} as Record<TaskStatus, T[]>;
  for (const status of TASK_STATUSES) grouped[status] = [];
  for (const row of rows) grouped[row.status].push(row);
  return grouped;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/task.test.ts -t groupTasksByStatus`
Expected: 4 passed.

- [ ] **Step 5: Correct the stale `order` comment (spec D2)**

3a's comment promises ranking logic that Phase 3b deliberately does not build. In `src/lib/task.ts`, replace the doc comment on `nextTaskOrder`:

```ts
/** Server-assigned: max + 1, never a count, so deleting a middle task cannot
 * make the next one collide. Mirrors nextMilestoneOrder.
 *
 * `order` is written but currently read by nothing. Phase 3a expected 3b's
 * kanban to give it meaning; 3b moves cards between columns only, so no
 * ranking consumes it yet. Reserved deliberately — do not go looking for the
 * sort that reads it, and do not delete it. */
```

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: 461 passed.

- [ ] **Step 7: Commit**

```bash
git add src/lib/task.ts tests/task.test.ts
git commit -m "feat: groupTasksByStatus and an honest comment on task order"
```

---

### Task 3: Board card, column and route (no drag yet)

Delivers a readable four-column board. Drag is Task 4, so this task can be reviewed on layout and data alone.

**Files:**
- Create: `src/components/tasks/board-card.tsx`, `src/components/tasks/board-column.tsx`, `src/app/(app)/projects/[projectId]/board/page.tsx`
- Modify: `src/app/(app)/projects/[projectId]/page.tsx`
- Test: none (browser QA, Task 8)

**Interfaces:**
- Consumes: `listProjectTasks`, `getProjectDetail`, `groupTasksByStatus`, `TASK_STATUSES`, `TASK_STATUS_LABEL`, `TASK_PRIORITY_BADGE`, `TASK_PRIORITY_LABEL`, `capAssignees`, `TaskListRow`, `<Badge>`, `<InitialsAvatar>`, `<EmptyState>`, `<TaskStatusControl>`.
- Produces: `<BoardCard row draggable onDragStart error>` and `<BoardColumn status rows onDragOver onDrop isOver>` — Task 4 passes the drag props, which are optional here so this task renders without them.

- [ ] **Step 1: Build `board-card.tsx`**

```tsx
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { InitialsAvatar } from "@/components/ui/initials-avatar";
import { TASK_PRIORITY_BADGE, TASK_PRIORITY_LABEL, capAssignees } from "@/lib/task";
import type { TaskListRow } from "@/lib/task-queries";
import { TaskStatusControl } from "@/components/tasks/task-status-control";

/** One card. The status select stays on every card on purpose (spec D4): it
 * is the keyboard and touch path, so the board degrades to a usable layout
 * when drag is unavailable rather than becoming read-only. `error` is keyed
 * by task id upstream, so a failed move reports on the card it happened to
 * — a board can show forty cards, and a board-level banner would not say
 * which one. */
export function BoardCard({
  row,
  draggable = false,
  onDragStart,
  error,
}: {
  row: TaskListRow;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent<HTMLDivElement>) => void;
  error?: string | null;
}) {
  const { shown, extra } = capAssignees(row.assignees);

  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      className={`space-y-2 rounded-md border border-[var(--border)] bg-[var(--surface)] p-3 ${
        draggable ? "cursor-grab active:cursor-grabbing" : ""
      }`}
    >
      <Link href={`/tasks/${row.id}`} className="block min-w-0">
        <p className="truncate text-sm font-medium text-[var(--text)]">{row.title}</p>
        {row.subtitle ? (
          <p className={`truncate text-xs ${row.overdue ? "text-[var(--bad)]" : "text-[var(--text-3)]"}`}>
            {row.subtitle}
          </p>
        ) : null}
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Badge kind={TASK_PRIORITY_BADGE[row.priority]}>{TASK_PRIORITY_LABEL[row.priority]}</Badge>
        <div className="flex items-center -space-x-2">
          {shown.map((a) => (
            <span key={a.id} className="rounded-full ring-2 ring-[var(--surface)]">
              <InitialsAvatar initials={a.initials} shape="circle" size={24} />
            </span>
          ))}
          {extra > 0 ? (
            <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full ring-2 ring-[var(--surface)] bg-[var(--surface-3)] text-[10px] font-bold text-[var(--text-2)]">
              +{extra}
            </span>
          ) : null}
        </div>
      </div>

      <TaskStatusControl
        taskId={row.id}
        projectId={row.projectId}
        clientId={row.clientId}
        status={row.status}
      />

      {error ? <p className="text-xs text-[var(--bad)]">{error}</p> : null}
    </div>
  );
}
```

- [ ] **Step 2: Build `board-column.tsx`**

```tsx
import { TASK_STATUS_LABEL, type TaskStatus } from "@/lib/task";

/** A column is always rendered, even empty, because it must stay a drop
 * target. An empty column shows no text by design (Vocabulary Lock) — the
 * min-height is what keeps it droppable rather than a zero-height strip. */
export function BoardColumn({
  status,
  count,
  isOver = false,
  onDragOver,
  onDrop,
  children,
}: {
  status: TaskStatus;
  count: number;
  isOver?: boolean;
  onDragOver?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDrop?: (e: React.DragEvent<HTMLDivElement>) => void;
  children: React.ReactNode;
}) {
  return (
    <div
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={`flex min-h-40 flex-col gap-2 rounded-lg border p-3 ${
        isOver
          ? "border-[var(--accent-line)] bg-[var(--accent-soft)]"
          : "border-[var(--border)] bg-[var(--surface-2)]"
      }`}
    >
      <div className="flex items-baseline gap-2">
        <h2 className="text-sm font-medium text-[var(--text)]">{TASK_STATUS_LABEL[status]}</h2>
        <span className="text-xs text-[var(--text-3)]">{count}</span>
      </div>
      {children}
    </div>
  );
}
```

- [ ] **Step 3: Build the route**

Create `src/app/(app)/projects/[projectId]/board/page.tsx`:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getProjectDetail } from "@/lib/project-queries";
import { listProjectTasks } from "@/lib/task-queries";
import { groupTasksByStatus, TASK_STATUSES } from "@/lib/task";
import { EmptyState } from "@/components/ui/empty-state";
import { BoardCard } from "@/components/tasks/board-card";
import { BoardColumn } from "@/components/tasks/board-column";

export default async function ProjectBoardPage(props: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await props.params;
  const project = await getProjectDetail(prisma, projectId);
  if (!project) notFound();

  const tasks = await listProjectTasks(prisma, projectId);
  const grouped = groupTasksByStatus(tasks);

  return (
    <div className="space-y-6 p-8">
      <nav className="text-xs text-[var(--text-3)]">
        <Link href="/clients" className="hover:text-[var(--text-2)]">
          Clients
        </Link>
        <span> / </span>
        <Link href={`/clients/${project.clientId}`} className="hover:text-[var(--text-2)]">
          {project.clientName}
        </Link>
        <span> / </span>
        <Link href={`/projects/${project.id}`} className="hover:text-[var(--text-2)]">
          {project.name}
        </Link>
        <span> / </span>
        <span className="text-[var(--text-2)]">Board</span>
      </nav>

      <h1 className="text-2xl font-semibold text-[var(--text)]">{project.name}</h1>

      {tasks.length === 0 ? (
        <EmptyState message="No tasks yet." />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {TASK_STATUSES.map((status) => (
            <BoardColumn key={status} status={status} count={grouped[status].length}>
              {grouped[status].map((row) => (
                <BoardCard key={row.id} row={row} />
              ))}
            </BoardColumn>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Link to it from the project page**

In `src/app/(app)/projects/[projectId]/page.tsx`, inside the Tasks `<section>` header (the `flex items-center justify-between` div at ~line 138), add the link immediately before `<TaskForm`:

```tsx
          <div className="flex items-center gap-2">
            <Link
              href={`/projects/${project.id}/board`}
              className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text-2)] hover:bg-[var(--surface-2)]"
            >
              Board
            </Link>
            <TaskForm
              projectId={project.id}
              clientId={project.clientId}
              projects={[]}
              milestones={{ projectId: project.id, options: milestoneOptions }}
              members={members}
            />
          </div>
```

Replace the existing bare `<TaskForm … />` with the block above. `Link` is already imported in that file.

- [ ] **Step 5: Gates**

Run: `npx tsc --noEmit` → exits 0.
Run: `npm run lint` → clean.
Run: `npm run build` → succeeds, and the route list includes `/projects/[projectId]/board`.

Run: `git grep -nE "dark:|#[0-9a-fA-F]{3,6}" -- src/components/tasks "src/app/(app)/projects"`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/components/tasks/board-card.tsx src/components/tasks/board-column.tsx "src/app/(app)/projects"
git commit -m "feat: project board layout with four status columns"
```

---

### Task 4: Drag between columns with optimistic movement

**Files:**
- Create: `src/components/tasks/board.tsx`
- Modify: `src/app/(app)/projects/[projectId]/board/page.tsx`
- Test: none (browser QA, Task 8)

**Interfaces:**
- Consumes: `<BoardCard>`, `<BoardColumn>` from Task 3; `groupTasksByStatus` from Task 2; `setTaskStatusAction` from `@/server/actions/tasks`; `TASK_STATUSES`, `TaskStatus`, `TaskListRow`.
- Produces: `<Board rows={TaskListRow[]} />` — owns all board state; the page becomes a thin server wrapper.

**The one way to get this wrong (spec D6):** the action must be awaited **inside** the same `startTransition` that applied the optimistic update. Await outside it and the transition ends immediately, so the card snaps back before the server answers — which looks exactly like a failure. The code below keeps the `await` inside.

- [ ] **Step 1: Build `board.tsx`**

```tsx
"use client";

import { useOptimistic, useState, useTransition } from "react";
import { groupTasksByStatus, TASK_STATUSES, type TaskStatus } from "@/lib/task";
import type { TaskListRow } from "@/lib/task-queries";
import { setTaskStatusAction } from "@/server/actions/tasks";
import { BoardCard } from "@/components/tasks/board-card";
import { BoardColumn } from "@/components/tasks/board-column";

const DRAG_KEY = "text/plain";

/** Rollback is deliberately absent as code. setTaskStatusAction calls
 * revalidatePath only on success, so a rejected move leaves server state
 * untouched; when the transition ends React discards the optimistic overlay
 * and the card is already back where it started. Writing an explicit revert
 * here would fight that, not help it. */
export function Board({ rows }: { rows: TaskListRow[] }) {
  const [, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [overColumn, setOverColumn] = useState<TaskStatus | null>(null);

  const [optimisticRows, applyMove] = useOptimistic(
    rows,
    (current: TaskListRow[], move: { taskId: string; status: TaskStatus }) =>
      current.map((r) => (r.id === move.taskId ? { ...r, status: move.status } : r))
  );

  const grouped = groupTasksByStatus(optimisticRows);

  function onDrop(status: TaskStatus) {
    return (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setOverColumn(null);
      const taskId = e.dataTransfer.getData(DRAG_KEY);
      const row = rows.find((r) => r.id === taskId);
      // Unknown id, or a drop back onto the card's own column: nothing to do.
      // setTaskStatus would also no-op, but not issuing the call at all keeps
      // the board silent instead of round-tripping to say nothing changed.
      if (!row || row.status === status) return;

      startTransition(async () => {
        applyMove({ taskId, status });
        const fd = new FormData();
        fd.set("taskId", taskId);
        fd.set("status", status);
        if (row.projectId) fd.set("projectId", row.projectId);
        if (row.clientId) fd.set("clientId", row.clientId);

        try {
          const result = await setTaskStatusAction(fd);
          if (result.ok) {
            setErrors((prev) => {
              const next = { ...prev };
              delete next[taskId];
              return next;
            });
          } else {
            setErrors((prev) => ({ ...prev, [taskId]: result.error }));
          }
        } catch {
          setErrors((prev) => ({ ...prev, [taskId]: "Something went wrong — try again" }));
        }
      });
    };
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      {TASK_STATUSES.map((status) => (
        <BoardColumn
          key={status}
          status={status}
          count={grouped[status].length}
          isOver={overColumn === status}
          onDragOver={(e) => {
            // Without preventDefault the browser fires no drop event at all.
            e.preventDefault();
            setOverColumn(status);
          }}
          onDrop={onDrop(status)}
        >
          {grouped[status].map((row) => (
            <BoardCard
              key={row.id}
              row={row}
              draggable
              onDragStart={(e) => e.dataTransfer.setData(DRAG_KEY, row.id)}
              error={errors[row.id] ?? null}
            />
          ))}
        </BoardColumn>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Swap the page over to `<Board>`**

In `src/app/(app)/projects/[projectId]/board/page.tsx`, remove the `BoardCard`, `BoardColumn`, `groupTasksByStatus` and `TASK_STATUSES` imports, add `import { Board } from "@/components/tasks/board";`, delete the `grouped` line, and replace the whole `<div className="grid …">…</div>` block with:

```tsx
        <Board rows={tasks} />
```

The `tasks.length === 0` branch and its `<EmptyState message="No tasks yet." />` stay exactly as they are.

- [ ] **Step 3: Gates**

Run: `npx tsc --noEmit` → exits 0.
Run: `npm run lint` → clean.
Run: `npm test` → 461 passed (unchanged; this task adds no tests).
Run: `npm run build` → succeeds.

- [ ] **Step 4: Smoke the drag in the browser**

Start the dev server, open a project board with at least two tasks in different columns, and confirm:
1. Dragging a card to another column moves it immediately, before the network settles.
2. The column under the cursor highlights while dragging over it.
3. Reloading shows the card in its new column.
4. Dropping a card back on its own column does nothing and issues no request.

Full QA is Task 8; this is only to catch a broken drag before committing.

- [ ] **Step 5: Commit**

```bash
git add src/components/tasks/board.tsx "src/app/(app)/projects"
git commit -m "feat: drag cards between board columns with optimistic movement"
```

---

### Task 5: `getMemberProfile` read model (TDD)

**Files:**
- Modify: `src/lib/team-queries.ts`
- Test: `tests/team-queries.test.ts`

**Interfaces:**
- Consumes: `listAssignedTasks` (Task 1), `clientInitials` from `@/lib/client`, `TaskStatusFilter` and `TaskListRow`.
- Produces:

```ts
export type MemberProfileProject = {
  id: string;
  name: string;
  clientId: string;
  clientName: string;
};

export type MemberProfile = {
  id: string;
  name: string;
  initials: string;
  title: string | null;
  active: boolean;
  tasks: TaskListRow[];
  projects: MemberProfileProject[];
};

export async function getMemberProfile(
  db: PrismaClient,
  userId: string,
  input?: { status?: TaskStatusFilter | null }
): Promise<MemberProfile | null>;
```

**Three queries, constant.** The project list gets its own query on purpose: folding it out of the filtered task rows would make it empty when the page is filtered to Done, and "projects they are active on" must not move when a view filter moves.

- [ ] **Step 1: Write the failing tests**

Append to `tests/team-queries.test.ts`. This needs a second fake, because `listTeamCards`'s fake has no `task` or `user.findUnique` delegate:

```ts
type ProfileParts = {
  member?: { id: string; name: string; title: string | null; active: boolean } | null;
  tasks?: unknown[];
  projectRows?: { project: { id: string; name: string; clientId: string; client: { name: string } } | null }[];
};

function fakeProfileDb(parts: ProfileParts) {
  const calls = { userFindUnique: 0, taskFindMany: 0 };
  const taskFindManyArgs: unknown[] = [];

  const db = {
    user: {
      findUnique: async () => {
        calls.userFindUnique++;
        return parts.member ?? null;
      },
    },
    task: {
      findMany: async (args: unknown) => {
        calls.taskFindMany++;
        taskFindManyArgs.push(args);
        // First call is listAssignedTasks; second is the project query.
        return calls.taskFindMany === 1 ? (parts.tasks ?? []) : (parts.projectRows ?? []);
      },
    },
  } as unknown as PrismaClient;

  return { db, calls: () => ({ ...calls }), taskFindManyArgs };
}

const MEMBER = { id: "u1", name: "Dana Reeve", title: "Designer", active: true };

const projectRow = (id: string, name: string) => ({
  project: { id, name, clientId: "c1", client: { name: "Harlow & Fitch" } },
});

describe("getMemberProfile", () => {
  it("returns null for an unknown member and issues no task query", async () => {
    const { db, calls } = fakeProfileDb({ member: null });
    expect(await getMemberProfile(db, "ghost")).toBeNull();
    expect(calls().taskFindMany).toBe(0);
  });

  it("issues exactly three queries whatever the row count", async () => {
    const { db, calls } = fakeProfileDb({
      member: MEMBER,
      projectRows: [projectRow("p1", "Brand Guidelines v3"), projectRow("p2", "Launch Toolkit")],
    });
    await getMemberProfile(db, "u1");
    expect(calls()).toEqual({ userFindUnique: 1, taskFindMany: 2 });
  });

  it("lists each project once however many tasks the member holds on it", async () => {
    const { db } = fakeProfileDb({
      member: MEMBER,
      projectRows: [projectRow("p1", "Brand Guidelines v3"), projectRow("p1", "Brand Guidelines v3")],
    });
    const profile = await getMemberProfile(db, "u1");
    expect(profile?.projects).toEqual([
      { id: "p1", name: "Brand Guidelines v3", clientId: "c1", clientName: "Harlow & Fitch" },
    ]);
  });

  // A personal task has no project to contribute. Prisma returns project:
  // null for it, and an unguarded fold would push undefined into the list.
  it("skips personal tasks when building the project list", async () => {
    const { db } = fakeProfileDb({
      member: MEMBER,
      projectRows: [{ project: null }, projectRow("p1", "Brand Guidelines v3")],
    });
    const profile = await getMemberProfile(db, "u1");
    expect(profile?.projects).toHaveLength(1);
    expect(profile?.projects[0].id).toBe("p1");
  });

  // The whole reason the project list has its own query. If it folded out of
  // the filtered task rows, filtering to Done would claim the member is
  // active on nothing.
  it("returns the same project list with a status filter as without one", async () => {
    const rows = [projectRow("p1", "Brand Guidelines v3")];
    const unfiltered = fakeProfileDb({ member: MEMBER, projectRows: rows });
    const filtered = fakeProfileDb({ member: MEMBER, projectRows: rows });

    const a = await getMemberProfile(unfiltered.db, "u1");
    const b = await getMemberProfile(filtered.db, "u1", { status: "DONE" });
    expect(b?.projects).toEqual(a?.projects);
  });

  it("excludes DONE tasks from the project query", async () => {
    const { db, taskFindManyArgs } = fakeProfileDb({ member: MEMBER });
    await getMemberProfile(db, "u1");
    expect(taskFindManyArgs[1]).toMatchObject({
      where: { assignees: { some: { userId: "u1" } }, status: { not: "DONE" } },
    });
  });

  it("carries the member's own fields and derived initials", async () => {
    const { db } = fakeProfileDb({ member: { ...MEMBER, active: false } });
    const profile = await getMemberProfile(db, "u1");
    expect(profile).toMatchObject({
      id: "u1",
      name: "Dana Reeve",
      initials: "DR",
      title: "Designer",
      active: false,
    });
  });
});
```

Add `getMemberProfile` to the existing import from `@/lib/team-queries`.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/team-queries.test.ts -t getMemberProfile`
Expected: FAIL — `getMemberProfile is not a function`.

- [ ] **Step 3: Implement**

Add to `src/lib/team-queries.ts` (extend the imports with `listAssignedTasks` and the types):

```ts
import { listAssignedTasks, type TaskListRow } from "@/lib/task-queries";
import { openTaskSummary, sortMyTasks, type TaskPriority, type TaskStatusFilter } from "@/lib/task";

export type MemberProfileProject = {
  id: string;
  name: string;
  clientId: string;
  clientName: string;
};

export type MemberProfile = {
  id: string;
  name: string;
  initials: string;
  title: string | null;
  active: boolean;
  tasks: TaskListRow[];
  projects: MemberProfileProject[];
};

/** One member's page: their assigned tasks under whatever filter the URL
 * carries, plus the projects they are active on.
 *
 * Three queries, constant regardless of row count. The project list is its
 * own query deliberately — folding it out of the filtered task rows would be
 * two, but then filtering the page to Done would empty it and the member
 * would appear active on nothing. "Projects they are active on" is a fact
 * about the member, not about the current view. */
export async function getMemberProfile(
  db: PrismaClient,
  userId: string,
  input: { status?: TaskStatusFilter | null } = {}
): Promise<MemberProfile | null> {
  const member = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, title: true, active: true },
  });
  if (!member) return null;

  const tasks = await listAssignedTasks(db, { userId, status: input.status });

  const projectRows = await db.task.findMany({
    where: { assignees: { some: { userId } }, status: { not: "DONE" } },
    select: {
      project: { select: { id: true, name: true, clientId: true, client: { select: { name: true } } } },
    },
  });

  const projects = new Map<string, MemberProfileProject>();
  for (const row of projectRows) {
    // A personal task has no project to contribute.
    if (!row.project) continue;
    if (projects.has(row.project.id)) continue;
    projects.set(row.project.id, {
      id: row.project.id,
      name: row.project.name,
      clientId: row.project.clientId,
      clientName: row.project.client.name,
    });
  }

  return {
    id: member.id,
    name: member.name,
    initials: clientInitials(member.name),
    title: member.title,
    active: member.active,
    tasks,
    projects: [...projects.values()],
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/team-queries.test.ts`
Expected: all passed, including the 7 new ones.

- [ ] **Step 5: Full suite**

Run: `npm test`
Expected: 468 passed.

- [ ] **Step 6: Commit**

```bash
git add src/lib/team-queries.ts tests/team-queries.test.ts
git commit -m "feat: member profile read model with a filter-independent project list"
```

---

### Task 6: `/team/[memberId]` page and links from the grid

**Files:**
- Create: `src/app/(app)/team/[memberId]/page.tsx`
- Modify: `src/components/team/member-card.tsx`
- Test: none (browser QA, Task 8)

**Interfaces:**
- Consumes: `getMemberProfile` (Task 5), `parseTaskStatusFilter`, `taskListSummary`, `<TaskRow>`, `<TaskStatusFilter>`, `<InitialsAvatar>`, `<EmptyState>`, `<Badge>`.

- [ ] **Step 1: Build the page**

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getMemberProfile } from "@/lib/team-queries";
import { parseTaskStatusFilter, taskListSummary } from "@/lib/task";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { InitialsAvatar } from "@/components/ui/initials-avatar";
import { TaskRow } from "@/components/tasks/task-row";
import { TaskStatusFilter } from "@/components/tasks/task-status-filter";

export default async function MemberProfilePage(props: {
  params: Promise<{ memberId: string }>;
  searchParams: Promise<{ status?: string | string[] }>;
}) {
  const { memberId } = await props.params;
  const raw = await props.searchParams;
  const status = parseTaskStatusFilter(raw.status);

  const profile = await getMemberProfile(prisma, memberId, { status });
  if (!profile) notFound();

  return (
    <div className="space-y-6 p-8">
      <nav className="text-xs text-[var(--text-3)]">
        <Link href="/team" className="hover:text-[var(--text-2)]">
          Team
        </Link>
        <span> / </span>
        <span className="text-[var(--text-2)]">{profile.name}</span>
      </nav>

      <div className="flex items-center gap-3">
        <InitialsAvatar initials={profile.initials} shape="circle" size={48} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold text-[var(--text)]">{profile.name}</h1>
            {profile.active ? null : <Badge kind="neutral">Deactivated</Badge>}
          </div>
          {profile.title ? <p className="text-sm text-[var(--text-3)]">{profile.title}</p> : null}
        </div>
      </div>

      {profile.projects.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {profile.projects.map((p) => (
            <Link
              key={p.id}
              href={`/projects/${p.id}`}
              className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-2)] hover:bg-[var(--surface-2)]"
            >
              {p.clientName} · {p.name}
            </Link>
          ))}
        </div>
      ) : null}

      <div className="flex items-baseline gap-2">
        <h2 className="text-lg font-medium text-[var(--text)]">Tasks</h2>
        <span className="text-xs text-[var(--text-3)]">
          {taskListSummary(profile.tasks, { filtered: status !== "ALL" })}
        </span>
      </div>

      <TaskStatusFilter status={status} />

      {profile.tasks.length === 0 ? (
        <EmptyState message="Nothing assigned." />
      ) : (
        <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)]">
          {profile.tasks.map((row) => (
            <TaskRow key={row.id} row={row} />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Link the member card to it**

In `src/components/team/member-card.tsx`, wrap the name block. Replace lines 19–25 (the `<div className="flex min-w-0 items-center gap-3">` block) with:

```tsx
        <Link href={`/team/${card.id}`} className="flex min-w-0 items-center gap-3">
          <InitialsAvatar initials={card.initials} shape="circle" size={40} />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-[var(--text)] hover:underline">
              {card.name}
            </p>
            {card.title ? <p className="truncate text-xs text-[var(--text-3)]">{card.title}</p> : null}
          </div>
        </Link>
```

`Link` is already imported in that file.

- [ ] **Step 3: Gates**

Run: `npx tsc --noEmit` → exits 0.
Run: `npm run lint` → clean.
Run: `npm run build` → succeeds, route list includes `/team/[memberId]`.

Run: `git grep -nE "dark:|#[0-9a-fA-F]{3,6}" -- "src/app/(app)/team" src/components/team`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/team" src/components/team
git commit -m "feat: member profile page answering what one person is working on"
```

---

### Task 7: Global quick-add

**Files:**
- Create: `src/components/tasks/quick-add.tsx`
- Modify: `src/app/(app)/layout.tsx`, `src/components/shell/topbar.tsx`
- Test: none (browser QA, Task 8)

**Interfaces:**
- Consumes: `createTaskAction` from `@/server/actions/tasks`.
- Produces: `<QuickAdd members={{ id: string; name: string }[]} />`, rendered by `<Topbar>`.

**Critical:** `createTaskAction` rejects a missing or invalid status — that was changed in the 3a follow-up wave. The panel **must** submit hidden `status="TO_DO"` and `priority="MEDIUM"`, or every submit fails with "Invalid input".

- [ ] **Step 1: Build `quick-add.tsx`**

```tsx
"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createTaskAction } from "@/server/actions/tasks";

/** A popover, not a modal: no backdrop, no focus trap, no scroll lock. That
 * boundary is what keeps 3a's D6 ("no overlay primitive") from quietly
 * becoming an overlay system. Capture is title + assignees only; the created
 * task is a personal TO_DO/MEDIUM and the success link is how you reach
 * everything else. */
export function QuickAdd({ members }: { members: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const [state, formAction, pending] = useActionState(
    async (prev: Awaited<ReturnType<typeof createTaskAction>> | null, formData: FormData) => {
      const result = await createTaskAction(prev, formData);
      if (result.ok) {
        setCreatedId(result.data.id);
        setTitle("");
        setAssigneeIds([]);
      } else {
        setAttempt((a) => a + 1);
      }
      return result;
    },
    null
  );

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  function toggle(id: string) {
    setAssigneeIds((ids) => (ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id]));
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          setCreatedId(null);
        }}
        className="rounded-md border border-[var(--border)] px-2 py-1 text-sm text-[var(--text-2)] hover:bg-[var(--surface-3)]"
      >
        Quick add
      </button>

      {open ? (
        <div className="absolute right-0 z-20 mt-2 w-72 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 shadow-lg">
          <form key={attempt} action={formAction} className="space-y-3">
            {/* createTaskAction rejects a missing or invalid status. */}
            <input type="hidden" name="status" value="TO_DO" />
            <input type="hidden" name="priority" value="MEDIUM" />

            <input
              name="title"
              required
              placeholder="Task title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--text)]"
            />

            <div className="max-h-40 space-y-1 overflow-y-auto">
              {members.map((m) => (
                <label key={m.id} className="flex items-center gap-2 text-sm text-[var(--text)]">
                  <input
                    type="checkbox"
                    name="userId"
                    value={m.id}
                    checked={assigneeIds.includes(m.id)}
                    onChange={() => toggle(m.id)}
                    className="h-4 w-4 rounded border-[var(--border)]"
                  />
                  {m.name}
                </label>
              ))}
            </div>

            {state && !state.ok ? <p className="text-xs text-[var(--bad)]">{state.error}</p> : null}

            {createdId ? (
              <Link
                href={`/tasks/${createdId}`}
                onClick={() => setOpen(false)}
                className="block text-xs text-[var(--accent)] hover:underline"
              >
                Task created — open it
              </Link>
            ) : null}

            <button
              type="submit"
              disabled={pending}
              className="w-full rounded-md bg-[var(--btn)] px-3 py-1.5 text-sm text-[var(--on-btn)] hover:bg-[var(--btn-h)] disabled:opacity-50"
            >
              {pending ? "Saving…" : "Save"}
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Fetch the member list once in the layout**

In `src/app/(app)/layout.tsx`, add `import { prisma } from "@/lib/prisma";`, then after the session guard:

```tsx
  const members = await prisma.user.findMany({
    where: { active: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
```

and pass it down:

```tsx
        <Topbar userName={session.user.name ?? ""} signOutAction={signOutAction} members={members} />
```

- [ ] **Step 3: Render it in the topbar**

In `src/components/shell/topbar.tsx`, add the import and the prop:

```tsx
import { QuickAdd } from "@/components/tasks/quick-add";
```
```tsx
export function Topbar({
  userName,
  signOutAction,
  members,
}: {
  userName: string;
  signOutAction: () => Promise<void>;
  members: { id: string; name: string }[];
}) {
```

Then inside the right-hand `<div className="flex items-center gap-3">`, add `<QuickAdd members={members} />` as the **first** child, before the theme button.

- [ ] **Step 4: Gates**

Run: `npx tsc --noEmit` → exits 0.
Run: `npm run lint` → clean.
Run: `npm run build` → succeeds.

Run: `git grep -nE "dark:|#[0-9a-fA-F]{3,6}" -- src/components/tasks src/components/shell`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/components/tasks/quick-add.tsx src/components/shell/topbar.tsx "src/app/(app)/layout.tsx"
git commit -m "feat: global quick add for task capture from any page"
```

---

### Task 8: Browser QA and final gates

Per spec §2, this is the phase's **primary** verification, not a formality. Nothing above this task has a unit test covering drag, optimism, rollback or any page. Budget real time for it.

**Setup:** you need an authenticated session. Do not ask for or handle the owner's real password. Create a temporary account, and delete it plus every task, activity row and edit it produces when finished — the 3a QA is the model.

- [ ] **Step 1: Board QA — execute every line and record the result**

1. `/projects/{id}/board` shows four columns headed exactly "To Do", "In Progress", "Review", "Done", each with a count.
2. The breadcrumb reads `Clients / {client} / {project} / Board`, and the client and project segments both link.
3. A project with no tasks reads exactly "No tasks yet."; an empty column on a board that has tasks shows **no text** and still accepts a drop.
4. Dragging a card to another column moves it **immediately**, before the request finishes.
5. The column under the cursor highlights on drag-over and stops highlighting after the drop.
6. Reloading confirms the move persisted.
7. Dropping a card back on its own column does nothing, writes no activity row, and issues no request.
8. Every card still shows its status select, and changing status that way moves the card identically.
9. Each move writes exactly one `task.status_changed` row on the client timeline — not two, and not one per re-render.
10. Moving a card to Done raises the project's AUTO progress; the same value appears on the project page, `/projects` and the client page. Moving one to Review does not change it.
11. **Rollback:** with the board open in two tabs, delete the task in tab A, then drag that same card in tab B. The card **disappears cleanly**, with no board-wide error banner. (This item originally asserted a per-card "Task not found". That cannot happen: `setTaskStatusAction` revalidates unconditionally, so the row is revalidated away before an error could render. Corrected and re-run 2026-08-01 — see `phase-3b-followups.md`, ruling 1.)
12. Both themes render via the topbar toggle; the grid reflows sensibly at a narrow width.

- [ ] **Step 2: Member profile QA**

1. Each `/team` card's name links to `/team/{id}`.
2. The breadcrumb reads `Team / {member}`.
3. The task list shows that member's open tasks, each row naming its client and project.
4. The status filter narrows the list, the URL carries `?status=`, and it survives a reload and a paste into a new tab.
5. **The project chips do not change when the filter changes** — including filtering to Done. This is the defect the third query exists to prevent.
6. A member with no matching tasks reads exactly "Nothing assigned."
7. A member whose only tasks are personal shows no project chips.
8. A deactivated member's page still renders and shows the "Deactivated" badge; `/team` no longer lists them.
9. `/team/does-not-exist` renders the 404 UI.

- [ ] **Step 3: Quick-add QA**

1. "Quick add" appears in the topbar on every `(app)` page.
2. It opens a panel with a title field and the active-member checkboxes.
3. Saving with a title and one assignee creates a personal task; the panel offers a link to it and the task appears on that assignee's `/my-tasks`.
4. **Submitting succeeds** — if it returns "Invalid input", the hidden `status`/`priority` fields are missing (see Task 7).
5. A blank title is rejected and the assignee checkboxes keep their state.
6. Escape closes the panel; clicking outside closes it.
7. From a cold page load, creating and assigning a task takes **under 15 seconds** (spec §11).

- [ ] **Step 4: Final gates**

Run: `npm test` → 468 passed.
Run: `npx tsc --noEmit` → exits 0.
Run: `npm run lint` → clean.
Run: `npm run build` → succeeds.

Run: `git grep -nE "dark:|#[0-9a-fA-F]{3,6}" -- 'src/**/*.tsx' 'src/**/*.ts'`
Expected: no output. (Scoped to TS/TSX deliberately. The unscoped form over `src/app src/components src/lib` always matches `src/app/globals.css`, where the tokens are *defined*, so it reports failure on a clean tree every time — see `phase-3b-followups.md`, ruling 2.)

- [ ] **Step 5: Tear down the QA data and record the results**

Delete the temporary account and everything it created; restore any member you deactivated. Verify against the database, not from memory.

Write the outcome to `docs/superpowers/plans/phase-3b-followups.md`: every QA line with its result, anything **not** exercised stated explicitly rather than skipped silently, and any follow-up worth carrying.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/plans/phase-3b-followups.md
git commit -m "docs: record Phase 3b browser QA results"
```

---

## Phase 3b Done Criteria

- [ ] A project's board shows every task in four columns, and dragging a card to another column changes its status.
- [ ] The moved card appears in its new column before the server responds.
- [ ] A rejected move returns the card to its original column and shows the reason on that card.
- [ ] Dropping a card on its own column writes nothing and logs nothing.
- [ ] Every card still offers its status select, and moving a task that way works identically.
- [ ] Each move writes exactly one correctly scoped `task.status_changed` row, visible on the client timeline.
- [ ] Completing a task on the board moves the project's AUTO progress on the project page, `/projects` and the client page.
- [ ] `/team/[memberId]` lists that member's tasks with a status filter that survives a reload, plus the projects they are active on.
- [ ] The project list on a profile is identical with and without a status filter.
- [ ] A deactivated member's profile renders and is marked; the Team grid does not link to it.
- [ ] Quick-add creates an assigned personal task from any page, and it appears on its assignees' My Tasks.
- [ ] All Vitest suites pass; `npx tsc --noEmit` clean; `npm run lint` clean; `npm run build` succeeds.
- [ ] No `dark:` variant and no hardcoded palette colour anywhere in `src/`.
