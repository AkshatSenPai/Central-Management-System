# Phase 3b — Browser QA record and follow-ups

Branch `phase-3b-board-people`. QA executed by the owner on 2026-08-01 against a local dev server on the live Neon database, using the 36-line script derived from plan Task 8. The owner reported every line passing.

This record separates **what the database corroborates** from **what rests on the owner's observation**, because a good half of this phase — optimistic movement, drag affordance, empty-state strings, theme rendering — leaves no trace a query can read. Nothing below is inferred from the plan; the evidence sections are query output.

## Automated gates

| Gate | Result |
|---|---|
| `npm test` | 471 passed, 33 files |
| `npx tsc --noEmit` | exit 0 |
| `npm run lint` | clean |
| `npm run build` | succeeds; route list carries `/projects/[projectId]/board` and `/team/[memberId]` |
| Colour scan, `'src/**/*.tsx' 'src/**/*.ts'` | no `dark:`, no hardcoded hex |

## Corroborated by database evidence

Queried after the run; scripts kept in `.superpowers/` (untracked).

1. **Every board move wrote exactly one `task.status_changed` row.** 16 rows written on 2026-08-01, **0 double-logged** — checked by comparing adjacent rows for the same `entityId` with identical `meta` inside a 2-second window. This is plan Task 8 step 1 item 9, and it is the one item that had a plausible failure mode (a re-render logging twice) invisible to the eye.
2. **Activity scoping is correct on both paths.** All 15 project-task moves carry `clientId = cms7mcxu600008ku33lam1pxv` (Harlow & Fitch), so they reach the client timeline. The one personal-task move (`Make changes in arkquen.online`, TO_DO → IN_PROGRESS) carries `clientId: null` — correct, a personal task has no client to file under. This is the asymmetry Phase 3a item 5 fixed, still holding.
3. **Quick-add genuinely created tasks.** 2 × `task.created` written today. This matters more than any other line: quick-add was submitting `null` for four fields and failing every submit until `b8db13c`, so a green result here is direct evidence the fix works against the real action, not just against `taskSchema` in a probe.
4. **Teardown is complete.** 2 × `task.removed` balancing the 2 creates; no task created today survives; a scan for titles containing "delete" or "test" returns nothing; both members are `active`, so the deactivation in step 25 was reverted.
5. **Progress arithmetic is consistent.** Launch Toolkit holds its original 5 tasks with 2 DONE = 40%, matching the pre-QA figure.

## Rests on the owner's observation — no independent evidence possible

Recorded as passing on report, and flagged so a later reader does not mistake them for machine-checked:

- **Optimistic immediacy** (step 1 item 4) — that the card lands in its new column *before* the request settles. The single most important behavioural claim in the phase, and entirely unobservable from stored state: a slow non-optimistic move and a fast optimistic one leave identical rows.
- **Rollback** (item 13, as rewritten — see ruling 1 below).
- **Project chips unchanged under a status filter** (step 2 item 5) — the defect `getMemberProfile`'s third query exists to prevent. Unit-tested at the read-model level, but the rendered invariance is observation only.
- Column headers, breadcrumbs, and the exact empty-state strings ("No tasks yet.", "Nothing assigned.", an empty column rendering no text).
- Drag-over highlight appearing and clearing; the "Deactivated" badge; 404 on an unknown member.
- Escape and outside-click dismissal, blank-title rejection with checkbox state preserved, and the sub-15-second capture target.

## Not exercised

- **Two-tab concurrent editing beyond item 13.** Only the delete-then-drag race was run.
- **Touch drag.** HTML5 drag-and-drop does not fire on touch; `<TaskStatusControl>` is the designated path there (spec D4) and was verified, but no touch device was used.
- **A member active on two or more projects.** Only one project in the database holds tasks, so the profile chip list was only ever exercised at length 1. The dedupe-by-project-id logic is unit-tested; its rendering at length > 1 is unseen.
- **A board wide enough to need scrolling**, and any column past a handful of cards.

## Rulings taken

1. **Plan Task 8 step 1 item 11 is superseded.** It asserted a failed move shows "Task not found" on the card. It cannot: `setTaskStatusAction` revalidates unconditionally, so the row is revalidated away and the card is gone before an error could render. The QA ran the corrected assertion — *the card disappears cleanly, with no board-wide banner* — and it passed. **Item 11 now reads that way.** The inline-error behaviour was not built and is not planned; reinstating it would mean making revalidation conditional, which would be a real behaviour change, not a QA fix.
2. **Plan Task 8 step 4's colour gate is superseded.** As written, `git grep -nE "dark:|#[0-9a-fA-F]{3,6}" -- src/app src/components src/lib` is specified as "Expected: no output" but always matches `src/app/globals.css`, where the tokens are *defined* — it reports failure on a clean tree every time. The gate is now scoped to `'src/**/*.tsx' 'src/**/*.ts'`, which is what the constraint means and which is clean across the branch.

## Carried forward

1. **Widen `taskSchema` to accept `null` for its optional fields.** *Open — recommended before the next form is written.* `description`, `projectId`, `milestoneId` and `dueDate` are `.optional().or(z.literal(""))`, taking `undefined` or `""` but never `null`; `formData.get()` returns `null` for any field a form omits. `<QuickAdd>` therefore carries four empty hidden inputs, and `tests/task.test.ts` pins the distinction so they do not read as dead markup. The general fix belongs in `src/lib/task.ts` and changes validation for every caller, so it was deliberately not taken inside Task 7's frozen file list. Any future form shorter than `<TaskForm>` walks into this again.
2. **Drag-over highlight can stick after an aborted drag** (Esc, or dropping outside a column). `BoardColumn` exposes no `onDragLeave` and `BoardCard` no `onDragEnd`. Not seen during QA, but reachable.
3. **`MemberProfileProject.clientId`** is selected, mapped and typed but never read — the chips link to `/projects/{id}` and render `clientName` only.
4. **The "Quick add" trigger has no `aria-expanded`/`aria-haspopup`**, so the panel's open state is not announced. It is otherwise keyboard-dismissible.
5. **`(app)/layout.tsx` issues a `user.findMany` on every page render** to feed the topbar member list. Plan-specified; one extra query per page, not per component.
6. **Task mutations revalidate `/my-tasks` and `/team` but not `/team/{memberId}`.** Next 16 leaves dynamic routes uncached client-side by default and `next.config.ts` sets no `staleTimes`, so no staleness appeared during QA. If `staleTimes` is ever configured, this becomes a live bug.
7. **The planned Task 5 test "issues exactly three queries whatever the row count"** exercises only one row count, unlike `listTeamCards`' analogous test which runs 5 members and 1. The name overpromises what it checks.
8. **Vocabulary Lock exceptions still unrecorded in the plan**, carried from 3a: `<TaskAssigneesForm>`'s "Save assignees", and the checklist's "Add" button where the lock says "Add checklist item".
9. **A project row still reads "4 milestones · due 14 Aug" while its progress is task-derived** — mildly self-contradictory once the basis flips. `projectRowSubtitle`'s own comment anticipates this.
10. **next-themes emits "Encountered a script tag while rendering React component" on the `notFound()` path.** Pre-existing since Phase 1. A real fix means replacing next-themes; only `theme-provider.tsx` and `topbar.tsx` use it.

## Cleanup note

One card was left out of place: **"Schedule the social queue" sits in Review; it started in To Do.** Everything else is restored — original 5 tasks, 2 DONE, 40%, both members active, no leftover QA rows. Harmless, but the board is not byte-identical to its pre-QA state.
