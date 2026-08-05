# Calendar Events — step 3: reads and rendering

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Events appear on the calendar beside task deadlines. **Read path only** — nothing can create, edit or delete an event yet. That is step 4.

**Why this order:** the whole of §7's rendering can be QA'd against seeded rows before any write path exists, so a rendering bug cannot be blamed on the form and vice versa.

**Spec:** `docs/superpowers/specs/2026-08-04-calendar-events-design.md` — §6 (surfaces and modules), §7 (rendering), §12 (testing). Where this plan and the spec disagree, the spec wins; report the conflict rather than choosing.

**Already built and merged to `master`:** the app-timezone layer (`startOfAppDay`, `appWeekday`/`appYear`/`appMonth`/`appDayOfMonth`, `groupByAppDay(rows, at)` with its accessor), and the `CalendarEvent` / `CalendarEventAttendee` tables with `EVENT_SCHEDULED`. Do not modify any of it.

## Global Constraints

- **`vitest.config.ts` is `environment: "node"`** with `include: ["tests/**/*.test.ts"]`. No jsdom, no `@testing-library`. **Components cannot be rendered in tests.** All logic lives in `src/lib/calendar-event.ts` so it is testable at all; the grid is verified by Task 7's browser pass. Never propose adding test dependencies — spec §12 rejected that.
- **Gate 1** (`scripts/gates.mjs:62`) greps `dark:|#[0-9a-fA-F]{3,6}` over `src/**/*.ts` **and** `.tsx`, and is **not** comment-stripped.
- **Gate 2** (`:66`): no raw `<button>`. **Gate 3** (`:72-77`): no raw `<input>`/`<select>`/`<textarea>` outside `src/components/ui/`. **Gate 6** (`:96`): `shadow-[var(--shadow-lg)]`, never Tailwind's `shadow-lg`.
- **No new icons** — gates 7 and 8 check the font subset against `src/lib/icons.ts`.
- `CalendarGrid` stays a **server component**. It has no `"use client"` today and nothing here needs one.
- **Write real Unicode characters in comments, never `\uXXXX` escape text.**
- **`status` must never filter events.** Events have no status. Hiding them behind a task filter would make the calendar lie; the visible consequence — picking "Done" shows completed tasks *and* every event — is stated in the spec, not hidden.

## File Structure

| File | Change |
|---|---|
| `src/lib/dates.ts` | add `appTimeLabel` only — the other three time helpers are step 4 |
| `src/lib/calendar-event.ts` (create) | the pure layer; the only unit-testable surface |
| `tests/calendar-event.test.ts` (create) | its tests |
| `src/lib/calendar-event-queries.ts` (create) | `CalendarEventRow`, `listCalendarEventsInRange` |
| `tests/calendar-event-queries.test.ts` (create) | query-shape tests, mirroring `tests/task-queries.test.ts` |
| `src/app/(app)/calendar/page.tsx` | the `Promise.all` gains a member and three selects change |
| `src/components/calendar/calendar-grid.tsx` | month cells, untimed band, hour timeline |

---

### Task 1: `appTimeLabel`, and the simple pure functions

**Files:** modify `src/lib/dates.ts`; create `src/lib/calendar-event.ts`, `tests/calendar-event.test.ts`

**Produces:** `appTimeLabel`, `calendarPeriodSummary`, `eventTimeLabel`, `splitDayEvents`, `monthCellRows`, `attendeeInitialsLabel`.

- [ ] **Step 1: Write the failing tests**

`tests/calendar-event.test.ts`. Cover, at minimum:

- `appTimeLabel` renders 24-hour app-zone time: an instant at `2026-08-04T09:30:00.000Z` is `15:00` in IST. **Derive the expected string rather than copying it** — 09:30Z + 05:30 = 15:00.
- `calendarPeriodSummary(0, 0)`, `(1, 0)`, `(0, 1)`, `(2, 3)` — singular and plural in both halves, and the both-zero case.
- `eventTimeLabel` returns `""` (or the agreed all-day marker) for an all-day event and a start time for a timed one. **An all-day event must never print a clock**, because its stored bounds are app-midnight to app-midnight and "00:00" would be an artefact of storage, not a fact about the event.
- `splitDayEvents` partitions into `{ timed, allDay }` and preserves the input order within each.
- `monthCellRows(events, tasks, 3)` returns `{ events, tasks, overflow }`: events first, the two lists already capped to three **rows total across both**, and `overflow` counted across both kinds. Test 2 events + 5 tasks → 2 events, 1 task, overflow 4. Test 5 events + 0 tasks → 3 events, 0 tasks, overflow 2. Test 1 + 1 → no overflow, `overflow` is 0.
- `attendeeInitialsLabel` — its contract per spec §6/§7.

- [ ] **Step 2: Run, confirm they fail for the right reason**

```bash
npx vitest run tests/calendar-event.test.ts
```

- [ ] **Step 3: Implement**

`appTimeLabel` goes in `src/lib/dates.ts` beside the other pinned formatters, using `Intl.DateTimeFormat("en-GB", { timeZone: APP_TIMEZONE, hour: "2-digit", minute: "2-digit", hour12: false })` — `en-GB` and 24-hour, matching every other pinned formatter there and dodging the am/pm question. The other three time helpers (`parseTimeInput`, `toTimeInputValue`, `appDateTime`) are **step 4** — do not add them.

Everything else goes in `src/lib/calendar-event.ts`. No Prisma import, no React import.

`monthCellRows` is the one to get right: it is pure precisely so the truncation rule cannot drift between the row lists and the `+N more` count, which is what would happen if the cell computed them separately.

- [ ] **Step 4: Run — pass. Then `npm test` and `npm run gates` (9/9).**

- [ ] **Step 5: Commit**

---

### Task 2: the timeline geometry

**Files:** modify `src/lib/calendar-event.ts`, `tests/calendar-event.test.ts`

**Produces:** `timelineWindow`, `eventPosition`, `assignLanes`.

- [ ] **Step 1: Write the failing tests**

- `timelineWindow([])` — the default window, 08:00 to 19:00 app-zone.
- It **widens** to fit: an event starting 06:15 floors the window to 06:00; one ending 20:10 ceils it to 21:00.
- It **never narrows**: a single 10:00–11:00 event still yields 08:00–19:00.
- `eventPosition` returns `{ topPct, heightPct }` as percentages of the window. An event filling the whole window is `{ topPct: 0, heightPct: 100 }`. One in the exact middle half is `{ topPct: 25, heightPct: 50 }`. **No minimum height in the arithmetic** — a 15-minute call yields its true tiny percentage, and CSS `min-h-[22px]` keeps it clickable. A pure function must not know what a pixel is.
- `assignLanes`: two events at the same time → lanes 0 and 1, both `laneCount: 2`. Three mutually overlapping → lanes 0,1,2, all `laneCount: 3`. Two that do **not** overlap → both lane 0, both `laneCount: 1`. **Touching is not overlapping**: an event ending exactly when the next starts shares lane 0, because the interval is half-open `[start, end)`.

- [ ] **Step 2: Run, confirm failure. Step 3: Implement. Step 4: Run, pass.**

`assignLanes` is a single sweep over events sorted by start, placing each in the first lane whose last end is `<= ` its start. `laneCount` is the width of the event's overlapping **cluster**, not the global maximum — two calls at 09:00 and two unrelated at 17:00 give every event `laneCount: 2`, not 4.

- [ ] **Step 5: `npm test`, `npm run gates`. Commit.**

---

### Task 3: the query

**Files:** create `src/lib/calendar-event-queries.ts`, `tests/calendar-event-queries.test.ts`

**Produces:** `CalendarEventRow` (verbatim from spec §6) and `listCalendarEventsInRange(db, { from, to, userId, projectId })`.

- [ ] **Step 1: Read `src/lib/task-queries.ts` first.** `listTasksInRange` is the model to follow — its `where` shape, how it maps assignees through `clientInitials`, and how `tests/task-queries.test.ts` tests a query without a live database. Match both.

- [ ] **Step 2: Write the tests, then the implementation.**

- `where` is `{ startsAt: { gte: from, lt: to } }` — half-open, matching `calendarRange`.
- `userId` filters by **attendee**: `attendees: { some: { userId } }`, the same clause shape `listTasksInRange` uses for assignees.
- `projectId` filters by `projectId`.
- **There is no status filter and must never be one.**
- Ordering is `[{ allDay: "desc" }, { startsAt: "asc" }, { createdAt: "asc" }]`. `desc` puts all-day first because Postgres sorts `false` before `true`.
- `initials` comes from `clientInitials`, the same helper `mapAssignees` uses.

- [ ] **Step 3: `npm test`, `npm run gates`, `npx tsc --noEmit`. Commit.**

---

### Task 4: the page

**Files:** modify `src/app/(app)/calendar/page.tsx`

⚠️ **This is not a one-line change, and treating it as one leaves step 4's form unbuildable.** Three existing members of the `Promise.all` move, and a fourth query is added:

- [ ] **Step 1: Add `listCalendarEventsInRange` to the `Promise.all`.**
- [ ] **Step 2: `projects` gains `clientId: true`** — the form's Client field derives from the chosen project, and `ProjectOption` is `{ id; name; clientId }` (`task-form.tsx:33`). Without it the derivation has nothing to derive from.
- [ ] **Step 3: `members` gains `active: true`** — `<AssigneePicker>` requires `Array<{ id; name; active: boolean }>` (`assignee-picker.tsx:17`).
- [ ] **Step 4: Add a fourth query, `clients`**, `{ id: true, name: true }` ordered by name — the shape `project-form.tsx` takes. There is no client query on this page today.
- [ ] **Step 5:** Keep the five accepted searchParams and the resolution order exactly. `searchParams` stays awaited.
- [ ] **Step 6:** Replace the subtitle's nested ternaries with `calendarPeriodSummary(rows.length, events.length)`.
- [ ] **Step 7: `npx tsc --noEmit`, `npm run lint`, `npm run gates`, `npm test`. Commit.**

Steps 2–4 exist only for step 4's form. They are done here because this task owns the page's query block and splitting it would mean touching the same twelve lines twice.

---

### Task 5: month rendering

**Files:** modify `src/components/calendar/calendar-grid.tsx`

- [ ] **Step 1:** Props gain `events`. Build **two** maps:

```tsx
const tasksByDay = groupByAppDay(rows, (r) => r.dueDate);
const eventsByDay = groupByAppDay(events, (e) => e.startsAt);
```

- [ ] **Step 2:** Each month cell renders `monthCellRows(cellEvents, cellTasks, 3)` — events first, then tasks, then the `+N more` spanning both kinds. The existing comment at `:100-102` about truncation stands and is now doing more work.
- [ ] **Step 3:** An event chip is: a filled dot — `--accent` when it has no project, otherwise the project swatch from `projectColorIndex` — then `appTimeLabel(startsAt)` in the mono class, then the truncated title. **All-day events show no time.**
- [ ] **Step 4:** Every event links to `/calendar?view=day&date=YYYY-MM-DD` for its own day, with `transitionTypes={["nav-forward"]}` like every other link in the file. Events do **not** link to a detail page — there isn't one.
- [ ] **Step 5: `npx tsc --noEmit`, `npm run lint`, `npm run gates`. Commit.**

No unit tests in this task — see Global Constraints. Task 7 is the gate.

---

### Task 6: the untimed band and the hour timeline

**Files:** modify `src/components/calendar/calendar-grid.tsx`

`ColumnsView` serves both week and day and gains two stacked regions.

- [ ] **Step 1: The untimed band** sits directly under each column header and carries that day's due tasks **and** its all-day events. It is the only place a due task appears in week or day view. **It renders nothing at all — no heading, no empty dash — when the day has neither**, so a week of pure meetings does not grow seven empty captions.

- [ ] **Step 2: Its heading varies by column, and this is deliberate.** `Due today · no set time` when `isSameAppDay(day, now)` — reuse the check `ColumnsView` already makes at `:134` for its header highlight rather than re-deriving it — and `No set time` otherwise. Printing "Due today" over all seven columns of a week would be a factual error on six of them, and on all seven whenever the visible week is not the current one.

- [ ] **Step 3: The timeline window is computed once for the whole view**, across every column: `timelineWindow(splitDayEvents(events).timed)`.

⚠️ **It is fed the timed rows only, never the raw array.** An all-day event runs app-midnight to app-midnight, so one "Priya on leave" anywhere in the visible period would drag the window to 00:00–24:00 for every column — producing exactly the fixed full-day scroller the design rejects, for a row the timeline does not even carry.

- [ ] **Step 4:** Each timed event gets `eventPosition(event, window)` for `topPct`/`heightPct`, and `assignLanes` for side-by-side layout. `min-h-[22px]` in CSS, never in the arithmetic.
- [ ] **Step 5:** In the **day view** an event box is the trigger for editing — but step 4 builds the form, so for now it links like the month chips do. Leave the box structured so a trigger can be passed in later without rework.
- [ ] **Step 6: Full toolchain.** `npx tsc --noEmit`, `npm run lint`, `npm run gates`, `npm test`, then **stop any dev server, `rm -rf .next`, `npm run build`** — in that order, because deleting `.next` under a live server corrupts its Turbopack cache. Commit.

---

### Task 7: browser QA

**Files:** none unless a defect is found.

⚠️ **Use real Chrome via `mcp__plugin_chrome-devtools-mcp`, never the embedded Browser pane** — that pane reports `visibilityState: "hidden"`, so skeletons hang forever while scripted assertions pass against a blank screen. Assert `document.visibilityState === "visible"` alongside `location.pathname` before believing any measurement.

- [ ] **Step 1: Seed events directly via Prisma** — there is no write path yet, which is the point of this ordering. Cover: a timed event today; two overlapping events at the same hour; an all-day event; an event with a project and one without; one at 23:30 and one at 00:30 to exercise the day boundary.
- [ ] **Step 2: Month view.** Events sort above tasks in a cell. `+N more` counts across both kinds. All-day events show no time. Project-coloured dots match their project.
- [ ] **Step 3: The day-boundary cases.** An event at 00:30 IST appears on that day and prints `00:30`. One at 23:30 appears on that day and not the next. **The cell and the printed time must agree — this is the bug the whole timezone step existed to prevent.**
- [ ] **Step 4: Day and week.** The untimed band appears only where there is something to put in it; its heading is `Due today · no set time` on today's column and `No set time` elsewhere. Overlapping events render side by side. The window does not collapse to 00:00–24:00 when an all-day event is present.
- [ ] **Step 5: Filters.** `person` filters events by attendee; `project` filters by project; **`status` does not affect events at all** — confirm picking "Done" still shows every event.
- [ ] **Step 6: Both themes, and phone width.**
- [ ] **Step 7: Remove every seeded event and confirm the counts return to zero.**
- [ ] **Step 8: Report.** For each unmet criterion: what you did, what happened, what you expected. Do not fix defects here — report them, and they become their own task.

---

## Self-Review

**Spec coverage.** §6's module layout → Tasks 1–3; its `Promise.all` changes → Task 4; `CalendarEventRow` verbatim → Task 3. §7's month rules → Task 5; `ColumnsView`'s two regions, the varying band heading and the timed-only window → Task 6; `assignLanes`/`eventPosition`/`timelineWindow` → Task 2. §12's testability boundary → Global Constraints.

**Out of scope, deliberately.** `calendarEventSchema`, `validateEventTimes`, the service, the actions, `event-form.tsx`, `event-remove-control.tsx`, the `EVENT_SCHEDULED` notification, and the three write-side time helpers (`parseTimeInput`, `toTimeInputValue`, `appDateTime`). All step 4.

**The two things most likely to go wrong.** Task 6 Step 3 — feeding `timelineWindow` the raw array instead of the timed rows produces a plausible-looking full-day scroller that is wrong for a reason nobody will guess. And Task 5's cap: `monthCellRows` caps **three rows total across both kinds**, not three of each.

## Execution Handoff

Subagent-driven, fresh implementer per task, review between each.
