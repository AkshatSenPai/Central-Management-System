# Phase 2 — Clients & Projects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship client records with contacts, projects with milestones, auto/manual progress, health flags, and a per-client activity timeline — so a client's page answers "how is this client's work going?" without asking anyone.

**Architecture:** Five new Prisma models behind pure, unit-tested domain modules. All logic lives in `src/lib/*` as `db`-injected functions returning `ActionResult`; server actions stay thin (guard → coerce → validate → delegate → revalidate); pages are server components composing tested read models. Progress computation is deliberately split into a pure `computeProgress` plus a batched `getProjectProgressCounts` provider — the single function Phase 3 rewrites to make progress task-based.

**Tech Stack:** Next.js 16 (App Router, Server Actions) · Prisma 7 + Neon Postgres (`PrismaPg` adapter) · zod 4 · Vitest (node env, hand-rolled fakes) · Tailwind v4 with CSS-variable design tokens.

**Inputs:** spec `docs/superpowers/specs/2026-07-29-internal-cms-design.md` (§5.2, §7, §10, §11) · design reference `docs/design/meridian-ops/desktop.html` · decomposition brief `.superpowers/phase-2-intel/DECOMPOSITION.md` (gitignored; read it if you need the reasoning behind a decision).

---

## Global Constraints

- TypeScript strict mode; App Router only. Path alias `@/*` → `src/*`. Tests live in `tests/`, run with `npm test` (Vitest, `node` environment). Type gate is `npx tsc --noEmit`; lint gate is `npm run lint`.
- All Server Actions and all service functions return `ActionResult<T>` (from `src/lib/action-result.ts`) — never throw to the client, never fail silently. **Read functions (`*-queries.ts`) return plain data or `null`, never `ActionResult`.**
- Business logic lives in `src/lib/*` as functions taking `db: PrismaClient` first, so it is unit-testable with fake DB objects. Server actions are thin: guard, coerce FormData, `safeParse`, delegate, `revalidatePath`. **No business rule and no arithmetic is written inside a server action or a React component.**
- **Every activity-log write happens in the service layer, inside the same transaction as its mutation, via `recordActivity`.** Actions never write activity.
- `ActivityLog.entityType` and `ActivityLog.action` are plain `String` columns typed as TypeScript unions — never Prisma enums, so Phase 3 adds verbs without a migration. `describeActivity` must have a safe fallback for unrecognised actions.
- `ActivityLog.clientId` is a denormalised scope column with **no Prisma relation and no `onDelete`**. Do not "fix" it by adding a relation — the audit trail must survive a client hard-delete.
- Progress is computed only by `computeProgress` in `src/lib/progress.ts`, fed by `getProjectProgressCounts` in `src/lib/project-queries.ts`. That provider takes an array of ids and returns a `Map` — it is the anti-N+1 boundary and the single function Phase 3 rewrites.
- **AUTO progress means completed units ÷ total units, where a unit is the finest-grained trackable work item the project has.** In Phase 2 that unit is the milestone. Project rows render `{N} milestones` (not the design's `{N} tasks`) so the basis change is visible in the same release that makes it.
- Roles: exactly one Phase 2 mutation is `requireAdmin` — `deleteClientAction`. Everything else is `requireUser`, because spec §3 gives Members "manage clients & projects".
- Clients are deleted only when they have no projects; projects are never deleted in Phase 2. `ClientStatus.FORMER` and `ProjectStatus.DONE` are the everyday retirement paths.
- **Prisma 7:** the datasource URL lives in `prisma.config.ts`, never as `url = env("DATABASE_URL")` in `schema.prisma`. `new PrismaClient()` appears only in `src/lib/prisma.ts` and `prisma/seed.ts`, always with the `PrismaPg` adapter. Run `npx prisma generate` after every schema edit (pinned legacy `prisma-client-js` generator). Imports are `from "@prisma/client"`, never a custom output path. `meta Json?` is written as `Prisma.InputJsonValue | typeof Prisma.DbNull` and read back as `Prisma.JsonValue`.
- **Next 16:** `params` and `searchParams` are `Promise`s and must be awaited. Type them explicitly the way Phase 1's `src/app/(auth)/invite/[token]/page.tsx` does (`props: { params: Promise<{ clientId: string }> }`) — that form is proven to compile in this repo. `notFound()` from `next/navigation` for unknown ids. `revalidatePath` is called with literal paths only, so its `type` argument is never needed.
- **zod 4:** `import { z } from "zod"` (not the `zod/v4` subpath). Schemas are a named `xSchema` const plus an inferred `XInput`, living in `src/lib/<domain>.ts`. Optional text fields use `.optional().or(z.literal(""))` paired with `field || null` before write. Custom messages are the second positional argument. Always `safeParse`, surfacing `parsed.error.issues[0]?.message ?? "Invalid input"`.
- **Dates:** `<input type="date">` submits `"YYYY-MM-DD"`. `parseDateInput` is the only parser; `toDateInputValue` is the only way to repopulate an edit form. `shortDate` and `monthYear` pin `"en-GB"` and UTC so `"12 Jun"` and `"Mar 2024"` are stable everywhere.
- **Styling:** every colour is the Tailwind arbitrary form `[var(--token)]`. There is no Tailwind config mapping these to named utilities, so `bg-surface` does not exist. **Never write a `dark:` variant** — `data-theme` plus CSS variables already handle both themes. Progress-bar fill is always `--text-2`; the badge carries health, the bar never does. No hardcoded hex or Tailwind palette colours.
- **Tests:** hand-rolled closure fakes only. Zero `vi.fn`, `vi.spyOn`, `vi.mock`, `@testing-library/react`, jsdom. `ActionResult` failures asserted with whole-object `toEqual` against exact literal error strings. React components and server actions are deliberately untested — do not add a harness for them.
- **No later-phase scope.** The design file renders the finished product across all phases. If a field is not in this plan's schema, it is not stored and not rendered. Specifically: no invoices, no Outstanding column, no Account/retainer card, no budget hours, no meeting notes, no avatar stacks, no `ProjectMember` table, no tab bars, no kanban.
- **Parallel branch:** `claude/xenodochial-robinson-302ae8` is mid-flight on the Phase 1 follow-ups. Phase 2 treats `src/lib/prisma.ts` as read-only and must not touch `src/lib/member-service.ts`, `src/app/(app)/dashboard/page.tsx`, `src/components/members/*` or `public/`.
- Commands shown as `npx`/`npm` run the same in PowerShell; PowerShell-specific syntax is called out where it differs.

---

## Decisions (settled — do not relitigate)

| # | Decision |
|---|---|
| D1 | **AUTO progress = completed milestones ÷ total milestones** in Phase 2. Seam = pure `computeProgress(project, counts)` + batched `getProjectProgressCounts(db, ids): Promise<Map<string, ProgressCounts>>`. Phase 3 rewrites only that provider's body. `progressMode`/`manualProgress` ship real. |
| D2 | **AUTO with zero milestones never renders `0%`.** `computeProgress` returns `ProgressView { percent, mode, hasUnits, label }`; `hasUnits: false` renders `—` plus "Add milestones or set progress manually". |
| D3 | **Health is a manual stored enum** (`ON_TRACK`/`AT_RISK`/`BLOCKED`, default `ON_TRACK`). No derivation, no suggestion engine. Every change logs `project.health_changed` with `meta { from, to }`. Overdue-ness is a separate derived styling cue that never mutates health. |
| D4 | **One generic `ActivityLog`** per spec §7, plus a denormalised nullable `clientId` scope column with `@@index([clientId, at])`, **no relation, no `onDelete`**. Writes happen in the service layer inside the mutation's transaction via `recordActivity(db: Pick<PrismaClient, "activityLog">, input)`. |
| D5 | **Four flat routes:** `/clients`, `/clients/[clientId]`, `/projects` (global, `?health=` filter), `/projects/[projectId]`. Projects are not nested under clients. No `/new` or `/edit` segments — create/edit are inline `useActionState` forms. **No tab bar on either detail page.** |
| D6 | **Contacts are inline** on client detail (sidebar card), full CRUD plus a dedicated `setPrimaryContact`. `ClientContact.isPrimary` added. First contact auto-primary; set-primary demotes-then-promotes in one interactive `$transaction`; **`updateContact` never reads `isPrimary`**; removing the primary promotes nobody. |
| D7 | **Client hard-delete is ADMIN-only and blocked while the client has any project** (`"Remove this client's projects before deleting"`), enforced twice: service pre-check + DB `ON DELETE RESTRICT`, with the P2003 race mapped to the same string. Projects are never deleted in Phase 2. Contacts and milestones hard-delete and cascade from their parent. ActivityLog is never deleted. |
| D8 | **Milestones:** `order` assigned `max+1` on create, read `order asc, createdAt asc`. **Reordering is not built at all** — `order` is stored-but-inert. Completion is the single `completedAt` timestamp. The three display states are **derived, never stored**: `completedAt` set → completed; lowest-ordered incomplete → in_progress; every later incomplete → not_started. |
| D9 | **Client carries the design's full header fields** (owner decision, 2026-07-30): `sector`, `website`, `engagementType`, `clientSince`, and an `accountLead` relation to `User`. The design's Outstanding column, Account card, Meeting-notes tab and Invoices tab are **not** built — they belong to Phases 6/7. |

---

## File Structure

**Pure modules** (`src/lib/`, no Prisma, no Next, no I/O — all TDD'd):

| File | Responsibility |
|---|---|
| `dates.ts` | Date-input parsing/formatting, short date, month-year, overdue-ness, relative time — injectable clock. |
| `progress.ts` | AUTO/MANUAL progress calculation and the `ProgressView` shape. |
| `milestones.ts` | Sort order, derived three-state vocabulary, meta strings, dot mapping, counts, next order. |
| `client.ts` | Client + contact zod schemas, status label/badge maps, initials, list summary. |
| `project.ts` | Project + milestone zod schemas, status/health label + badge maps, `BadgeKind`, colour index, summaries, health-filter parsing. |

**Domain modules** (`src/lib/`, `db`-injected — all TDD'd):

| File | Responsibility |
|---|---|
| `activity.ts` | `recordActivity` writer, `fieldDiff`, pure `describeActivity`, `listClientActivity` reader. |
| `client-service.ts` | `createClient`, `updateClient`, `deleteClient`. |
| `contact-service.ts` | `addContact`, `updateContact`, `setPrimaryContact`, `removeContact`. |
| `project-service.ts` | `createProject`, `updateProject`, `setProjectStatus`, `setProjectHealth`, `setProjectProgress`. |
| `milestone-service.ts` | `addMilestone`, `updateMilestone`, `setMilestoneComplete`, `removeMilestone`. |
| `client-queries.ts` | `listClients`, `getClientDetail`. |
| `project-queries.ts` | `getProjectProgressCounts` (**the Phase 3 swap point**), `listProjects`, `getProjectDetail`. |

**Actions** (`src/server/actions/`): `clients.ts` (client + contact actions), `projects.ts` (project + milestone actions).

**Components** (`src/components/`): `ui/{badge,progress-bar,initials-avatar,page-header,empty-state}.tsx`, `activity/activity-timeline.tsx`, `clients/{client-form,client-delete-button,contact-list,contact-form}.tsx`, `projects/{project-form,project-row,project-health-control,progress-control,health-filter,milestone-strip,milestone-form}.tsx`.

**Pages:** `(app)/clients/page.tsx` (modify), `(app)/clients/[clientId]/page.tsx` (create), `(app)/projects/page.tsx` (modify), `(app)/projects/[projectId]/page.tsx` (create).

**Schema:** `prisma/schema.prisma` (modify), one generated migration (create), `prisma/seed.ts` (modify — demo data behind `SEED_DEMO=true`).

---

## Vocabulary Lock

These exact strings. No synonyms, no re-casing.

- **Client status:** `ACTIVE` → "Active" (badge `ok`) · `PAUSED` → "Paused" (`neutral`) · `FORMER` → "Former" (`neutral`)
- **Project status:** `PLANNING` → "Planning" · `IN_PROGRESS` → "In Progress" · `ON_HOLD` → "On Hold" · `DONE` → "Done"
- **Project health:** `ON_TRACK` → "On Track" (`ok`) · `AT_RISK` → "At Risk" (`warn`) · `BLOCKED` → "Blocked" (`bad`)
- **Milestone meta:** "Completed 12 Jun" · "In progress · due 14 Aug" · "Not started · due 29 Aug" · "In progress" / "Not started" when there is no due date. Dots: completed → `ok`, in_progress → `strong`, not_started → `mute`.
- **Column headers** — Clients list: `Client` · `Status` · `Projects` · `Primary contact`. Projects list: `Project` · `Client` · `Progress` · `Health` · `Due`.
- **Summary lines** — Clients: `"5 clients · 4 active"` / `"1 client · 1 active"`. Projects: `"6 active projects across 5 clients"` / `"1 active project across 1 client"` / `"No projects yet"`. Client-detail Projects header count: `"2 active"`.
- **Project row subtitle:** `"{N} milestones · due {date}"` / `"1 milestone · due {date}"` / `"No milestones · due {date}"`, dropping the ` · due {date}` clause when there is no due date.
- **Progress phrasing:** `"{N}% complete"` on project detail; bare `"{N}%"` on rows; `"—"` plus "Add milestones or set progress manually" when AUTO has no units.
- **Client meta chips:** `"Account lead {name}"` · `"Client since Mar 2024"` · website domain as-is · sector as-is · engagement type in a `neutral` badge.
- **Breadcrumbs:** client detail `Clients / {client name}` · project detail `Clients / {client name} / Project` (the literal word "Project").
- **Buttons:** "New client" · "New project" · "Edit" · "Add milestone" · "Add contact" · "Make primary" · "Remove" · "Delete client" (admin only) · "Save" / "Saving…".
- **Empty states** (muted `--text-3` sentence + one inline bold link, no illustration): clients list "No clients yet. Add your first client." · projects list "No projects yet. Create one from a client's page." · filtered "No projects match this health filter." · client detail no projects "No projects for this client yet." · no contacts "No contacts yet." · no activity "Nothing has happened here yet." · project detail no milestones "No milestones yet."
- **Service error strings** (asserted verbatim in tests): `"Client name is required"` · `"Contact name is required"` · `"Enter a valid email address"` · `"Website must be an http(s) URL"` · `"A client with this name already exists"` · `"Client not found"` · `"Contact not found"` · `"Remove this client's projects before deleting"` · `"Project name is required"` · `"Due date cannot be before the start date"` · `"A project with this name already exists for this client"` · `"Project not found"` · `"Progress must be a whole number between 0 and 100"` · `"Milestone title is required"` · `"Milestone not found"` · `"Invalid input"`

---

### Task 1: Schema, migration and demo seed

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_clients_and_projects/migration.sql` (CLI-generated, committed)
- Modify: `prisma/seed.ts`
- Test: none — schema task, non-TDD, mirroring Phase 1's Task 2.

**Interfaces:**
- Consumes: Phase 1 schema style (singular PascalCase models, `id String @id @default(cuid())`, camelCase fields, `createdAt`/`updatedAt` on domain models, explicit FK pairs, named `@relation` where a model may gain multiple relations to the same target); Prisma 7 workflow; `prisma/seed.ts`'s `import "dotenv/config"` + `PrismaPg` adapter + idempotent upsert.
- Produces: delegates `prisma.client`, `prisma.clientContact`, `prisma.project`, `prisma.milestone`, `prisma.activityLog`; enum literal unions `ClientStatus`, `ProjectStatus`, `ProjectHealth`, `ProgressMode`.

- [ ] **Step 1: Add enums and models to `prisma/schema.prisma`**

Append below the existing models:

```prisma
enum ClientStatus {
  ACTIVE
  PAUSED
  FORMER
}

enum ProjectStatus {
  PLANNING
  IN_PROGRESS
  ON_HOLD
  DONE
}

enum ProjectHealth {
  ON_TRACK
  AT_RISK
  BLOCKED
}

enum ProgressMode {
  AUTO
  MANUAL
}

model Client {
  id             String          @id @default(cuid())
  name           String          @unique
  status         ClientStatus    @default(ACTIVE)
  sector         String?
  website        String?
  engagementType String?
  clientSince    DateTime?
  notes          String?
  accountLead    User?           @relation("ClientAccountLead", fields: [accountLeadId], references: [id])
  accountLeadId  String?
  contacts       ClientContact[]
  projects       Project[]
  createdAt      DateTime        @default(now())
  updatedAt      DateTime        @updatedAt

  @@index([accountLeadId])
}

model ClientContact {
  id        String   @id @default(cuid())
  client    Client   @relation(fields: [clientId], references: [id], onDelete: Cascade)
  clientId  String
  name      String
  email     String?
  phone     String?
  role      String?
  isPrimary Boolean  @default(false)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([clientId])
}

model Project {
  id             String        @id @default(cuid())
  client         Client        @relation(fields: [clientId], references: [id])
  clientId       String
  name           String
  description    String?
  status         ProjectStatus @default(PLANNING)
  health         ProjectHealth @default(ON_TRACK)
  progressMode   ProgressMode  @default(AUTO)
  manualProgress Int?
  startDate      DateTime?
  dueDate        DateTime?
  milestones     Milestone[]
  createdAt      DateTime      @default(now())
  updatedAt      DateTime      @updatedAt

  @@unique([clientId, name])
  @@index([clientId])
}

model Milestone {
  id          String    @id @default(cuid())
  project     Project   @relation(fields: [projectId], references: [id], onDelete: Cascade)
  projectId   String
  title       String
  dueDate     DateTime?
  completedAt DateTime?
  order       Int
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  @@index([projectId])
}

model ActivityLog {
  id         String   @id @default(cuid())
  actor      User     @relation("ActivityActor", fields: [actorId], references: [id])
  actorId    String
  entityType String
  entityId   String
  action     String
  meta       Json?
  clientId   String?
  at         DateTime @default(now())

  @@index([clientId, at])
  @@index([entityType, entityId, at])
}
```

Add exactly these two back-relation lines to the existing `User` model (nothing else on `User` changes):

```prisma
  activity       ActivityLog[] @relation("ActivityActor")
  clientsLed     Client[]      @relation("ClientAccountLead")
```

Why the referential actions are what they are — do not "tidy" them:

| Relation | Rule | Reason |
|---|---|---|
| `ClientContact.client` | `onDelete: Cascade` | Contacts are wholly owned by their client and referenced by nothing in any phase. |
| `Milestone.project` | `onDelete: Cascade` | Milestones are wholly owned by their project; Phase 3's `Task.milestoneId` will be nullable + SetNull. |
| `Project.client` | *(none → RESTRICT)* | DB backstop for D7's "remove this client's projects first" rule; keeps the future `TimeEntry → Task → Project → Client` chain unbreakable. |
| `ActivityLog.actor` | *(none → RESTRICT)* | Users are deactivated, never deleted; free insurance that an audit row keeps its actor. |
| `Client.accountLead` | *(none → SetNull, Prisma's default for an optional relation)* | A client must survive its lead's departure. |
| `ActivityLog.clientId` | **no relation at all** | Scope key, not ownership: no FK means no cascade and no null-out, so the audit trail survives a client hard-delete. |

- [ ] **Step 2: Generate and apply the migration**

Run: `npx prisma migrate dev --name add_clients_and_projects`
Expected: exactly one new timestamped folder under `prisma/migrations/`, applied cleanly, client regenerated.

Then run: `npx prisma generate`
Expected: succeeds.

- [ ] **Step 3: Read the generated SQL and confirm six things by eye**

Open the new `migration.sql` and verify:
1. `Project_clientId_fkey` is `ON DELETE RESTRICT`.
2. `ClientContact_clientId_fkey` and `Milestone_projectId_fkey` are `ON DELETE CASCADE`.
3. **`ActivityLog` has NO `clientId` foreign key constraint at all** — only a plain `TEXT` column and the `@@index`. This is intentional; if a constraint is present, the schema was edited wrongly.
4. `Client_accountLeadId_fkey` is `ON DELETE SET NULL`.
5. `ActivityLog."entityType"` and `ActivityLog."action"` are `TEXT`, not Postgres enum types.
6. The four new enum types (`ClientStatus`, `ProjectStatus`, `ProjectHealth`, `ProgressMode`) exist.

- [ ] **Step 4: Extend the seed with demo data behind a flag**

In `prisma/seed.ts`, leave the existing admin upsert exactly as it is. After it, add a demo block that runs only when `process.env.SEED_DEMO === "true"`, using `upsert` keyed on the unique columns so re-running is a no-op:

```ts
async function seedDemo(prisma: PrismaClient, adminId: string) {
  const harlow = await prisma.client.upsert({
    where: { name: "Harlow & Fitch" },
    update: {},
    create: {
      name: "Harlow & Fitch",
      status: "ACTIVE",
      sector: "Retail & apparel",
      website: "https://harlowfitch.com",
      engagementType: "Retainer",
      clientSince: new Date("2024-03-01T00:00:00Z"),
      accountLeadId: adminId,
      contacts: {
        create: [
          { name: "Dana Reeve", email: "dana@harlowfitch.com", role: "Marketing Director", isPrimary: true },
          { name: "Tom Iversen", email: "tom@harlowfitch.com", role: "Brand Manager" },
        ],
      },
    },
  });

  const verity = await prisma.client.upsert({
    where: { name: "Verity Health" },
    update: {},
    create: {
      name: "Verity Health",
      status: "PAUSED",
      sector: "Healthcare",
      website: "https://verityhealth.example",
      engagementType: "Project",
      clientSince: new Date("2025-01-01T00:00:00Z"),
      contacts: {
        create: [{ name: "Priya Kohli", email: "priya@verityhealth.example", role: "Head of Digital", isPrimary: true }],
      },
    },
  });

  await prisma.project.upsert({
    where: { clientId_name: { clientId: harlow.id, name: "Brand Guidelines v3" } },
    update: {},
    create: {
      clientId: harlow.id,
      name: "Brand Guidelines v3",
      description: "Refresh the identity system and ship a new guidelines site.",
      status: "IN_PROGRESS",
      health: "AT_RISK",
      dueDate: new Date("2026-08-14T00:00:00Z"),
      milestones: {
        create: [
          { title: "Discovery sign-off", order: 0, completedAt: new Date("2026-06-12T00:00:00Z") },
          { title: "Design system freeze", order: 1, completedAt: new Date("2026-07-03T00:00:00Z") },
          { title: "Campaign pages build", order: 2, dueDate: new Date("2026-08-14T00:00:00Z") },
          { title: "Launch & QA", order: 3, dueDate: new Date("2026-08-29T00:00:00Z") },
        ],
      },
    },
  });

  await prisma.project.upsert({
    where: { clientId_name: { clientId: harlow.id, name: "Spring Campaign Site" } },
    update: {},
    create: {
      clientId: harlow.id,
      name: "Spring Campaign Site",
      status: "PLANNING",
      health: "ON_TRACK",
      dueDate: new Date("2026-09-30T00:00:00Z"),
    },
  });

  await prisma.project.upsert({
    where: { clientId_name: { clientId: verity.id, name: "Patient Portal UX" } },
    update: {},
    create: {
      clientId: verity.id,
      name: "Patient Portal UX",
      status: "ON_HOLD",
      health: "BLOCKED",
      progressMode: "MANUAL",
      manualProgress: 40,
    },
  });
}
```

Call it from `main()` after the admin upsert, passing the admin's id, guarded by the flag. `Spring Campaign Site` deliberately has no milestones — it is the fixture that proves the AUTO-with-no-units `—` state in Task 12's QA.

- [ ] **Step 5: Verify the seed both ways**

Run: `SEED_DEMO=true npx prisma db seed` (PowerShell: `$env:SEED_DEMO="true"; npx prisma db seed; Remove-Item Env:SEED_DEMO`)
Expected: succeeds. Run it a second time — expected: succeeds again with identical end state (no duplicate-key error).

Run: `npx prisma db seed` with the flag unset.
Expected: only the admin upsert runs; no new demo rows.

- [ ] **Step 6: Gates and commit**

Run: `npx tsc --noEmit` → exits 0. Run: `npm test` → all existing suites still pass.

```bash
git add prisma/schema.prisma prisma/migrations prisma/seed.ts
git commit -m "feat: add Client, ClientContact, Project, Milestone and ActivityLog schema"
```

---

### Task 2: Pure date, progress and milestone-state modules (TDD)

**Files:**
- Create: `src/lib/badges.ts`, `src/lib/dates.ts`, `src/lib/progress.ts`, `src/lib/milestones.ts`
- Test: `tests/dates.test.ts`, `tests/progress.test.ts`, `tests/milestones.test.ts`

**Interfaces:**
- Consumes: nothing (pure modules, no imports beyond TS).
- Produces:

```ts
// src/lib/badges.ts — declared here, in the earliest task that any consumer needs it,
// so neither client.ts (Task 4) nor project.ts (Task 6) has to import from the other.
export type BadgeKind = "ok" | "warn" | "bad" | "neutral" | "strong";
```

```ts
// src/lib/dates.ts
export function parseDateInput(value: string): Date | null;      // "" -> null; "2026-08-14" -> UTC midnight; malformed -> null
export function toDateInputValue(d: Date | null): string;        // Date -> "2026-08-14"; null -> ""
export function shortDate(d: Date): string;                      // "12 Jun"  (en-GB, UTC)
export function monthYear(d: Date): string;                      // "Mar 2024" (en-GB, UTC)
export function isOverdue(due: Date | null, now?: Date): boolean;
export function relativeTime(at: Date, now?: Date): string;      // "just now" | "5m ago" | "2h ago" | "3d ago" | shortDate past 30d

// src/lib/progress.ts
export type ProgressMode = "AUTO" | "MANUAL";
export type ProgressCounts = { completed: number; total: number };
export type ProgressView = { percent: number; mode: ProgressMode; hasUnits: boolean; label: string };
export function computeAutoPercent(counts: ProgressCounts): number;
export function computeProgress(
  project: { progressMode: ProgressMode; manualProgress: number | null },
  counts: ProgressCounts
): ProgressView;
export function isValidManualProgress(value: number): boolean;

// src/lib/milestones.ts
export type MilestoneState = "completed" | "in_progress" | "not_started";
export type MilestoneLike = { order: number; createdAt: Date; dueDate: Date | null; completedAt: Date | null };
export function sortMilestones<T extends { order: number; createdAt: Date }>(ms: T[]): T[];
export function milestoneStates<T extends MilestoneLike>(ms: T[], now?: Date): Array<T & { state: MilestoneState; overdue: boolean }>;
export function milestoneMetaLabel(m: { state: MilestoneState; dueDate: Date | null; completedAt: Date | null }): string;
export function milestoneStateDot(state: MilestoneState): "ok" | "strong" | "mute";
export function milestoneCounts(ms: { completedAt: Date | null }[]): ProgressCounts;
export function nextMilestoneOrder(existing: { order: number }[]): number;
```

- [ ] **Step 1: Write `tests/dates.test.ts` (10 cases)**

`describe("parseDateInput")` — *returns null for an empty string*; *parses YYYY-MM-DD as UTC midnight* (`parseDateInput("2026-08-14")?.toISOString()` is `"2026-08-14T00:00:00.000Z"`); *returns null for a malformed value* (`"14/08/2026"`).
`describe("toDateInputValue")` — *formats a date as YYYY-MM-DD*; *returns an empty string for null*.
`describe("shortDate")` — *formats as "12 Jun"*.
`describe("monthYear")` — *formats as "Mar 2024"*.
`describe("isOverdue")` — *is false when there is no due date*; *is true for a past due date*; *is false for a future due date*.
`describe("relativeTime")` — *reads "just now" under a minute, "2h ago" at two hours and "3d ago" at three days*; *falls back to a short date past 30 days*.

Construct every fixture at `12:00:00Z` so formatting is timezone-stable.

- [ ] **Step 2: Write `tests/progress.test.ts` (10 cases)**

`describe("computeProgress")` — *AUTO with no milestones reports no units*, asserting `toEqual({ percent: 0, mode: "AUTO", hasUnits: false, label: "—" })`; *AUTO with 3 of 4 complete reads 75%* (`hasUnits: true`, `label: "75%"`); *rounds 1 of 3 down to 33*; *rounds 2 of 3 up to 67*; *reads 100 when every unit is complete*; *MANUAL returns the stored value and ignores the counts* (stored 40 with 4/4 units → 40); *MANUAL with no stored value reads 0 but still reports units*; *clamps an out-of-range stored manualProgress into 0..100* (stored 150 → 100, stored −5 → 0).
`describe("isValidManualProgress")` — *rejects 101, −1 and 33.5*; *accepts 0 and 100*.

- [ ] **Step 3: Write `tests/milestones.test.ts` (11 cases)**

`describe("sortMilestones")` — *orders by order then createdAt on ties*.
`describe("milestoneStates")` — *marks the lowest-ordered incomplete milestone in_progress and later incompletes not_started*; *reproduces the design's four-row fixture as completed, completed, in_progress, not_started*; *reports no in_progress when every milestone is complete*; *still reads completed for a milestone finished out of order, and still marks the lowest-order incomplete one in_progress*; *returns an empty array for no milestones*; *flags overdue only when the due date is past and completedAt is null*.
`describe("milestoneMetaLabel")` — *reads "Completed 12 Jun"*; *reads "In progress · due 14 Aug"*; *reads "Not started · due 29 Aug"*; *omits the due clause when there is no due date*.
`describe("milestoneCounts")` — *counts milestones with a completedAt as complete*.
`describe("nextMilestoneOrder")` — *is 0 for an empty list and one more than the highest existing order otherwise*.

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npm test`
Expected: three suites FAIL with "Cannot find module '@/lib/dates'" (and progress, milestones).

- [ ] **Step 5: Implement the three modules**

`src/lib/progress.ts` — the shape that carries D2:

```ts
export type ProgressMode = "AUTO" | "MANUAL";
export type ProgressCounts = { completed: number; total: number };
export type ProgressView = {
  percent: number;
  mode: ProgressMode;
  hasUnits: boolean;
  label: string;
};

export function computeAutoPercent(counts: ProgressCounts): number {
  if (counts.total <= 0) return 0;
  return Math.round((counts.completed / counts.total) * 100);
}

export function isValidManualProgress(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 100;
}

export function computeProgress(
  project: { progressMode: ProgressMode; manualProgress: number | null },
  counts: ProgressCounts
): ProgressView {
  if (project.progressMode === "MANUAL") {
    const raw = project.manualProgress ?? 0;
    const percent = Math.min(100, Math.max(0, Math.round(raw)));
    return { percent, mode: "MANUAL", hasUnits: true, label: `${percent}%` };
  }
  if (counts.total <= 0) {
    return { percent: 0, mode: "AUTO", hasUnits: false, label: "—" };
  }
  const percent = computeAutoPercent(counts);
  return { percent, mode: "AUTO", hasUnits: true, label: `${percent}%` };
}
```

`src/lib/dates.ts` — `parseDateInput` accepts only `/^\d{4}-\d{2}-\d{2}$/` and returns `new Date(`${value}T00:00:00.000Z`)`, rejecting `NaN` results; `shortDate` uses `toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })`; `monthYear` uses `{ month: "short", year: "numeric", timeZone: "UTC" }`; `relativeTime` buckets at <60s, <60m, <24h, <30d, else `shortDate`.

`src/lib/milestones.ts` — `milestoneStates` sorts first, then walks: `completedAt` set → `completed`; the first incomplete encountered → `in_progress`; every later incomplete → `not_started`. `overdue` is `isOverdue(dueDate, now) && completedAt === null`. `milestoneMetaLabel` builds exactly the vocabulary strings above.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test` → all three suites pass. Run: `npx tsc --noEmit` → exits 0.

- [ ] **Step 7: Commit**

```bash
git add src/lib/dates.ts src/lib/progress.ts src/lib/milestones.ts tests/dates.test.ts tests/progress.test.ts tests/milestones.test.ts
git commit -m "feat: pure date, progress and milestone-state helpers"
```

---

### Task 3: Generic ActivityLog module (TDD)

**Files:**
- Create: `src/lib/activity.ts`
- Test: `tests/activity.test.ts`

**Interfaces:**
- Consumes: Task 1's `activityLog` delegate; Task 2's `relativeTime`/`shortDate` (used by the component in Task 10, not here); Phase 1's fake-db test pattern.
- Produces:

```ts
export type ActivityEntityType = "CLIENT" | "CLIENT_CONTACT" | "PROJECT" | "MILESTONE";
export type ActivityAction =
  | "client.created" | "client.updated" | "client.status_changed" | "client.deleted"
  | "contact.added" | "contact.updated" | "contact.primary_set" | "contact.removed"
  | "project.created" | "project.updated" | "project.status_changed"
  | "project.health_changed" | "project.progress_changed"
  | "milestone.added" | "milestone.updated" | "milestone.completed"
  | "milestone.reopened" | "milestone.removed";
export type ActivityMeta = Record<string, unknown> | null;
export type ActivityDb = Pick<PrismaClient, "activityLog">;
export type ActivityEntry = { id: string; actorName: string; action: string; meta: ActivityMeta; at: Date };

export async function recordActivity(db: ActivityDb, input: {
  actorId: string;
  entityType: ActivityEntityType;
  entityId: string;
  action: ActivityAction;
  clientId: string | null;
  meta?: ActivityMeta;
}): Promise<void>;

export function fieldDiff<T extends object>(before: T, after: Partial<T>, fields: (keyof T)[]):
  Record<string, { from: unknown; to: unknown }> | null;

export function describeActivity(entry: { actorName: string; action: string; meta: ActivityMeta }): string;

export async function listClientActivity(db: PrismaClient, input: { clientId: string; limit?: number }): Promise<ActivityEntry[]>;
```

**`recordActivity` must be typed `db: ActivityDb` (`Pick<PrismaClient, "activityLog">`), not `PrismaClient`** — that is what lets a `tx` be passed in. If it takes the full client, every service is forced to log outside its transaction, which reintroduces orphaned mutations with no audit row.

- [ ] **Step 1: Write `tests/activity.test.ts` (13 cases)**

`describe("recordActivity")` — *writes a row with the given actor, entity, action and client scope* (`toMatchObject` on the captured create data); *writes meta as Prisma.DbNull when none is given* (assert the captured `meta` is not `undefined`); *writes the row with a null client scope* (the deleted-client audit case); *does not set `at` — the column default owns the timestamp* (assert the captured data has no `at` key); *writes through a transaction client shaped as `Pick<PrismaClient, "activityLog">`* (pass a bare `{ activityLog: { create } }` object, proving the narrow type is honoured).

`describe("fieldDiff")` — *returns null when nothing changed*; *returns only the changed keys as from/to pairs*; *ignores keys not listed in fields*; *treats an empty string and null as equal* (a form-empty value against a db-null must not log a phantom change).

`describe("describeActivity")` — *describes a created client* → `"Sarah Whitfield created client Harlow & Fitch"`; *describes a project health change* → `"Sarah Whitfield flagged Autumn Campaign as At Risk"`; *describes a completed milestone* → `"Sarah Whitfield completed milestone Design system freeze"`; ***falls back to a generic phrase for an unrecognised action*** — pass an invented `"task.assigned"` and assert it returns `"Sarah Whitfield updated this record"` **and does not throw**. That last case is the Phase 3 forward-compatibility guarantee; do not delete it.

`describe("listClientActivity")` — *queries by client scope, newest first, capped at 30* (capture the `findMany` args and assert `{ where: { clientId: "c1" }, orderBy: { at: "desc" }, take: 30 }` plus the actor `select`/`include` used to derive `actorName`); *honours an explicit limit*.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL with "Cannot find module '@/lib/activity'".

- [ ] **Step 3: Implement `src/lib/activity.ts`**

The `meta` write must be typed for Prisma 7 or `tsc` fails:

```ts
import { Prisma, type PrismaClient } from "@prisma/client";

export async function recordActivity(db: ActivityDb, input: { /* … */ }): Promise<void> {
  await db.activityLog.create({
    data: {
      actorId: input.actorId,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      clientId: input.clientId,
      meta: (input.meta ?? Prisma.DbNull) as Prisma.InputJsonValue | typeof Prisma.DbNull,
    },
  });
}
```

`describeActivity` is a `switch` over `entry.action` producing the sentences above from `entry.actorName` and `entry.meta`, with a `default` returning `` `${entry.actorName} updated this record` ``. It reads `meta` defensively (`typeof meta?.name === "string" ? meta.name : "this record"`) because reads come back as `Prisma.JsonValue`.

`fieldDiff` compares each listed field with `(a ?? "") === (b ?? "")` semantics so `""` and `null` are equal, returns `null` when the result is empty.

`listClientActivity` issues one `findMany` with `where: { clientId }`, `orderBy: { at: "desc" }`, `take: input.limit ?? 30`, including the actor's `name`, and maps rows to `ActivityEntry`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test` → passes. Run: `npx tsc --noEmit` → exits 0, confirming the `meta` typing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/activity.ts tests/activity.test.ts
git commit -m "feat: generic activity log writer, differ and formatter"
```

---

### Task 4: Client vocabulary, schema and client-service (TDD)

**Files:**
- Create: `src/lib/client.ts`, `src/lib/client-service.ts`
- Test: `tests/client.test.ts`, `tests/client-service.test.ts`

**Interfaces:**
- Consumes: Task 1 schema; Task 3 `recordActivity`/`fieldDiff`; Phase 1 `ActionResult`/`ok`/`err`, `normalizeEmail`, the zod conventions in `src/lib/profile.ts`, the Prisma-error mapping in `src/lib/invite-service.ts`.
- Produces:

```ts
// src/lib/client.ts
export const CLIENT_STATUSES: readonly ["ACTIVE", "PAUSED", "FORMER"];
export type ClientStatus = (typeof CLIENT_STATUSES)[number];
export const CLIENT_STATUS_LABEL: Record<ClientStatus, string>;
export const CLIENT_STATUS_BADGE: Record<ClientStatus, BadgeKind>;   // BadgeKind imported from "@/lib/badges"
export const clientSchema;  export type ClientInput = z.infer<typeof clientSchema>;
export function clientInitials(name: string): string;
export function clientListSummary(clients: { status: string }[]): string;

// src/lib/client-service.ts
export async function createClient(db: PrismaClient, input: ClientWriteInput & { actorId: string }): Promise<ActionResult<{ id: string }>>;
export async function updateClient(db: PrismaClient, input: ClientWriteInput & { clientId: string; actorId: string }): Promise<ActionResult>;
export async function deleteClient(db: PrismaClient, input: { clientId: string; actorId: string }): Promise<ActionResult>;

// where ClientWriteInput =
//   { name: string; status: ClientStatus; sector: string | null; website: string | null;
//     engagementType: string | null; clientSince: Date | null; accountLeadId: string | null; notes: string | null }
```

`BadgeKind` comes from `src/lib/badges.ts`, created in Task 2 — there is exactly one declaration of it in the branch.

- [ ] **Step 1: Write `tests/client.test.ts` (10 cases)**

`describe("clientSchema")` — *rejects a blank name* (`"Client name is required"`); *trims surrounding whitespace from the name*; *rejects a name over 120 characters*; *accepts empty sector, website, engagement type, notes and account lead* (the `.optional().or(z.literal(""))` idiom); *rejects a website that is not http(s)* (`"Website must be an http(s) URL"`); *rejects an unknown status*.
`describe("clientInitials")` — *takes the first letter of the first two words*, `"Harlow & Fitch"` → `"HF"` (the `&` is skipped); *falls back to the first two letters of a single word*, `"Northwind"` → `"NO"`; *trims and uppercases*, `"  a b c "` → `"AB"`.
`describe("clientListSummary")` — *reads "5 clients · 4 active" and "1 client · 1 active"*.

- [ ] **Step 2: Write `tests/client-service.test.ts` (11 cases, fake-db)**

`describe("createClient")` — *rejects a duplicate name regardless of case*, `toEqual({ ok: false, error: "A client with this name already exists" })`; *creates the client, returns its id, and logs client.created scoped to the new client*; *maps a P2002 from a concurrent insert to the same duplicate-name error* (construct a real `Prisma.PrismaClientKnownRequestError` with `code: "P2002"`); *coerces empty sector, website, engagement type, notes and account lead to null in the write args*.
`describe("updateClient")` — *errors on an unknown client* (`"Client not found"`); *writes no activity row when nothing changed*; *logs client.updated with the changed fields in meta*; *logs client.status_changed instead when the status differs*.
`describe("deleteClient")` — *refuses to delete a client that still has projects* (`"Remove this client's projects before deleting"`, and asserts no delete was issued); *deletes an empty client and logs client.deleted with a null client scope and the name in meta*; *maps a P2003 thrown between the count and the delete to the same refusal message*.

The fake must expose `client.findFirst/findUnique/create/update/delete`, `project.count`, `activityLog.create`, and a `$transaction` fake whose `tx` exposes the same closures (see the cheat sheet in Task 5, Step 1).

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test` → FAIL with "Cannot find module '@/lib/client'".

- [ ] **Step 4: Implement both modules**

`clientSchema` follows the `src/lib/profile.ts` idiom exactly:

```ts
import { z } from "zod";

export const clientSchema = z.object({
  name: z.string().trim().min(1, "Client name is required").max(120),
  status: z.enum(CLIENT_STATUSES),
  sector: z.string().trim().max(120).optional().or(z.literal("")),
  website: z
    .string()
    .trim()
    .url("Website must be an http(s) URL")
    .refine((v) => /^https?:\/\//i.test(v), "Website must be an http(s) URL")
    .optional()
    .or(z.literal("")),
  engagementType: z.string().trim().max(60).optional().or(z.literal("")),
  clientSince: z.string().trim().optional().or(z.literal("")),
  accountLeadId: z.string().trim().optional().or(z.literal("")),
  notes: z.string().trim().max(4000).optional().or(z.literal("")),
});
```

`createClient` does a case-insensitive `findFirst` pre-check (`where: { name: { equals: input.name, mode: "insensitive" } }`), then creates and logs inside one `$transaction`, mapping `P2002` to the duplicate-name string. `updateClient` loads the row, computes `fieldDiff(before, after, [...])`, returns `ok(undefined)` without writing activity when the diff is `null`, and picks `client.status_changed` over `client.updated` when `status` is among the changed keys. `deleteClient` counts projects first, returns the refusal when non-zero, otherwise deletes and logs with `clientId: null` and `meta: { name }`, mapping `P2003` to the same refusal.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test` → passes. Run: `npx tsc --noEmit` → exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/client.ts src/lib/client-service.ts tests/client.test.ts tests/client-service.test.ts
git commit -m "feat: client vocabulary, validation and client service"
```

---

### Task 5: Contact service with the single-primary invariant (TDD)

**Files:**
- Modify: `src/lib/client.ts` (add `contactSchema` + `ContactInput`)
- Create: `src/lib/contact-service.ts`
- Modify: `tests/client.test.ts` (add `describe("contactSchema")`)
- Test: `tests/contact-service.test.ts`

**Interfaces:**
- Consumes: Task 1 schema (`ClientContact.isPrimary`); Task 3 activity helpers; Task 4 `src/lib/client.ts`; Phase 1 `normalizeEmail` and the `member-service` interactive-transaction pattern.
- Produces:

```ts
export const contactSchema; export type ContactInput = z.infer<typeof contactSchema>;
export async function addContact(db: PrismaClient, input: { clientId: string; name: string; email: string | null; phone: string | null; role: string | null; actorId: string }): Promise<ActionResult<{ id: string }>>;
export async function updateContact(db: PrismaClient, input: { contactId: string; name: string; email: string | null; phone: string | null; role: string | null; actorId: string }): Promise<ActionResult>;
export async function setPrimaryContact(db: PrismaClient, input: { contactId: string; actorId: string }): Promise<ActionResult>;
export async function removeContact(db: PrismaClient, input: { contactId: string; actorId: string }): Promise<ActionResult>;
```

- [ ] **Step 1: Write the failing tests**

Add to `tests/client.test.ts` — `describe("contactSchema")` (4): *requires a contact name* (`"Contact name is required"`); *rejects a malformed email* (`"Enter a valid email address"`); *accepts an empty email, phone and role*; *trims the name*.

Create `tests/contact-service.test.ts` (11) using this fake — it is the canonical Phase 2 fake and later tasks copy it:

```ts
import { describe, it, expect } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { setPrimaryContact } from "@/lib/contact-service";

type FakeParts = {
  contact?: unknown;
  client?: unknown;
  contactCount?: number;
};

function fakeDb(parts: FakeParts) {
  const created: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  const deletes: unknown[] = [];
  const activity: Record<string, unknown>[] = [];

  const findUnique = async () => parts.contact ?? null;
  const update = async (args: { data: Record<string, unknown> }) => {
    updates.push(args.data);
    return args.data;
  };
  const updateMany = async (args: { data: Record<string, unknown> }) => {
    updates.push(args.data);
    return { count: 1 };
  };
  const create = async (args: { data: Record<string, unknown> }) => {
    created.push(args.data);
    return { id: "new1", ...args.data };
  };
  const del = async (args: unknown) => {
    deletes.push(args);
    return {};
  };
  const logCreate = async (args: { data: Record<string, unknown> }) => {
    activity.push(args.data);
    return args.data;
  };

  const contactDelegate = { findUnique, update, updateMany, create, delete: del, count: async () => parts.contactCount ?? 0 };

  const db = {
    clientContact: contactDelegate,
    client: { findUnique: async () => parts.client ?? null },
    activityLog: { create: logCreate },
    $transaction: async (fn: (tx: unknown) => Promise<void>) => {
      const tx = { clientContact: contactDelegate, activityLog: { create: logCreate } };
      return fn(tx);
    },
  } as unknown as PrismaClient;

  return { db, created, updates, deletes, activity };
}
```

Cases — `describe("addContact")`: *errors on an unknown client* (`"Client not found"`); *makes the first contact for a client primary* (`contactCount: 0` → captured `isPrimary: true`); *leaves a second contact non-primary* (`contactCount: 1` → `isPrimary: false`); *lowercases and trims the email before writing* (`"  Jo@Example.COM "` → `"jo@example.com"`); *stores an empty email as null*; *logs contact.added scoped to the client*.
`describe("updateContact")`: *errors on an unknown contact* (`"Contact not found"`); ***never writes isPrimary, even when the input carries it*** — assert the captured update `data` has no `isPrimary` key.
`describe("setPrimaryContact")`: *demotes the incumbent and promotes the target inside one transaction*, asserting `updates` equals `[{ isPrimary: false }, { isPrimary: true }]`; *logs contact.primary_set*.
`describe("removeContact")`: *deletes the contact and logs contact.removed with the name in meta*; *removing the primary promotes nobody* (assert no second update was issued).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test` → FAIL with "Cannot find module '@/lib/contact-service'".

- [ ] **Step 3: Implement `contactSchema` and the four service functions**

`contactSchema` mirrors `clientSchema`'s idiom, with `email: z.string().trim().email("Enter a valid email address").optional().or(z.literal(""))`.

`addContact` loads the client (404 → `"Client not found"`), counts existing contacts to decide `isPrimary`, normalises the email with `normalizeEmail` when non-empty, and creates + logs inside one `$transaction`.

`updateContact` loads the contact, updates **only** `name`, `email`, `phone`, `role` — `isPrimary` is never in the update payload — then logs `contact.updated` when `fieldDiff` is non-null.

`setPrimaryContact` runs the whole demote-then-promote inside `db.$transaction(async (tx) => …)`: `tx.clientContact.updateMany({ where: { clientId, isPrimary: true }, data: { isPrimary: false } })` then `tx.clientContact.update({ where: { id }, data: { isPrimary: true } })`, then `recordActivity(tx, …)`.

`removeContact` reads the contact (for `meta.name` and `clientId`), deletes it, and logs — no promotion of any other contact.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test` → passes. Run: `npx tsc --noEmit` → exits 0.

> **Reviewer check, stated explicitly:** a non-transactional two-update implementation of `setPrimaryContact` still passes this fake. The reviewer must read the source and confirm both writes are inside `db.$transaction(async (tx) => …)` and that `recordActivity` receives `tx`, not `db`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/client.ts src/lib/contact-service.ts tests/client.test.ts tests/contact-service.test.ts
git commit -m "feat: client contact service with single-primary invariant"
```

---

### Task 6: Project vocabulary, schema and project-service (TDD)

**Files:**
- Create: `src/lib/project.ts`, `src/lib/project-service.ts`
- Test: `tests/project.test.ts`, `tests/project-service.test.ts`

**Interfaces:**
- Consumes: Task 1 schema and `@@unique([clientId, name])`; Task 2 `isValidManualProgress`/`parseDateInput`; Task 3 activity helpers; Phase 1 `ActionResult` and Prisma-error mapping.
- Produces:

```ts
// src/lib/project.ts   (BadgeKind is imported from "@/lib/badges", not redeclared here)
export const PROJECT_STATUSES: readonly ["PLANNING", "IN_PROGRESS", "ON_HOLD", "DONE"];
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string>;
export const PROJECT_HEALTHS: readonly ["ON_TRACK", "AT_RISK", "BLOCKED"];
export type ProjectHealth = (typeof PROJECT_HEALTHS)[number];
export const PROJECT_HEALTH_LABEL: Record<ProjectHealth, string>;
export const PROJECT_HEALTH_BADGE: Record<ProjectHealth, BadgeKind>;
export const projectSchema;   export type ProjectInput = z.infer<typeof projectSchema>;
export const milestoneSchema; export type MilestoneInput = z.infer<typeof milestoneSchema>;
export function isProjectActive(status: ProjectStatus): boolean;
export function projectColorIndex(projectId: string): 1 | 2 | 3 | 4 | 5 | 6;
export function projectListSummary(rows: { status: string; clientId: string }[]): string;
export function projectRowSubtitle(input: { milestoneCount: number; dueDate: Date | null }): string;
export function parseHealthFilter(raw: string | string[] | undefined): ProjectHealth | null;

// src/lib/project-service.ts
export async function createProject(db: PrismaClient, input: { clientId: string; name: string; description: string | null; status: ProjectStatus; health: ProjectHealth; startDate: Date | null; dueDate: Date | null; actorId: string }): Promise<ActionResult<{ id: string }>>;
export async function updateProject(db: PrismaClient, input: { projectId: string; name: string; description: string | null; status: ProjectStatus; health: ProjectHealth; startDate: Date | null; dueDate: Date | null; actorId: string }): Promise<ActionResult>;
export async function setProjectStatus(db: PrismaClient, input: { projectId: string; status: ProjectStatus; actorId: string }): Promise<ActionResult>;
export async function setProjectHealth(db: PrismaClient, input: { projectId: string; health: ProjectHealth; actorId: string }): Promise<ActionResult>;
export async function setProjectProgress(db: PrismaClient, input: { projectId: string; progressMode: ProgressMode; manualProgress: number | null; actorId: string }): Promise<ActionResult>;
```

- [ ] **Step 1: Write `tests/project.test.ts` (15 cases, pure)**

`describe("projectSchema")` — *rejects a blank name* (`"Project name is required"`); *rejects a due date before the start date* (`"Due date cannot be before the start date"`); *accepts both dates absent and only one present*.
`describe("milestoneSchema")` — *requires a title* (`"Milestone title is required"`); *accepts an empty due date*; *trims the title*.
Vocabulary — *labels project statuses as Planning, In Progress, On Hold and Done*; *labels health as On Track, At Risk and Blocked*; *maps ON_TRACK, AT_RISK and BLOCKED to the ok, warn and bad badge kinds*.
`describe("isProjectActive")` — *is false for DONE and true for the other three*.
`describe("projectColorIndex")` — *is stable for the same id across calls*; *always returns a value between 1 and 6 across 200 sample ids*; *differs for at least two of three sample ids*.
`describe("projectListSummary")` — *reads "6 active projects across 5 clients"*; *counts only non-DONE projects and counts distinct clients across that same filtered set*; *reads "No projects yet" for an empty list*.
`describe("projectRowSubtitle")` — *reads "3 milestones · due 14 Aug"*; *reads "1 milestone" when there is no due date*; *reads "No milestones · due 14 Aug" for a project with none*.
`describe("parseHealthFilter")` — *maps "AT_RISK" to AT_RISK*; *maps undefined to null*; *maps an unrecognised value to null rather than throwing*; *takes the first entry of an array-valued searchParam*.

- [ ] **Step 2: Write `tests/project-service.test.ts` (13 cases, fake-db)**

`describe("createProject")` — *errors on an unknown client* (`"Client not found"`); *rejects a duplicate project name for the same client* (`"A project with this name already exists for this client"`); *allows the same name under a different client*; *maps a P2002 race to the duplicate-name error*; *rethrows an unrecognised database error* (`await expect(...).rejects.toBe(theError)`); *creates in AUTO mode with a null manualProgress and logs project.created scoped to the client*.
`describe("updateProject")` — *errors on an unknown project* (`"Project not found"`); *writes no activity when nothing changed*; *logs project.updated with the changed fields in meta*.
`describe("setProjectHealth")` — *logs project.health_changed with from and to*; *writes nothing at all when the value is unchanged*.
`describe("setProjectStatus")` — *logs project.status_changed*.
`describe("setProjectProgress")` — *rejects a manual value of 150* (`"Progress must be a whole number between 0 and 100"`); *stores both progressMode and manualProgress when switching to MANUAL*; ***switching back to AUTO changes only progressMode and preserves the stored manualProgress*** — assert the captured update `data` has no `manualProgress` key, proving the toggle is lossless.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test` → FAIL with "Cannot find module '@/lib/project'".

- [ ] **Step 4: Implement both modules**

`projectSchema` cross-field rule uses `.superRefine` (or `.refine` on the object) comparing the two parsed date strings, emitting `"Due date cannot be before the start date"` on the `dueDate` path.

`projectColorIndex` hashes the id deterministically into 1..6, e.g. summing char codes modulo 6 plus one — no randomness, no `Date`.

`createProject` verifies the client exists, pre-checks `findFirst({ where: { clientId, name: { equals: name, mode: "insensitive" } } })`, then creates + logs in one `$transaction`, mapping `P2002` to the duplicate string and rethrowing anything else.

`setProjectHealth` and `setProjectStatus` load the row, return `ok(undefined)` with **no write at all** when the value is unchanged, otherwise update + log with `meta: { from, to }`.

`setProjectProgress` validates with `isValidManualProgress` when `progressMode === "MANUAL"`, and when switching to AUTO builds its update payload with **only** `{ progressMode: "AUTO" }` so the stored `manualProgress` survives.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test` → passes. Run: `npx tsc --noEmit` → exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/project.ts src/lib/project-service.ts tests/project.test.ts tests/project-service.test.ts
git commit -m "feat: project vocabulary, validation and project service"
```

---

### Task 7: Milestone service (TDD)

**Files:**
- Create: `src/lib/milestone-service.ts`
- Test: `tests/milestone-service.test.ts`

**Interfaces:**
- Consumes: Task 1 schema; Task 2 `nextMilestoneOrder`/`parseDateInput`; Task 3 activity helpers; Task 6 `src/lib/project.ts`; Phase 1's injectable-clock convention.
- Produces:

```ts
export async function addMilestone(db: PrismaClient, input: { projectId: string; title: string; dueDate: Date | null; actorId: string }): Promise<ActionResult<{ id: string }>>;
export async function updateMilestone(db: PrismaClient, input: { milestoneId: string; title: string; dueDate: Date | null; actorId: string }): Promise<ActionResult>;
export async function setMilestoneComplete(db: PrismaClient, input: { milestoneId: string; complete: boolean; actorId: string; now?: Date }): Promise<ActionResult>;
export async function removeMilestone(db: PrismaClient, input: { milestoneId: string; actorId: string }): Promise<ActionResult>;
```

**The sneaky requirement:** a milestone knows only its `projectId`, but every activity row must carry the **client** scope. Every one of these four functions must load the parent project selecting `clientId` and pass it to `recordActivity`. A milestone event that lands with `clientId: null` never appears on the client timeline.

- [ ] **Step 1: Write `tests/milestone-service.test.ts` (12 cases, fake-db)**

`describe("addMilestone")` — *errors on an unknown project* (`"Project not found"`); *writes order 0 for a project's first milestone*; *writes one more than the highest existing order* (fake returns `{ order: 4 }` → captured `order: 5`, proving `nextMilestoneOrder` is used rather than a `count`); *stores a null due date when none is given*; ***logs milestone.added carrying the grandparent clientId***.
`describe("updateMilestone")` — *errors on an unknown milestone* (`"Milestone not found"`); *updates title and due date without touching order or completedAt* (assert the captured update keys); *writes no activity when nothing changed*.
`describe("setMilestoneComplete")` — *stamps completedAt when completing and logs milestone.completed*; *clears completedAt when reopening and logs milestone.reopened*; *completing an already-complete milestone is a no-op that writes no activity*.
`describe("removeMilestone")` — *deletes it and logs milestone.removed with the title captured before the delete*.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test` → FAIL with "Cannot find module '@/lib/milestone-service'".

- [ ] **Step 3: Implement `src/lib/milestone-service.ts`**

Each function: load parent (project for `addMilestone`; milestone + its project for the rest, selecting `clientId`), guard, mutate + `recordActivity` inside one `$transaction`. `setMilestoneComplete` writes `completedAt: input.complete ? (input.now ?? new Date()) : null` and returns early with no write when the requested state already holds.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test` → passes. Run: `npx tsc --noEmit` → exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/milestone-service.ts tests/milestone-service.test.ts
git commit -m "feat: milestone service with server-assigned ordering"
```

---

### Task 8: Read models — batched progress counts and page query shapes (TDD)

**Files:**
- Create: `src/lib/project-queries.ts`, `src/lib/client-queries.ts`
- Test: `tests/project-queries.test.ts`, `tests/client-queries.test.ts`

**Interfaces:**
- Consumes: Task 1 schema; Task 2 progress + milestone helpers; Task 4 `clientInitials` + status maps; Task 6 `projectColorIndex`/`isProjectActive`/`projectRowSubtitle`.
- Produces:

```ts
// src/lib/project-queries.ts
export async function getProjectProgressCounts(db: PrismaClient, projectIds: string[]): Promise<Map<string, ProgressCounts>>;
//  ^^ THE Phase 3 swap point. Phase 3 rewrites this body to count tasks. Signature and callers stay fixed.

export type ProjectListRow = {
  id: string; name: string; clientId: string; clientName: string;
  status: ProjectStatus; health: ProjectHealth; dueDate: Date | null;
  milestoneCount: number; progress: ProgressView; colorIndex: number; subtitle: string;
};
export async function listProjects(db: PrismaClient, input?: { clientId?: string; health?: ProjectHealth | null; includeDone?: boolean }): Promise<ProjectListRow[]>;

export type ProjectDetail = {
  id: string; name: string; description: string | null;
  clientId: string; clientName: string;
  status: ProjectStatus; health: ProjectHealth;
  startDate: Date | null; dueDate: Date | null;
  progress: ProgressView; progressMode: ProgressMode; manualProgress: number | null;
  colorIndex: number;
  milestones: Array<{ id: string; title: string; order: number; dueDate: Date | null; completedAt: Date | null; state: MilestoneState; overdue: boolean; metaLabel: string; dot: "ok" | "strong" | "mute" }>;
};
export async function getProjectDetail(db: PrismaClient, projectId: string): Promise<ProjectDetail | null>;

// src/lib/client-queries.ts
export type ClientListRow = {
  id: string; name: string; initials: string; status: ClientStatus; sector: string | null;
  projectCount: number; primaryContact: { name: string; email: string | null } | null;
};
export async function listClients(db: PrismaClient): Promise<ClientListRow[]>;

export type ClientDetail = {
  id: string; name: string; initials: string; status: ClientStatus;
  sector: string | null; website: string | null; notes: string | null;
  engagementType: string | null; clientSince: Date | null;
  accountLead: { id: string; name: string } | null;
  contacts: Array<{ id: string; name: string; email: string | null; phone: string | null; role: string | null; isPrimary: boolean }>;
  projects: ProjectListRow[];
};
export async function getClientDetail(db: PrismaClient, clientId: string): Promise<ClientDetail | null>;
```

**Binding convention recorded here:** read functions return plain data or `null`, **never `ActionResult`**. `ActionResult` is the mutation contract only.

- [ ] **Step 1: Write `tests/project-queries.test.ts` (9 cases, fake-db)**

`describe("getProjectProgressCounts")` — *returns an empty Map and issues no db calls for an empty id list* (count calls in a closure); *groups three milestones across two projects into per-project counts*; *includes a project with no milestones in the Map as zero of zero* (so no caller has to null-check).
`describe("listProjects")` — *composes each row's progress view from the batched counts* (an AUTO row at 1/2 reads 50% and a MANUAL row at 90 reads 90% in the same result set); *excludes DONE by default and includes it when includeDone is true*; *passes a health filter through to the where clause and omits the key when null*; ***issues exactly two db calls regardless of row count*** — the anti-N+1 assertion; do not weaken it; *carries a milestoneCount and a subtitle on every row*.
`describe("getProjectDetail")` — *returns null for an unknown id*.

- [ ] **Step 2: Write `tests/client-queries.test.ts` (7 cases, fake-db)**

`describe("listClients")` — *carries initials derived from clientInitials*; *reports the isPrimary contact as primaryContact*; *reports a null primaryContact when contacts exist but none is primary*; *excludes DONE projects from projectCount*.
`describe("getClientDetail")` — *returns null for an unknown id*; *sorts contacts primary-first then by name*; *builds each project row's progress view from the same batched counts provider* (proving reuse rather than a per-row query).

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test` → FAIL with "Cannot find module '@/lib/project-queries'".

- [ ] **Step 4: Implement both modules**

`getProjectProgressCounts` returns `new Map()` immediately for an empty array (no db call), then issues **one** `milestone.findMany({ where: { projectId: { in: projectIds } }, select: { projectId: true, completedAt: true } })` and folds it into the Map, seeding every requested id with `{ completed: 0, total: 0 }` first so absent projects are present as zero-of-zero.

`listProjects` issues exactly two calls: one `project.findMany` (with `client: { select: { name: true } }` and `_count: { select: { milestones: true } }`), then one `getProjectProgressCounts` for all returned ids. Rows are composed with `computeProgress`, `projectColorIndex` and `projectRowSubtitle`. `includeDone` defaults false and filters `status: { not: "DONE" }`.

`getClientDetail` loads the client with contacts, account lead and projects, sorts contacts primary-first then by name, and reuses `listProjects(db, { clientId })` so the progress path is identical on both screens.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test` → passes. Run: `npx tsc --noEmit` → exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/project-queries.ts src/lib/client-queries.ts tests/project-queries.test.ts tests/client-queries.test.ts
git commit -m "feat: batched project progress counts and page read models"
```

---

### Task 9: Server actions for clients, contacts, projects and milestones

**Files:**
- Create: `src/server/actions/clients.ts`, `src/server/actions/projects.ts`
- Test: none — Phase 1 convention deliberately leaves action wrappers untested (they call `auth()`, which this repo does not fake; all decision logic lives in the already-tested services).

**Interfaces:**
- Consumes: Tasks 4–7 services; Task 4/6 zod schemas; Task 2 `parseDateInput`; Phase 1 `requireUser`/`requireAdmin`/`AuthError` from `@/server/guards`, the `prisma` singleton, `ActionResult`.
- Produces:

```ts
// src/server/actions/clients.ts
export async function createClientAction(_prev: ActionResult<{ id: string }> | null, formData: FormData): Promise<ActionResult<{ id: string }>>;  // requireUser
export async function updateClientAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult>;                                   // requireUser
export async function deleteClientAction(formData: FormData): Promise<ActionResult>;                                                              // requireAdmin ← the ONLY admin-gated mutation in Phase 2
export async function addContactAction(_prev: ActionResult<{ id: string }> | null, formData: FormData): Promise<ActionResult<{ id: string }>>;     // requireUser
export async function updateContactAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult>;                                  // requireUser
export async function setPrimaryContactAction(formData: FormData): Promise<ActionResult>;                                                         // requireUser
export async function removeContactAction(formData: FormData): Promise<ActionResult>;                                                             // requireUser

// src/server/actions/projects.ts — every action requireUser
export async function createProjectAction(_prev: ActionResult<{ id: string }> | null, formData: FormData): Promise<ActionResult<{ id: string }>>;
export async function updateProjectAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult>;
export async function setProjectStatusAction(formData: FormData): Promise<ActionResult>;
export async function setProjectHealthAction(formData: FormData): Promise<ActionResult>;
export async function setProjectProgressAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult>;
export async function addMilestoneAction(_prev: ActionResult<{ id: string }> | null, formData: FormData): Promise<ActionResult<{ id: string }>>;
export async function updateMilestoneAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult>;
export async function toggleMilestoneAction(formData: FormData): Promise<ActionResult>;
export async function removeMilestoneAction(formData: FormData): Promise<ActionResult>;
```

**Revalidation map** — document it verbatim as a comment block at the top of each action file:

| Mutation | `revalidatePath` calls |
|---|---|
| client create / update / delete | `/clients`, plus `` `/clients/${clientId}` `` on update |
| contact add / update / set-primary / remove | `` `/clients/${clientId}` ``, `/clients` |
| project create / update / status / health / progress | `/projects`, `` `/projects/${projectId}` ``, `` `/clients/${clientId}` `` |
| milestone add / update / toggle / remove | `` `/projects/${projectId}` ``, `` `/clients/${clientId}` `` (milestones move AUTO progress, which the client page renders) |

- [ ] **Step 1: Write both action files following this exact template**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { err, type ActionResult } from "@/lib/action-result";
import { AuthError, requireUser } from "@/server/guards";
import { clientSchema } from "@/lib/client";
import { updateClient } from "@/lib/client-service";
import { parseDateInput } from "@/lib/dates";

export async function updateClientAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const clientId = String(formData.get("clientId") ?? "");
    const parsed = clientSchema.safeParse({
      name: formData.get("name"),
      status: formData.get("status"),
      sector: formData.get("sector"),
      website: formData.get("website"),
      engagementType: formData.get("engagementType"),
      clientSince: formData.get("clientSince"),
      accountLeadId: formData.get("accountLeadId"),
      notes: formData.get("notes"),
    });
    if (!parsed.success) {
      return err(parsed.error.issues[0]?.message ?? "Invalid input");
    }
    const { name, status, sector, website, engagementType, clientSince, accountLeadId, notes } = parsed.data;
    const result = await updateClient(prisma, {
      clientId,
      name,
      status,
      sector: sector || null,
      website: website || null,
      engagementType: engagementType || null,
      clientSince: parseDateInput(clientSince || ""),
      accountLeadId: accountLeadId || null,
      notes: notes || null,
      actorId: user.id,
    });
    revalidatePath("/clients");
    revalidatePath(`/clients/${clientId}`);
    return result;
  } catch (e) {
    if (e instanceof AuthError) return err(e.message);
    throw e;
  }
}
```

The seven invariants every one of the 16 actions must satisfy (the reviewer checks these by eye):
1. `"use server";` is the literal first line, before imports.
2. The guard call is the first statement inside the `try`.
3. The `catch` block is exactly the Phase 1 AuthError block quoted above — nothing else caught, everything else rethrown.
4. Every FormData read is `String(formData.get("x") ?? "")`; enums use a ternary/`safeParse` default; booleans compare `=== "true"`.
5. `safeParse` with `parsed.error.issues[0]?.message ?? "Invalid input"`; `field || null` for cleared optionals; `parseDateInput` is the only date parser.
6. `revalidatePath` uses **literal** paths only, matching the map above.
7. `deleteClientAction` is the only `requireAdmin` action in the phase.

- [ ] **Step 2: Gates**

Run: `npx tsc --noEmit` → exits 0. Run: `npm run lint` → clean. Run: `npm test` → still green (no new tests, none should break).

- [ ] **Step 3: Commit**

```bash
git add src/server/actions/clients.ts src/server/actions/projects.ts
git commit -m "feat: server actions for clients, contacts, projects and milestones"
```

---

### Task 10: Shared token-based UI primitives

**Files:**
- Create: `src/components/ui/badge.tsx`, `src/components/ui/progress-bar.tsx`, `src/components/ui/initials-avatar.tsx`, `src/components/ui/page-header.tsx`, `src/components/ui/empty-state.tsx`, `src/components/activity/activity-timeline.tsx`
- Test: none — presentational only; the Vitest environment is `node` with no jsdom and no `@testing-library/react`, so components cannot be tested with this config. Every mapping they consume is already tested in Tasks 2–4.

**Interfaces:**
- Consumes: Task 6 `BadgeKind`/`PROJECT_HEALTH_BADGE`; Task 4 `CLIENT_STATUS_BADGE`; Task 2 `relativeTime`; Task 3 `describeActivity`; Phase 1's token set.
- Produces:

```tsx
<Badge kind={BadgeKind} dot?: boolean>{label}</Badge>
<ProgressBar view={ProgressView} size?: "sm" | "md" />
<InitialsAvatar initials={string} shape={"square" | "circle"} size?: number />
<PageHeader title={string} subtitle?: string action?: ReactNode />
<EmptyState message={string} actionLabel?: string actionHref?: string />
<ActivityTimeline entries={ActivityEntry[]} />
```

- [ ] **Step 1: Build the six components with these exact class strings**

| Element | Class string |
|---|---|
| Badge `ok` | `inline-flex w-fit items-center gap-1.5 rounded-md border border-[var(--ok-line)] bg-[var(--ok-bg)] px-2 py-0.5 text-[11px] font-bold text-[var(--ok)]` |
| Badge `warn` | same shape with `border-[var(--warn-line)] bg-[var(--warn-bg)] text-[var(--warn)]` |
| Badge `bad` | same shape with `border-[var(--bad-line)] bg-[var(--bad-bg)] text-[var(--bad)]` |
| Badge `neutral` | same shape with `border-[var(--border)] bg-[var(--surface-3)] text-[var(--text-2)]` |
| Badge `strong` | same shape with `border-[var(--border-2)] bg-[var(--surface-3)] text-[var(--text)]` |
| Badge dot | `h-1.5 w-1.5 rounded-full` + the kind's colour (`bg-[var(--ok)]` / `bg-[var(--warn)]` / `bg-[var(--bad)]` / `bg-[var(--text)]` / `bg-[var(--text-3)]`) |
| Progress track | `block h-[5px] flex-1 overflow-hidden rounded-[3px] bg-[var(--surface-3)]` |
| Progress fill | `block h-full rounded-[3px] bg-[var(--text-2)]` — **always `--text-2`, never a health colour** |
| Progress label | `w-8 text-right text-[11.5px] font-semibold text-[var(--text-2)]` |
| Client avatar (square) | `flex flex-none items-center justify-center rounded-lg bg-[var(--surface-3)] text-[11px] font-bold text-[var(--text-2)]` |
| Person avatar (circle) | `flex flex-none items-center justify-center rounded-full bg-[var(--avatar)] text-[11px] font-bold text-[var(--avatar-t)]` |
| Empty state | `text-sm text-[var(--text-3)]` with an inline `font-semibold text-[var(--accent)]` link |
| Page header | `text-2xl font-semibold text-[var(--text)]` + `mt-1 text-sm text-[var(--text-3)]` subtitle |

`<ProgressBar>` carries the one behavioural rule in this task: when `view.hasUnits` is false it renders the `—` label and **no** filled bar, plus the muted affordance text "Add milestones or set progress manually". That branch is driven entirely by `computeProgress`, already tested in Task 2.

`<ActivityTimeline>` renders one row per entry: a circular `<InitialsAvatar>` built from the actor's initials, `describeActivity(entry)` as the sentence, and `relativeTime(entry.at)` as muted trailing text. Empty list renders "Nothing has happened here yet."

- [ ] **Step 2: Gates**

Run: `npx tsc --noEmit` → exits 0. Run: `npm run lint` → clean.

Run a grep proving no palette leakage under the new component directory:

```bash
grep -rnE "dark:|bg-(indigo|gray|slate|zinc|red|green|amber)-|#[0-9a-fA-F]{3,6}" src/components/ui src/components/activity
```

Expected: no matches.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui src/components/activity
git commit -m "feat: shared token-based UI primitives"
```

---

### Task 11: Clients list, client detail, contacts and the activity timeline

**Files:**
- Modify: `src/app/(app)/clients/page.tsx` (replaces `PlaceholderPage`)
- Create: `src/app/(app)/clients/[clientId]/page.tsx`
- Create: `src/components/clients/client-form.tsx`, `src/components/clients/client-delete-button.tsx`, `src/components/clients/contact-list.tsx`, `src/components/clients/contact-form.tsx`
- Create: `src/components/projects/project-row.tsx` (shared; Task 12 reuses it on the global list)
- Test: none (pages and components untested by convention; all logic covered by Tasks 2–8)

**Interfaces:**
- Consumes: Task 8 `listClients`/`getClientDetail`; Task 3 `listClientActivity`; Task 9 client + contact actions; Task 10 primitives; Task 6 `projectColorIndex` and badge maps.
- Produces: routes `/clients` and `/clients/[clientId]`; `<ClientForm>`, `<ClientDeleteButton>`, `<ContactList>`, `<ContactForm>`, `<ProjectRow>`.

- [ ] **Step 1: Build `/clients`**

Server component. Header via `<PageHeader title="Clients" subtitle={clientListSummary(rows)} action={<ClientForm />} />`. Table columns exactly `Client · Status · Projects · Primary contact`. The Client cell is a square `<InitialsAvatar>` plus the name with the sector beneath in `text-[var(--text-3)]`. Status is a `<Badge>` from `CLIENT_STATUS_BADGE`. Primary contact shows the name with the email beneath, or `—` when there is none. The whole row links to `/clients/{id}` (wrap in `next/link`, `hover:bg-[var(--surface-2)]`). Empty list renders `<EmptyState message="No clients yet." actionLabel="Add your first client." />`.

`<ClientForm>` is a `"use client"` `useActionState` form over `createClientAction` (and `updateClientAction` when given a `client` prop) with fields: name, status `<select>`, sector, website, engagement type, client since (`<input type="date">`), account lead `<select>`, notes `<textarea>`. Submit label "Save" / "Saving…".

The account-lead `<select>` needs the team list, which the form cannot fetch itself (it is a client component). **Both pages that mount `<ClientForm>` must query it and pass it in** as `members: { id: string; name: string }[]`:

```ts
const members = await prisma.user.findMany({
  where: { active: true },
  select: { id: true, name: true },
  orderBy: { name: "asc" },
});
```

Add it to the `Promise.all` already present on each page. The select's first option is an empty-valued "No account lead", so clearing the field submits `""`, which the action coerces to `null`.

- [ ] **Step 2: Build `/clients/[clientId]`**

```tsx
export default async function ClientDetailPage(props: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await props.params;
  const [client, activity, session] = await Promise.all([
    getClientDetail(prisma, clientId),
    listClientActivity(prisma, { clientId }),
    auth(),
  ]);
  if (!client) notFound();
  // …
}
```

Layout: breadcrumb `Clients / {name}`; header with a 44px square avatar, `<h1>`, status `<Badge dot>`, engagement-type `<Badge kind="neutral">` when present, and a meta row of muted chips — sector, website, `Account lead {name}`, `Client since {monthYear(clientSince)}` — each rendered only when its field is set. Actions: "Edit" (toggles `<ClientForm client={…}>`) and, for admins only, `<ClientDeleteButton>`.

Body is two columns: main column shows the Projects section (`"{N} active"` count, `<ProjectRow>` per project, `<EmptyState message="No projects for this client yet." />`) then the `<ActivityTimeline>`; the sidebar shows the Contacts card (`<ContactList>` + `<ContactForm>`).

`<ContactList>` renders each contact as a circular avatar, name, role, "Primary" badge when `isPrimary`, and row actions "Make primary" (hidden when already primary) and "Remove" using the fire-and-forget `run()` pattern from Phase 1's `member-row-actions.tsx`.

`<ClientDeleteButton>` is only rendered when `session.user.role === "ADMIN"`, and shows the service's refusal message inline when the client still has projects.

- [ ] **Step 3: Build `<ProjectRow>`**

Shared row: a 3px project-colour swatch (`bg-[var(--pj{n})]` from `projectColorIndex`), the project name, the subtitle from `projectRowSubtitle` (`"{N} milestones · due {date}"`), a `<ProgressBar>`, and a health `<Badge>`. `showClient` adds the client name column for the global list in Task 12. The row links to `/projects/{id}`.

- [ ] **Step 4: QA checklist — execute every line and record the result in the task report**

1. Create a client; it appears in the list with its sector under the name.
2. Clicking a row navigates to detail; the breadcrumb reads `Clients / {name}`.
3. Edit the name and status; the change shows and **two** new timeline entries appear with correct phrasing and relative time.
4. Add a contact — it is automatically primary and appears in the list's `Primary contact` column.
5. Add a second contact, promote it, confirm the first is demoted; remove a contact; confirm the primary column reads `—` after removing the primary.
6. The delete button is absent as a MEMBER and present as an ADMIN.
7. Deleting a client that has projects shows the inline refusal; deleting an empty client succeeds.
8. `/clients/does-not-exist` renders the 404 UI.
9. Both themes render correctly via the topbar toggle.

Plus `npm test` green, `npx tsc --noEmit` exits 0, `npm run lint` clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(app\)/clients src/components/clients src/components/projects/project-row.tsx
git commit -m "feat: clients list, client detail, contacts and activity timeline"
```

---

### Task 12: Projects list, project detail and the milestones strip

**Files:**
- Modify: `src/app/(app)/projects/page.tsx` (replaces `PlaceholderPage`)
- Create: `src/app/(app)/projects/[projectId]/page.tsx`
- Create: `src/components/projects/project-form.tsx`, `project-health-control.tsx`, `progress-control.tsx`, `health-filter.tsx`, `milestone-strip.tsx`, `milestone-form.tsx`
- Modify: `src/app/(app)/clients/[clientId]/page.tsx` (mount `<ProjectForm presetClientId>` in the Projects section)
- Test: none (logic covered by Tasks 2, 6, 7, 8)

**Interfaces:**
- Consumes: Task 8 `listProjects`/`getProjectDetail`; Task 9 project + milestone actions; Task 10 primitives; Task 11 `<ProjectRow>`; Task 6 label/badge maps and `parseHealthFilter`.
- Produces: routes `/projects` (with `?health=`) and `/projects/[projectId]`.

- [ ] **Step 1: Build `/projects`**

Server component reading `searchParams` (a Promise — await it) and passing `parseHealthFilter(raw.health)` into `listProjects`. Header subtitle is `projectListSummary(rows)`. Columns exactly `Project · Client · Progress · Health · Due`, rendered with `<ProjectRow showClient />`. `<HealthFilter>` is a `<form method="get">` with a `<select name="health">` that submits on change — server-side filtering only, so the filter survives a reload. Empty states: "No projects yet. Create one from a client's page." unfiltered, "No projects match this health filter." when filtered.

- [ ] **Step 2: Build `/projects/[projectId]`**

Breadcrumb `Clients / {client name} / Project` (the literal word "Project"; the client segment links to the client). Header: `<h1>` with the project name, health `<Badge dot>`, then a stat row — `<ProgressBar size="md">` with `"{N}% complete"`, `Due {shortDate(dueDate)}`, and the status badge. Controls: `<ProjectHealthControl>` and `<ProgressControl>`; "Edit" toggles `<ProjectForm project={…}>`.

Below the header, the milestones strip: `<MilestoneStrip>` renders `overflow-x-auto` cards using the milestone card class string, each showing the state dot, title and `metaLabel`, with a complete/reopen toggle and a "Remove" action. `<MilestoneForm>` adds one. Empty renders "No milestones yet."

**No tab bar.** Board/Timeline/Files/Activity are Phase 3.

`<ProgressControl>` is a `useActionState` form over `setProjectProgressAction`: a mode `<select>` (Auto / Manual) plus a `0–100` number input that is disabled unless mode is Manual, surfacing the service's validation error inline.

- [ ] **Step 3: Mount project creation on the client page**

Add `<ProjectForm presetClientId={client.id} />` to the client detail Projects section, so a project can be created from either surface. When `presetClientId` is given the client `<select>` is not rendered and a hidden input carries the id.

- [ ] **Step 4: QA checklist — execute every line and record the result in the task report**

1. Create a project from a client page (client fixed) and from the global list (client `<select>`).
2. A project with zero milestones in AUTO shows `—` plus "Add milestones or set progress manually" — **not** `0%`.
3. Add three milestones; the strip shows the first incomplete as "In progress" and the rest as "Not started".
4. Complete the first: the second becomes "In progress" **and** the AUTO bar moves to 33% on both the project page and the client page.
5. Switch to MANUAL 90; both pages read 90%. Switch back to AUTO; it returns to the milestone-derived value (proving the toggle is lossless). MANUAL 150 shows the validation error.
6. Change health to At Risk: the badge turns amber on all three surfaces and the change appears in the client timeline as "flagged X as At Risk".
7. The Health filter narrows `/projects` and survives a reload.
8. Client-detail project rows read `{N} milestones · due {date}`.
9. `/projects/does-not-exist` renders the 404 UI. Both themes render.

Plus `npm test` green, `npx tsc --noEmit` exits 0, `npm run lint` clean, and a final repo-wide grep confirming no `dark:` variant and no hardcoded palette colour was introduced anywhere in Phase 2:

```bash
grep -rnE "dark:|bg-(indigo|gray|slate|zinc|red|green|amber)-|#[0-9a-fA-F]{3,6}" src/app src/components src/lib
```

- [ ] **Step 5: Commit**

```bash
git add src/app/\(app\)/projects src/app/\(app\)/clients src/components/projects
git commit -m "feat: projects list, project detail and milestones strip"
```

---

## Phase 2 Done Criteria

- [ ] A fresh clone plus `.env`, `npx prisma migrate dev`, `SEED_DEMO=true npx prisma db seed`, `npm run dev` yields a working app with demo clients and projects.
- [ ] `/clients` lists clients with status, project counts and primary contacts; `/clients/[id]` shows header meta, projects with progress bars and health badges, contacts, and a populated activity timeline.
- [ ] `/projects` lists every client's projects with a working health filter; `/projects/[id]` shows the header stat row and the milestones strip.
- [ ] Completing a milestone visibly moves AUTO progress on both the project page and the client page.
- [ ] A project with no milestones reads `—`, never `0%`.
- [ ] Switching MANUAL → AUTO → MANUAL preserves the stored manual value.
- [ ] Only admins see and can use "Delete client"; deleting a client with projects is refused with the exact message.
- [ ] Every mutation writes exactly one correctly scoped activity row, visible on the client timeline.
- [ ] All Vitest suites pass (`npm test`); `npx tsc --noEmit` clean; `npm run lint` clean.
- [ ] No `dark:` variant and no hardcoded palette colour anywhere in `src/`.
