# Calendar Events — step 4: writes, the form, and notifications

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** events can be created, edited and deleted from the calendar, and attendees get told. This completes the feature.

**Spec:** `docs/superpowers/specs/2026-08-04-calendar-events-design.md` — §8 (create/edit/delete, lines 327-369), §9 (notifications, 370-395), §10 (states), §11 (security), §12 (testing, and it carries the **canonical signatures** — check it before trusting any brief), §13 (vocabulary lock). **Where a brief and the spec disagree, the spec wins — report the conflict rather than choosing.** Five conflicts surfaced in step 3 and every one was a brief error.

**Already merged to `master`:** the app-timezone layer; `CalendarEvent`/`CalendarEventAttendee`/`EVENT_SCHEDULED`; the pure layer (`calendar-event.ts`), the read query (`calendar-event-queries.ts`), and the rendering. Do not modify the rendering except where this plan says.

## Global Constraints

- **`vitest.config.ts` is `environment: "node"`**, no jsdom, no `@testing-library`. **`event-form.tsx` and `event-remove-control.tsx` cannot have unit tests and must not be given any** — spec §12:421 says so outright. Services *can* be tested and must be. Never propose adding test dependencies.
- **`notify` is always called with the transaction client, never the outer `db`.** `NotificationDb` is `Pick<PrismaClient, "notification">` precisely so a `tx` satisfies it, because "a rolled-back assignment would still have told somebody it happened" (`notification-service.ts:3-7`). `tests/task-service.test.ts:52-57` builds separate write sinks for `db` and `tx` so a write on the wrong one fails loudly; copy that harness.
- **No call site filters the actor out of a notification.** `notification-service.ts:45` does it centrally and is documented at `:19-32` as the single enforcement point. A local filter would be dead code that hides a regression in the real one.
- **Gate 1** (no hex, not comment-stripped), **Gate 2** (no raw `<button>`), **Gate 3** (no raw `<input>`/`<select>`/`<textarea>` outside `src/components/ui/` — `<Field type="time">` goes through the primitive, so nothing new is raw), **Gate 6** (`shadow-[var(--shadow-lg)]`), **Gates 7/8** (no new icon — `"event"` is already in `ICON_NAMES`).
- **Write real Unicode characters, never `\uXXXX` escape text.**

---

### Task 1: the write-side time helpers and the validator

**Files:** modify `src/lib/dates.ts`, `src/lib/calendar-event.ts`, `tests/calendar-event.test.ts`; possibly `tests/dates.test.ts`

**Produces:** `parseTimeInput`, `toTimeInputValue`, `appDateTime` (in `dates.ts`); `validateEventTimes`, `calendarEventSchema` (in `calendar-event.ts`).

Spec §5:236-255 gives the three helpers' contracts; §12:426 gives the validator's signature:

```ts
validateEventTimes(start: number | null, end: number | null, allDay: boolean): string | null
```

- [ ] **Step 1: Write the failing tests.** Per spec §12:438, `validateEventTimes` rejects a null start, a null end, an end **equal** to the start, and an end **before** it — **each with its own distinct string**, so a user is told which thing is wrong. It accepts any pair in order, and returns `null` outright for `allDay`.

⚠️ **There is deliberately no same-day case.** The signature takes minutes since app-midnight, so a cross-day end is not expressible — D5's structural argument written as an absence. Do not invent a check for it.

- [ ] **Step 2: Run, confirm failure. Step 3: Implement. Step 4: Run, pass.**

`parseTimeInput` returns minutes since app-midnight or `null`, the same treat-it-as-absent contract as `parseDateInput` and the same refusal to guess. `appDateTime(date, time)` is the **only** place a wall-clock time becomes a stored instant — build it from `parseDateInput` and `parseTimeInput` and return `null` if either half fails.

- [ ] **Step 5: `npm test`, `npm run gates` 9/9, `npx tsc --noEmit`. Commit.**

---

### Task 2: the four pure-layer notification edits

**Files:** modify `src/lib/notification-service.ts`, `src/lib/notifications.ts`, `tests/notifications.test.ts`

Spec §9:385-392 specifies all four. Read it directly.

- [ ] **Step 1: Write the failing tests**, per spec §12:444: both `EVENT_SCHEDULED` sentences, the `"event"` icon, `notificationHref`'s day link built from `meta.date` **and** its `/calendar` fallback when `meta.date` is missing, and — **the one that catches the shared-fallback trap** — an `EVENT_SCHEDULED` row with no `meta.name`, which must read **"an event"** and never **"a task"**.

- [ ] **Step 2: Implement the four edits.**

1. `NotificationEntity` gains `"CALENDAR_EVENT"`. It is a union, not a free string, so `notificationHref` stays exhaustive.
2. `notificationIcon` maps `EVENT_SCHEDULED` → `"event"`. **No new icon** — it is already in `ICON_NAMES` and already rendered.
3. `describeNotification` gains one case, two sentences: `` `${who} scheduled ${what} — ${when}` `` without `meta.movedFrom`, `` `${who} moved ${what} to ${when}` `` with it. Read `meta` through `metaString`, which returns null for non-strings.

⚠️ **This case must NOT use the shared `what` binding.** `notifications.ts:65` is `const what = metaString(n.meta, "name") ?? "a task"` — one binding for every branch, whose fallback is a lie here. An `EVENT_SCHEDULED` row missing `meta.name` would read **"Priya scheduled a task"**, leaking the wrong noun into the surface §13 locks hardest. Use a local `metaString(n.meta, "name") ?? "an event"`.

4. `notificationHref` gains a case returning `` `/calendar?view=day&date=${date}` `` from `meta.date`, falling back to `/calendar` when absent or malformed. Its parameter widens to `{ entityType: string; entityId: string; meta?: Record<string, unknown> | null }` — **optional**, so `tests/notifications.test.ts` compiles unchanged.

- [ ] **Step 3: `npm test`, gates, tsc. Commit.**

---

### Task 3: `createCalendarEvent`

**Files:** create `src/lib/calendar-event-service.ts`, `tests/calendar-event-service.test.ts`

- [ ] **Step 1: Read `src/lib/task-service.ts` `createTask` (`:106-186`) and `tests/task-service.test.ts` first.** The order is not negotiable and every step of it was paid for. Copy the harness at `tests/task-service.test.ts:52-57` — separate write sinks for `db` and `tx`, so a write issued on the outer `db` lands in `dbW` and fails any test asserting it empty rather than silently passing.

- [ ] **Step 2: Write the failing tests**, per spec §12:442: the row, the attendee rows, the activity row and the notification rows all land on the **tx** sink and never on `db`; exactly one activity row per call; a create with a project resolves and stores that project's `clientId`; a create whose `projectId` does not resolve returns `Project not found` with **nothing written**; **a create whose only attendee is the actor writes zero notifications** — which proves the central `notification-service.ts:45` filter is doing the work rather than the call site.

- [ ] **Step 3: Implement**, in `createTask`'s exact order: trim and validate, `err(...)` early; resolve the project's `clientId` with a plain read and surface a missing FK as an `ActionResult` rather than letting a foreign-key error throw; resolve attendees through the same `active: true` filter, de-duplicating and **rejecting the whole write when fewer rows come back than distinct ids requested**; read the notification audience **before** opening the transaction; then one `db.$transaction` containing, in order — row write, attendee `createMany({ skipDuplicates: true })`, `recordActivity(tx, …)`, `notify(tx, …)`. `try`/`catch`, translate P2025. Return `ok({ id })`.

**Two helpers cannot be imported and go opposite ways** (spec §8:361-364): `isRowGoneRace` is **duplicated**, three lines, following `announcement-service.ts:8-10`'s precedent. `resolveAssignees` gets a `resolveAttendees` **twin**, nine lines with its own doc comment — exporting the original would couple two services through a function whose comment says it is module-private.

- [ ] **Step 4: Run, pass. `npm test`, gates, tsc. Commit.**

---

### Task 4: `updateCalendarEvent` and `removeCalendarEvent`

**Files:** modify `src/lib/calendar-event-service.ts`, `tests/calendar-event-service.test.ts`

- [ ] **Step 1: Write the failing tests**, per spec §12:442: an update by a non-creator non-admin returns `You can only edit events you created` with nothing written; an update changing **only the title** writes **no notification**; an update that moves `startsAt` writes **one notification per attendee carrying `movedFrom`**; a remove clears notifications and **leaves the activity row**.

- [ ] **Step 2: Implement `updateCalendarEvent`.** Load the event first; enforce D10 (creator or admin — the `announcement-service.ts:82` check); diff with `fieldDiff` over `["title", "description", "startsAt", "endsAt", "allDay", "projectId", "clientId"]`; return `ok(undefined)` when nothing changed — `fieldDiff`'s `normalize` compares dates **by value**, so re-saving an unchanged time logs nothing and rings nothing. The attendee set is a true diff in the `attemptTaskAssigneeDiff` shape (`task-service.ts:357-435`): only **added** ids are validated, removals read their names off rows already loaded, and an unchanged submission writes nothing.

⚠️ **The notification fires only when `startsAt`, `endsAt` or `allDay` appears in the diff.** Not on a title edit, not on a description edit, not on an attendee change, not on delete. Recipients are the attendees **after** the diff. `meta` adds `movedFrom` (the previous formatted string) and `date` is the **new** day.

⚠️ **`meta.date` must be written on BOTH firing paths.** Without it every row takes `notificationHref`'s fallback and lands on `/calendar` at whatever period the URL defaults to — a link that appears to work and does not.

- [ ] **Step 3: Implement `removeCalendarEvent`** — calls `clearNotificationsFor(tx, { entityType: "CALENDAR_EVENT", entityId })` inside its transaction, because `entityId` carries no foreign key and nothing cascades. **Activity rows are left alone**; the asymmetry is argued at `task-service.ts:327-329`.

- [ ] **Step 4: Run, pass. `npm test`, gates, tsc. Commit.**

---

### Task 5: the server actions

**Files:** create `src/server/actions/calendar-events.ts`

- [ ] **Step 1: Read `src/server/actions/tasks.ts` first**, especially the revalidation-map block comment at `:3-25`. This file opens with the same kind of comment — it is a convention both existing action files carry.
- [ ] **Step 2:** Three actions — create, update, remove — each returning `ActionResult`. Attendees come from `formData.getAll("userId").map(String)`, **the one documented multi-value exception in this codebase** (`tasks.ts:20-24`).
- [ ] **Step 3:** `revalidatePath("/calendar")` on all three, declared in the map comment.
- [ ] **Step 4: tsc, lint, gates. Commit.**

---

### Task 6: `<EventForm>`

**Files:** create `src/components/calendar/event-form.tsx`

- [ ] **Step 1: Read `src/components/tasks/task-form.tsx` in full.** Spec §8:329-336 says `<EventForm>` copies its contract **clause by clause, because every clause was paid for**. Reproduce: `"use client"`; trigger and `<Modal>` as siblings in a fragment; one `Values` object from a pure `initialValues()`, controlled, with a generic `set<K extends keyof Values>`; `<form key={attempt}>` with `attempt` bumped **only** in the failure branch; `useActionState`; `<FormError>` as the form's first child; a `cancel()` that closes **and** resets, wired to both `onClose` and Cancel; a stable `formId` with the footer submit using `form={formId}` and `disabled={pending}`; `className="w-full"` on every field.

**One deliberate divergence:** a `trigger?: ReactNode` prop rendered in place of the default `<Button>` when supplied, because the day view opens this form from an event box. `ReactNode`, not a callback — the caller needs no state from the form.

- [ ] **Step 2: The eight fields in document order** (which is focus order — `modal.tsx:64` focuses the first non-hidden control): Title; Date; **All day** (`<Checkbox>`, and checking it **hides** the time fields rather than disabling them, so nothing invisible is submitted); Start/End as two `<Field type="time">` in `grid gap-4 sm:grid-cols-2`; Project `<Combobox>` with the `{ value: "", label: "No project" }` sentinel first; Client `<Combobox>`, `disabled` whenever a project is chosen and derived from it; Attendees; Description.

⚠️ **The attendee picker renders in edit mode too — the opposite of the task form, deliberately.** `task-form.tsx:301-306` suppresses it there because `updateTaskAction` never reads `userId`, so the control would silently do nothing. Here `updateCalendarEventAction` **does** read it and the service diffs the set, so the control does what it appears to. The trap that comment names is a picker whose changes are dropped, not a picker on an edit form.

⚠️ **A disabled `<Combobox>` still submits.** Its `disabled` goes to the visible input only; the hidden input always renders. That is the documented reason the Client field can be disabled without dropping out of `FormData`.

- [ ] **Step 3:** Hidden inputs carry `eventId` in edit mode and the derived `clientId`, **first in the form**. Modal `icon="event"`.
- [ ] **Step 4: No unit tests** — see Global Constraints. tsc, lint, gates. Commit.

---

### Task 7: `<EventRemoveControl>` and wiring the page

**Files:** create `src/components/calendar/event-remove-control.tsx`; modify `src/app/(app)/calendar/page.tsx`, `src/components/calendar/calendar-grid.tsx`

- [ ] **Step 1: Read `src/components/tasks/task-remove-control.tsx`.** Copy its **shape** — own `"use client"`, a plain `<form action={run}>`, fire-and-forget with its own `try`/`catch` rather than a `useActionState` reducer, because "deletion has no form state worth preserving on failure".

⚠️ **Do NOT copy its ending.** `task-remove-control.tsx:34` is `router.push("/my-tasks")`, justified because a task lives on its own page. An event lives in a **modal on `/calendar`**, and removing it leaves that page alive. A verbatim copy dumps the user on `/my-tasks` after deleting a meeting. Instead: **no `router.push`** — call an `onDone` callback supplied by `<EventForm>` (the same `cancel()` that closes and resets), and let `revalidatePath("/calendar")` re-render the grid underneath. Without that callback the control cannot close the modal, because `open` is owned by `<EventForm>`'s `useState`.

⚠️ **It is a SIBLING of the edit form, not a descendant.** `modal.tsx:110` and `:113` render body and footer as separate `<div>`s, so a `<form>` in the footer nests inside nothing. Getting this backwards produces invalid HTML that browsers silently reparent. The button reads **Remove** — matching `task-remove-control.tsx:50` and avoiding a collision with the modal's own Cancel. **No confirmation step**; deleting a task has none either.

- [ ] **Step 2: The page.** Add the fourth query — `prisma.client.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } })`. **A comment at that spot in `page.tsx` explains it was deliberately deferred from step 3** because an unread query costs a round trip on every load; you are its first reader, so add it now. Render the New event trigger in the header row beside `<CalendarFilters>`.
- [ ] **Step 3: The day view.** Make the event box open `<EventForm>` in edit mode by passing the box in as `trigger`. Per spec §7:325 the box **cannot become a raw `<button>`** — gate 2 forbids it, and the box carries positioning, lane width, a time label and a title. Pass the whole positioned node.
- [ ] **Step 4: Full toolchain**, then **stop the dev server, `rm -rf .next`, `npm run build`** in that order. Commit.

---

### Task 8: browser QA

⚠️ **Real Chrome via `mcp__plugin_chrome-devtools-mcp`, never the embedded pane** — it reports `visibilityState: "hidden"` and shows a correct page as a blank one. Assert `document.visibilityState === "visible"` before believing any measurement.

- [ ] Create a timed event; confirm it lands on the right day printing the right time. **Create one at 00:30 and one at 23:30** — the cell and the clock must agree.
- [ ] Create an all-day event; confirm it shows "All day", sorts first, and sits in the untimed band.
- [ ] The All day checkbox **hides** the time fields.
- [ ] Choosing a project **disables** the Client field and derives its value — and the event still saves with the right `clientId`.
- [ ] With no project, the Client picker is live and a client-only event saves.
- [ ] Edit an event's title only → **no notification**. Move its time → **one notification per attendee**, reading "moved to", linking to the right day.
- [ ] **The creator gets no bell row for their own event**, though they appear as an attendee.
- [ ] Attendee changes on edit actually persist — the picker is not decorative.
- [ ] Remove an event from the modal → the modal closes, the grid updates, **and the user stays on `/calendar`**.
- [ ] Both themes; phone width; a half-width lane is still tappable.
- [ ] Remove every seeded event and confirm the count returns to zero.

---

## Self-Review

**Spec coverage.** §5's three write-side helpers and §12:426's validator → Task 1. §9:385-392's four pure edits → Task 2. §8:359's create order → Task 3; §8:366's update and §9:394's remove → Task 4. The actions → Task 5. §8:329-351's form → Task 6. §8:353-357's remove control and the page → Task 7. §12:442 and `:444`'s assertions → Tasks 2-4. §15's criteria → Task 8.

**The four things most likely to go wrong**, each written into its task: `notify` on `db` instead of `tx`; `describeNotification` reusing the shared `"a task"` fallback; `meta.date` written on only one firing path; and `<EventRemoveControl>` copying `router.push("/my-tasks")`.

## Execution Handoff

Subagent-driven, fresh implementer per task, review between each. **Never run a review concurrently with an implementer** — a review earlier in this project had to work around a mutating tree.
