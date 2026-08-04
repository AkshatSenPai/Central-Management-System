# Calendar events: meetings on the task calendar

**Runs after:** nothing, and it blocks nothing. It is the "Calendar events for meetings" entry in `TODO.md` (line 64), an owner request dated 2026-08-03, whose own text says "Settle the timezone story before writing the model, not after" (`TODO.md:68`). This spec settles it.
**Delivers:** one Prisma model and one join table; a timezone rule that renames eleven date helpers, fixes two arithmetic sites the renames would otherwise break, and rewrites nine test assertions; `src/lib/calendar-event.ts` with its pure rendering arithmetic, `src/lib/calendar-event-queries.ts`, `src/lib/calendar-event-service.ts`, `src/server/actions/calendar-events.ts`, `src/components/calendar/event-form.tsx`, `src/components/calendar/event-remove-control.tsx`, a rewritten `src/components/calendar/calendar-grid.tsx`, and one new `NotificationType`.

## 1. Why now

The calendar exists and shows one thing. `src/app/(app)/calendar/page.tsx:46` calls `listTasksInRange`, whose entire `where` clause is `{ dueDate: { gte: input.from, lt: input.to } }` (`src/lib/task-queries.ts:139`), and `CalendarGrid` renders `TaskListRow[]` and nothing else (`src/components/calendar/calendar-grid.tsx:202`). The page states the boundary outright at `:15-16`: "'Scheduled date' in the spec is not a separate column and is not invented here: due date is the only date a task has." A meeting is not a task with a due date, and the honest way to put one on this calendar is a second model, not a second meaning for `dueDate`.

**The app has never rendered a clock time.** A grep across `src/` for `toLocaleTimeString`, `timeStyle`, `hour:`, `minute:`, `hour12`, `getUTCHours` and `type="time"` returns nothing. The four date formatters — `shortDate` (`src/lib/dates.ts:21`), `monthYear` (`:26`), `calendarTitle` (`src/lib/calendar.ts:103`) and `todayLabel` (`src/lib/dashboard.ts:21`) — pass only `weekday`/`day`/`month`/`year`, each pinned to `timeZone: "UTC"`. `relativeTime` (`dates.ts:57`) renders elapsed durations, never a clock. There is no house style for a time string, and this spec sets the first one.

**The UTC pinning is not incidental, and it is not wrong — it is under-specified.** `dates.ts:30-33` explains it: due dates are UTC midnight, so bucketing in local time "would put a task due 'today' into yesterday for anyone west of UTC, which is the overdue bucket." `calendar.ts:3-11` repeats it and adds the sharper point, that nothing slices an ISO string because `dueDate` carries no constraint forcing midnight. Both arguments survive intact. What neither anticipated is a stored instant that is *deliberately* not midnight. At 01:00 IST on the 6th, an event is stored at `2026-08-05T19:30:00.000Z`; `groupByUtcDay` files it under the 5th while any honest time label on it reads "01:00" on the 6th. The day something appears on must match the time printed on it, and today's code cannot make that true for both at once.

The one countervailing decision is `dates.ts:30-36`'s claim that a UTC calendar-day comparison is what every reader needs. It was true when every reader was west-of-UTC-hypothetical. The studio is six people in one city (`TODO.md:7`), and §5 shows the switch costs those readers nothing: every existing `dueDate` keeps the cell it is in today.

## 2. Scope

**In:**

- `prisma/schema.prisma` — `CalendarEvent`, `CalendarEventAttendee`, one new `NotificationType` member, two `User` back-relations, one each on `Client` and `Project`.
- `src/lib/dates.ts` — `APP_TIMEZONE`, the offset constant, `startOfUtcDay` → `startOfAppDay`, four app-field accessors, a `HH:MM` parse/format pair, and a time formatter. `parseDateInput` is **not** changed (D3).
- `src/lib/calendar.ts` — six renames, one signature change, and **two real arithmetic edits** (`:116` and `:139`, both of which read a UTC field off a value that becomes an app-midnight instant — §5 names them).
- `src/lib/dashboard.ts` — the `startOfUtcDay` re-export at `:11` and `todayLabel` at `:21-25`; `src/lib/dashboard-queries.ts` — the import at `:5` and the call at `:104`, rename only; `src/lib/announcement.ts` — `isPinned`'s day boundary (`:26`) and `pinLabel`'s pinned zone (`:53`).
- `src/lib/calendar-event.ts` — the zod schema, the timed/untimed split, the timeline window, the lane assignment and the month-cell merge. Everything that can be tested at all (§12).
- `src/lib/calendar-event-queries.ts`, `src/lib/calendar-event-service.ts`, `src/server/actions/calendar-events.ts` — reads, writes, the action boundary, in the three-file shape every domain in this repo already uses.
- `src/components/calendar/calendar-grid.tsx` — rewritten to take two row arrays; `event-form.tsx` and `event-remove-control.tsx` are new.
- `src/lib/notifications.ts`, `src/lib/notification-service.ts`, `src/lib/activity.ts` — one enum member, one entity kind, three verbs, three sentences.
- `src/app/(app)/calendar/page.tsx` — a fourth query in the existing `Promise.all`, two widened `select`s, and the New event trigger (§6 states the delta precisely; it is not one line).
- `tests/calendar.test.ts`, `tests/dashboard.test.ts`, `tests/announcement.test.ts` — the three suites step 1 edits, all three for the day-boundary move and nothing else.

**Out:**

- **Recurring events.** Explicitly deferred; no design offered here. `TODO.md:52` prices it: the same cron, a migration for `recurrenceRule`/`recurringTemplateId`, and an RRULE dependency — none of which exist, for tasks either. Revisit with recurring tasks, not before, so the two share one expansion strategy instead of inventing two.
- **RSVP, accept/decline, and any attendance state.** At six people "can you make 3pm" is a message, not a schema column. Attendees are named (D6) and that is the whole model.
- **Per-user timezones.** Ruled out in D1, with the arithmetic in §5. A `User.timezone` column would make every cell boundary a per-request computation and every cached page per-user, to serve a second timezone nobody is in.
- **External calendar sync** — Google Calendar, Outlook, `.ics` export or import. Explicitly deferred; no design offered here. It needs OAuth scopes, a sync token store and a conflict policy for edits made on the other side, which is a phase, not a section.
- **Availability and conflict detection.** Nothing warns that two events overlap, or that an attendee is double-booked. Overlapping events still both *render* — `assignLanes` (§7) is a layout function, not a warning — but the app never says "Priya is busy". At six people that is a glance at the same screen.
- **Multi-day events.** An event starts and ends on one app day (D5). A three-day offsite is three events or a note in the description. Spanning bars across a month grid are a different renderer, and the cell already truncates at three rows (`calendar-grid.tsx:97`).
- **A live "now" line on the day timeline.** `page.tsx:31` pins one `now` for the whole render, deliberately, so a server-rendered line is wrong within the hour and silently so. A correct one needs a client timer and a component that owns its own clock. Revisit if anyone asks for it.
- **An event detail page.** Everything about an event fits in the edit modal, and a route would need its own layout, loading state and revalidation entry for a record with six fields. Notifications therefore link to the day view (D9).
- **Attachments and comments on events.** Both exist for tasks; neither is in this model. The R2 pipeline is not built yet (`TODO.md:63`), and threading a discussion under a meeting is the "meeting notes" line in Phase 7 (`TODO.md:76`).

## 3. Owner rulings

| # | Decision |
|---|---|
| **D1** | **One app timezone, `Asia/Kolkata`, applied to grouping *and* display.** Instants are stored UTC in a Prisma `DateTime`; every day boundary, every grid cell and every printed time resolves in the app zone. Per-user timezones were considered and rejected: six people, one city, one office. The weaker alternative — keep UTC day-grouping and only *format* in IST — was considered and rejected harder, because it is the bug this spec exists to prevent: a 01:00 IST event lands in the previous day's cell while printing "01:00" on it, and a reader has no way to tell which of the two is lying. **The day something appears on must always match the time printed on it.** |
| **D2** | **The zone is applied as fixed-offset arithmetic, not an `Intl` round trip.** `Asia/Kolkata` is `GMT+05:30` with no DST, verified across three years of instants in this repo's own Node. So `startOfAppDay` is `floor((t + OFFSET) / DAY) * DAY - OFFSET`, and `addDays` (`dates.ts:41`) stays exactly the fixed 86 400 000 ms it is today. A `formatToParts` round trip was considered and rejected: it is thirty times slower per cell, it returns strings that must be re-parsed into an instant, and it buys DST-correctness for a zone that has none. The rejection is *paid for*, not assumed — §12 pins an independent `Intl` oracle test that fails the moment the constant and the IANA name disagree. |
| **D3** | **`parseDateInput` keeps returning UTC midnight.** It is the only parser for date-input values (`dates.ts:5-6`). Four modules *write* through it — `server/actions/tasks.ts:77`, `:124`; `projects.ts:66`, `:67`, `:105`, `:106`, `:208`, `:238` (the last two are the milestone `dueDate` path, a fifth column the "no row moves" proof also covers); `clients.ts:58`, `:100`; `lib/announcement-service.ts:36`, `:93` — and one *reads* through it, `calendar/page.tsx:35`, where it validates the `?date=` anchor and stores nothing. §5 proves UTC midnight always lands inside the matching `Asia/Kolkata` day, so every stored date keeps its cell with no migration. Re-pointing it at app-midnight was considered and rejected: it would rewrite the meaning of every `dueDate`, `startDate`, `clientSince` and `pinnedUntil` row already in the database, to fix nothing. |
| **D4** | **`toDateInputValue` *does* move to the app zone.** It is `toISOString().slice(0, 10)` today (`dates.ts:17`), a UTC slice, and `calendar-filters.tsx:57`, `:67` and `:76` feed it the prev/next/today anchors — which become app-midnight instants, i.e. 18:30Z on the previous day. Left alone it would page the calendar to the wrong day on every click. Every other caller (`task-form.tsx:63`, `project-form.tsx:52-53`, `client-form.tsx:48`, `announcement-form.tsx:31`) reads a UTC-midnight column, which formats identically in both zones, so this is a one-site fix that costs the other four nothing. |
| **D5** | **An event occupies exactly one app day, and `endsAt` is required.** The event covers the half-open interval `[startsAt, endsAt)`. A timed event ends later on the same app day it started; an all-day event ends at the *next* app midnight, which is the exclusive bound and not a second day — the same half-open convention `calendarRange` already uses. A nullable `endsAt` was considered and rejected: the day timeline has to draw a box, and a box needs a height, so "no end" would mean inventing one at render time, which is the same crime as placing a due task at 09:00 (D8). Multi-day was rejected in §2. **The one-day rule is structural, not validated.** The form has a single Date field and two `HH:MM` fields (§8), and `validateEventTimes` takes minutes since app-midnight (§12) — a cross-day end is not expressible in that representation even under a tampered submit, so there is nothing for a same-day check to reject and §10 carries no error string for it. What `validateEventTimes` *does* own is order and presence, and it owns it in the pure layer rather than a database `CHECK`: this repo has no check constraints, and the precedent for "the service layer pays for it" is written twice into the schema (`schema.prisma:182-186`, `:391-396`). |
| **D6** | **Everyone sees every event; attendees are a list of people, not a permission.** No `where` clause anywhere filters events by viewer. This matches the master spec's "everything is visible to everyone by design; the only private area is the vault", and the same reasoning already governs the activity feed (`activity.ts:256-261`, on why the dashboard feed is unscoped). Attendance drives exactly two things: whose bell rings (D7) and whose initials show on the row. A visibility flag was considered and rejected — a "private meeting" in a six-person studio is a WhatsApp message, and adding the column would put a permission check on the one surface that has never had one. |
| **D7** | **One new `NotificationType`, `EVENT_SCHEDULED`, fired to attendees on create and on a time change. Nothing else.** Not on a title edit, not on a description edit, not on adding or removing an attendee, not on delete. `task-service.ts:420-424` already made this call for assignment removals and priced it: "a bell that fires on every reshuffle is a bell people learn to ignore." Two types (`EVENT_SCHEDULED` + `EVENT_MOVED`) were considered and rejected: `describeNotification` already branches on `meta` for the same type (`notifications.ts:73` reads `meta.to`), so one type with `meta.movedFrom` renders both sentences without widening the enum. **Never the actor** — `notification-service.ts:45` filters `id !== input.actorId` centrally, documented at `:22-25` as a rule enforced in one place because "the one that forgot would be the one nobody noticed". No call site in this spec filters itself. |
| **D8** | **Month cells show events above tasks. Day and week split into an untimed band and an hour timeline.** A time is more specific than a day, so it sorts first. The untimed band carries due tasks *and* all-day events under one heading, `Due today · no set time`; the timeline below it carries only timed events. §7 applies that heading to the column it is true of and a day-neutral `No set time` to the rest, because a week view shows six days that are not today — the ruling names the string, not a claim that every column is today. Placing a due task at 09:00 on the timeline was considered and rejected: it invents a time nobody chose, and people then plan around it. |
| **D9** | **The event's user-facing noun is "event", the button is "New event", and neither is "meeting".** The model also carries "Priya on leave", which is not a meeting, and an all-day maintenance window, which is not one either. §13 locks the whole vocabulary and settles the collision with the two informal uses of "event" already in the codebase. |
| **D10** | **Editing and removing an event is the creator's or an admin's.** Attendance grants no write. This is the announcement rule exactly — `announcement-service.ts:82` and `:121` both check `existing.authorId !== input.actorId && !input.isAdmin` — applied to the other studio-wide writable object. "Anyone can edit" was considered and rejected: at six people it is defensible right up to the moment someone moves a call they are not on, and the bell then correctly names them as the actor to five people who have no idea why. |

## 4. Data model

Verbatim, in the house voice: prose only where a decision was contested, and every `///` comment names what it rejected.

```prisma
model CalendarEvent {
  id String @id @default(cuid())

  title       String
  description String?

  /// The instant it starts, stored UTC like every other DateTime here.
  /// Grouping and display resolve it in APP_TIMEZONE (src/lib/dates.ts) and
  /// never here. Storing wall-clock time instead was rejected: it needs a
  /// second column naming the zone that clock belongs to, and six people in
  /// one city do not have a second zone to name.
  startsAt DateTime

  /// The instant it ends, exclusive: the event covers [startsAt, endsAt),
  /// half-open like calendarRange. A timed event ends later on the same app
  /// day it started. An all-day event ends at the NEXT app midnight — that is
  /// the exclusive bound, not a second day. Nullable was rejected: the day
  /// timeline draws a box, a box has a height, and "no end" would mean
  /// inventing one at render time. Postgres cannot express any of this
  /// without a CHECK constraint this schema has no precedent for, so the form
  /// shape and validateEventTimes own it — the same trade the polymorphic
  /// parents make at ActivityLog and Attachment.
  endsAt DateTime

  /// True for "Priya on leave" and anything else that owns a day rather than
  /// a slot. It is a real column, not startsAt-is-midnight: an event that
  /// genuinely starts at 00:00 exists, and inferring the flag from the clock
  /// would make it undrawable.
  allDay Boolean @default(false)

  /// Who arranged it. Never cascades — the same rule as Task.creator: a
  /// deactivated member's meetings are still on the calendar, and members are
  /// deactivated rather than deleted precisely so history keeps its people.
  creator   User   @relation("CalendarEventCreator", fields: [creatorId], references: [id])
  creatorId String

  /// Optional, and independent of each other. A project pins the client too
  /// (the service copies it, and disagreement is impossible because the form
  /// derives it); a client with no project is the sales pitch to a prospect,
  /// which has nowhere else to hang. Deriving clientId through projectId
  /// alone — the way Task does — was rejected for exactly that case.
  project   Project? @relation(fields: [projectId], references: [id])
  projectId String?
  client    Client?  @relation(fields: [clientId], references: [id])
  clientId  String?

  attendees CalendarEventAttendee[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  /// The calendar's only query is a half-open window on startsAt, so the
  /// window column is the one that earns an index. projectId and clientId get
  /// theirs by the same house rule every other FK follows.
  @@index([startsAt])
  @@index([projectId])
  @@index([clientId])
}

/// One row per person per event, the shape TaskAssignee already proved. Not a
/// String[] on CalendarEvent: an array cannot be indexed by user, and "what is
/// on my plate this week" is the query this table exists for.
model CalendarEventAttendee {
  event   CalendarEvent @relation(fields: [eventId], references: [id], onDelete: Cascade)
  eventId String
  user    User          @relation(fields: [userId], references: [id])
  userId  String

  @@id([eventId, userId])
  @@index([userId])
}
```

`User` gains two fields, named for the role rather than the model, matching `tasksCreated` and `notified` (`schema.prisma:31`, `:37`):

```prisma
  eventsCreated    CalendarEvent[]         @relation("CalendarEventCreator")
  eventAttendance  CalendarEventAttendee[]
```

`"CalendarEventCreator"` collides with none of the nine names already taken (`schema.prisma:28-37`). `eventAttendance` needs no relation name — it is the only `User`↔`CalendarEventAttendee` pair, exactly as `taskAssignments` (`:32`) is for `TaskAssignee`. `Client` and `Project` each gain `calendarEvents CalendarEvent[]`.

`NotificationType` gains one member, beside the four that fire and the one that does not:

```prisma
  /// Attendees only, on create and when the time moves — never on a title or
  /// description edit, and never to the actor (notification-service.ts:45
  /// enforces that centrally). One type rather than two: describeNotification
  /// already branches on meta, so meta.movedFrom carries "scheduled" versus
  /// "moved" without widening this enum. meta carries { name, when, date }
  /// and optionally movedFrom; `date` is the YYYY-MM-DD app-zone day the link
  /// needs, and without it notificationHref has nowhere to point.
  EVENT_SCHEDULED
```

`Notification.entityType`/`entityId` are plain strings with no relation (`schema.prisma:360-365`), so a removed event leaves live rows pointing at a 404. `removeCalendarEvent` clears them explicitly in its own transaction, exactly as `removeTask` does (`task-service.ts:330`). Activity rows are never cleared, and the asymmetry is already argued at `task-service.ts:327-329`.

## 5. The timezone rule

This is the spine. Everything above depends on it and everything below inherits it.

**The constants**, in `src/lib/dates.ts` beside the helpers that consume them:

```ts
export const APP_TIMEZONE = "Asia/Kolkata";
const APP_OFFSET_MS = 330 * 60 * 1000; // +05:30, no DST, ever
```

**The proof that no existing row moves.** `parseDateInput` builds `` new Date(`${trimmed}T00:00:00.000Z`) `` (`dates.ts:10`), so every stored `dueDate`, `startDate`, `clientSince` and `pinnedUntil` is a UTC-midnight instant. Asia/Kolkata day *D* is the half-open interval `[D-1 18:30Z, D 18:30Z)`. UTC midnight of *D* is `D 00:00Z`, which is 5h30m after the interval opens and 18h30m before it closes. It is strictly inside, with 5.5 hours of margin on the near side — the largest margin any positive offset under 24h could give. Therefore `startOfAppDay(parseDateInput(x))` names day *x*, exactly as `startOfUtcDay(parseDateInput(x))` does today, **for every date input the app has ever accepted**. Checked mechanically over 800 consecutive UTC-midnight instants against `Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" })`: zero mismatches, and one distinct offset (`GMT+05:30`) across the whole span. **This is what makes the change a rename and a retest rather than a behaviour change**, and it is why D3 leaves `parseDateInput` alone.

**The root helper.** `startOfUtcDay` (`dates.ts:37`) is the function everything else composes, and it becomes:

```ts
export function startOfAppDay(d: Date): Date {
  const DAY = 24 * 60 * 60 * 1000;
  return new Date(Math.floor((d.getTime() + APP_OFFSET_MS) / DAY) * DAY - APP_OFFSET_MS);
}
```

Its result is an app-midnight instant, so `startOfAppDay(new Date("2026-07-29T10:00:00Z")).toISOString()` is `"2026-07-28T18:30:00.000Z"`. That is the single most surprising consequence of this section, the reason nine test assertions change, and the reason `calendar.ts:116` and `:139` are edits rather than renames: both read a UTC field off a value that is now an app-midnight instant.

**`addDays` (`dates.ts:41`) is not touched.** Fixed 86 400 000 ms arithmetic is exact in a zone with no DST, so consecutive app days really are 24h apart and `tests/calendar.test.ts:110` — which asserts precisely that between every pair of grid cells — keeps passing unmodified. In a DST zone this line would be the whole problem; here it is the whole saving. Its doc comment gains that sentence, because the next reader will assume otherwise.

**Reading app-local fields off an instant.** `getUTCDay()`, `getUTCMonth()` and friends are wrong on an app-midnight instant — 18:30Z on Tuesday is Wednesday in IST. Four accessors are exported instead of a shifted `Date`: `appWeekday`, `appYear`, `appMonth`, `appDayOfMonth`, each `new Date(d.getTime() + APP_OFFSET_MS).getUTC*()`. Exporting the shifted `Date` was rejected: it is an instant that lies about which instant it is, and the first person to store one or compare it against a real timestamp gets a five-and-a-half-hour bug with no symptom.

**Every function that changes, and how:**

| Function | File:line | Change |
|---|---|---|
| `startOfUtcDay` → `startOfAppDay` | `dates.ts:37` | Body replaced as above. Doc comment rewritten: the "west of UTC" argument is superseded, not merely edited. |
| `addDays` | `dates.ts:41` | Body unchanged. Comment added stating why fixed-ms survives (D2). |
| `shortDate` | `dates.ts:21` | `timeZone: "UTC"` → `timeZone: APP_TIMEZONE`. |
| `monthYear` | `dates.ts:26` | Same swap. |
| `toDateInputValue` | `dates.ts:15` | `toISOString().slice(0, 10)` → `Intl.DateTimeFormat("en-CA", { timeZone: APP_TIMEZONE })` (D4). `en-CA` because its short pattern *is* `YYYY-MM-DD`. |
| `parseDateInput` | `dates.ts:7` | **Unchanged** (D3). |
| `isOverdue`, `relativeTime` | `dates.ts:48`, `:57` | **Unchanged** — both compare or subtract instants, which no zone affects. |
| `startOfUtcWeek` → `startOfAppWeek` | `calendar.ts:27` | `day.getUTCDay()` → `appWeekday(day)`; the `(day + 6) % 7` shift and its comment survive verbatim. |
| `startOfUtcMonth` → `startOfAppMonth` | `calendar.ts:32` | `Date.UTC(getUTCFullYear, getUTCMonth, 1)` → `startOfAppDay` of the app-zone first, built from `appYear`/`appMonth`. |
| `calendarRange` | `calendar.ts:44` | No structural change. `from`/`to` become app-midnight instants, which is what makes the Prisma `gte`/`lt` at `task-queries.ts:139` *more* correct once stored times exist, not less. |
| `monthGrid` | `calendar.ts:59` | Composition only. Its cell keys and `groupByAppDay`'s keys must change in lockstep or `byDay.get(day.getTime())` (`calendar-grid.tsx:75`) silently misses every row. |
| `isSameUtcDay` → `isSameAppDay` | `calendar.ts:66` | Composition only. |
| `isInUtcMonth` → `isInAppMonth` | `calendar.ts:70` | `getUTCFullYear`/`getUTCMonth` → `appYear`/`appMonth`. |
| `isOverdueOnDay` | `calendar.ts:80` | Composition only. Its argument — a cell asks "is this day before today", not "is this instant past" (`:74-79`) — is untouched by the zone and stays word for word. |
| `groupByUtcDay` → `groupByAppDay` | `calendar.ts:89` | Keys become app-midnight epochs, **and the signature takes an accessor**: `groupByAppDay<T>(rows: T[], at: (row: T) => Date \| null)`. Tasks pass `r => r.dueDate`, events pass `e => e.startsAt`. A second near-identical function was rejected; so was widening the constraint to `{ dueDate }\|{ startsAt }`, which would make the map's own type depend on which union arm arrived. |
| `calendarTitle` | `calendar.ts:103` | Four `timeZone: "UTC"` literals (`:110`, `:120`, `:126`, `:130`) → `APP_TIMEZONE`, **and a fifth UTC read that is not a literal**: `:116`, `const same = from.getUTCMonth() === to.getUTCMonth()`, becomes `appMonth(from) === appMonth(to)`. `from` and `to` come from `startOfAppWeek`, so they are app-midnight instants and their UTC month is the previous one whenever a week touches a month boundary — and `same` is exactly what decides whether the left date prints its month. Left alone, the week Mon 26 Oct – Sun 1 Nov 2026 renders `"26 – 1 Nov 2026"`, dropping October from the heading precisely when a reader needs it, and the week Mon 1 – Sun 7 Jun 2026 renders `"1 Jun – 7 Jun 2026"` instead of `"1 – 7 Jun 2026"`. Both executed. Output *is* unchanged for all four existing fixtures — `"Wednesday, 29 July 2026"`, `"6 – 12 Jul 2026"`, `"27 Jul – 2 Aug 2026"`, `"28 Sept – 4 Oct 2026"` and `"July 2026"` re-derived under both zones — which is exactly why no test catches `:116` and why the two new cases below exist. |
| `stepAnchor` | `calendar.ts:135` | **A real edit, not composition.** The day and week branches are composition only. The month branch at `:139` is `new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + direction, 1))`, and `first` comes from `startOfAppMonth` on the line above — so `first` is an app-midnight instant, 18:30Z on the **last day of the previous month**, and both UTC accessors report the previous month. Left as composition the arithmetic is off by one in both directions: executed in this repo's Node against the helpers above, `stepAnchor("month", 2026-01-31, +1)` returns 2026-01-01 (the arrow does nothing), `("month", 2026-12-15, +1)` returns 2026-12-01 (never crosses the year), and `("month", 2026-03-31, -1)` returns 2026-01-01 — **skipping February, the exact bug the `:133-134` comment exists to prevent.** The line becomes `startOfAppDay(new Date(Date.UTC(appYear(first), appMonth(first) + direction, 1)))`, so all three branches return app-midnight instants like every other value in the file. The via-the-first month step and its February comment stand; the comment now describes something the code actually does. This is the one row in this table that would ship a visible regression if read as a rename. |
| `todayLabel` | `dashboard.ts:21-25` | Two `timeZone: "UTC"` literals and one `getUTCDate()` → `APP_TIMEZONE` and `appDayOfMonth`. Its three-lookup assembly and the reason for it (`:14-20`) are untouched. |
| `isPinned` | `announcement.ts:24-27` | Import swap only. The whole-day pin argument at `:16-22` is a day-granularity argument, not a zone one, and survives. |
| `pinLabel` | `announcement.ts:50-54` | `timeZone: "UTC"` → `APP_TIMEZONE`. |
| Re-export | `dashboard.ts:11` | `export { addDays, startOfUtcDay }` → `startOfAppDay`, which carries the rename into `dashboard-queries.ts:5`, `:104` and `dashboard.ts:43`, `:76`. |
| Call sites | `calendar-grid.tsx:8-16`, `:75-77`, `:94`, `:134`, `:207`, `:211`, `:220` | Mechanical renames, plus `day.getUTCDate()` → `appDayOfMonth(day)` at `:94`; the file is rewritten anyway (§7). |

**`calendar-filters.tsx` is not in that row, and that is the point.** Its three call sites (`:57`, `:67`, `:76`) all pass an anchor to `toDateInputValue`, and `toDateInputValue` keeps its name — D4 changes only its body. So the file is *fixed by* D4 without being edited, which is what makes D4 a one-site change and what §6 means by "`CalendarFilters` itself needs no edit". The import at `:8` does not move either.

**Completeness check.** `grep -rn "getUTC" src/` returns eight code hits: `dates.ts:38`, `calendar.ts:29`, `:33`, `:71`, `:116`, `:139`, `dashboard.ts:24`, `calendar-grid.tsx:94`. This table converts all eight. If a ninth appears during implementation it is a site nobody reasoned about, and it should be treated as a bug rather than a rename.

**Every test that must be updated.** Nine assertions genuinely change; three more keep their expected strings but only pass if `stepAnchor`'s month branch is fixed as the table specifies; the rest are renames.

- `tests/calendar.test.ts:16` — the `iso` helper is `toISOString().slice(0, 10)`, itself UTC. It becomes an `Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" })` call written out **in the test file, not imported from `dates.ts`**. That is deliberate: it makes the suite an independent oracle for D2's offset arithmetic instead of checking production code against itself.
- `tests/calendar.test.ts:147` — `isOverdueOnDay(WED, new Date("2026-07-29T23:59:59.000Z"))` expects `false` under the name "does not call today overdue, at any time of day". `23:59:59Z` is 05:29 IST *on the 30th*, so it becomes `true` and the test fails. Fixture moves to `2026-07-29T18:29:59.999Z`, the last instant of the IST day, which is what the test always meant.
- `tests/calendar.test.ts:173` and `:186` — **both** `map.get(WED.getTime())` lookups, not just the second. `WED` is UTC midnight and `groupByAppDay`'s keys are app-midnight, so `startOfAppDay(WED)` is `2026-07-28T18:30:00.000Z` and neither key matches; `map.get` returns undefined and both assertions fail. Each becomes `map.get(startOfAppDay(WED).getTime())`. `:186` is the non-midnight bucketing test, the one case that already exercised a `dueDate` with a time; `:173` is the plain one. Both fixtures and both intents stand, and the `describe` block and its first case title rename from "UTC day" to "app day".
- `tests/calendar.test.ts:218` — `isSameUtcDay(WED, new Date("2026-07-29T18:30:00.000Z"))` expects `true`. `18:30Z` is the first instant of the IST 30th, so it becomes `false`. Fixture moves to `18:29:59.999Z`. Line `:219` needs nothing — `2026-07-30T00:00Z` is the IST 30th either way.
- `tests/calendar.test.ts:247` — `startOfUtcMonth(WED).toISOString()` expects `"2026-07-01T00:00:00.000Z"` and becomes `"2026-06-30T18:30:00.000Z"`.
- `tests/dashboard.test.ts:30` — `startOfUtcDay(NOW).toISOString()` expects `"2026-07-29T00:00:00.000Z"` and becomes `"2026-07-28T18:30:00.000Z"`.
- `tests/dashboard.test.ts:36-40` — "does not shift the day for a late-evening UTC time", fixture `2026-07-29T23:59:59.000Z`. The premise inverts: that instant *is* the next app day. Fixture moves to `18:29:59.999Z` and the name to "…late-evening IST time", which is the property the app now needs.
- `tests/dashboard.test.ts:133-135` — "is pinned to UTC, so a late evening does not roll to tomorrow", asserting `todayLabel(new Date("2026-07-29T23:30:00.000Z"))` is `"Wednesday, 29 July"`. `23:30Z` is 05:00 IST **on the 30th**, so it returns `"Thursday, 30 July"` (executed). The premise inverts exactly as `:36-40`'s does. Fixture moves to `2026-07-29T18:29:59.999Z` and the name to "…late-evening IST time" — the same treatment, for the same reason, on the same file. This is the only late-evening UTC fixture outside `:36-40`, and it is the easiest one to miss because it is 130 lines away from it.
- `tests/announcement.test.ts:19` — `isPinned(d("2026-08-02"), new Date("2026-08-02T23:59:59.000Z"))` expects `true` and would become `false` for the same reason. Fixture moves to `2026-08-02T18:29:59.999Z`.
- `tests/calendar.test.ts:194-214` (`stepAnchor`) — **not renames only.** The three month assertions at `:207`, `:208` and `:212` keep their expected strings (`"2026-02-01"`, `"2026-02-01"`, `"2027-01-01"`) and need no edit, but all three fail unless `:139` is fixed as the table specifies. They are the regression guard for that row, and the fact that they already exist is why the bug is catchable at all. Do not file this block under renames; run it and believe the failure.
- **New cases pinning `calendarTitle:116`**, because no existing fixture starts or ends a week on the 1st and so neither direction is covered: `calendarTitle("week", new Date("2026-10-28T00:00:00.000Z"))` is `"26 Oct – 1 Nov 2026"` (the month must *not* be elided), and `calendarTitle("week", new Date("2026-06-03T00:00:00.000Z"))` is `"1 – 7 Jun 2026"` (it must). Both verified against the fixed arithmetic.
- Renames only, no assertion changes: `tests/calendar.test.ts:44-63` (`startOfUtcWeek`, all four cases pass unmodified once renamed — `:61`'s `23:59:59Z` is the IST 30th, still inside the week beginning Monday the 27th), `:93-127` (`monthGrid`, including the exact-24h assertion at `:110`), `:129-139` (`isInUtcMonth`, every fixture UTC midnight), the rest of `:163-192` (`:176-179`'s undated-row drop and `:189-191`'s empty map, neither of which looks up a key), `:223-243` (`calendarTitle`'s existing fixtures, every one re-derived under `Asia/Kolkata` and unchanged).
- Untouched entirely: `tests/dates.test.ts`. Its own comment at `:11-13` explains why — "Every fixture sits at 12:00:00Z so formatting never straddles a day boundary in any timezone the suite might run in". 12:00Z is 17:30 IST, same day, and that foresight is now load-bearing.
- Untouched: `tests/task.test.ts`, `tests/milestones.test.ts`, `tests/project.test.ts`, `tests/task-queries.test.ts`. They consume `shortDate` and `isOverdue` transitively on UTC-midnight or noon fixtures.

**The new time helpers**, all in `dates.ts` beside the two existing input parsers, because those two say they are the only ones (`:5-6`, `:14`):

```ts
/** `<input type="time">` submits "HH:MM" and nothing else. Returns minutes
 * since app-midnight, or null — the same treat-it-as-absent contract as
 * parseDateInput, and the same refusal to guess. */
export function parseTimeInput(value: string): number | null;

/** Repopulates a time input from a stored instant, in app time. */
export function toTimeInputValue(d: Date): string;

/** "15:00". en-GB and 24-hour, matching every other pinned formatter here and
 * dodging the am/pm question entirely. */
export function appTimeLabel(d: Date): string;

/** The write-side pair: a "YYYY-MM-DD" and an "HH:MM" become one instant.
 * Null if either half fails to parse. This is the only place a wall-clock
 * time is turned into a stored instant. */
export function appDateTime(date: string, time: string): Date | null;
```

## 6. Surfaces, modules and routes

One route changes: `/calendar`. No route is added.

`src/app/(app)/calendar/page.tsx` keeps its five accepted params (`:19-23`) and its resolution order (`:31-43`) exactly. `searchParams` stays awaited — `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md:117`: "Since the `searchParams` prop is a promise. You must use `async/await` or React's `use` function to access the values."

**The `Promise.all` at `:45-57` is not a one-line change**, and pretending it is would leave `<EventForm>` unbuildable. Three of its four members move:

- **A new member**, `listCalendarEventsInRange(prisma, { from, to, userId, projectId })`.
- **`projects` (`:52-56`) gains `clientId: true`.** It selects `{ id, name }` today, but §8's Client field derives its value from the chosen project, and the picker shape this repo already uses is `ProjectOption = { id; name; clientId }` (`task-form.tsx:33`). Without `clientId` on each option the derivation has nothing to derive from.
- **`members` (`:47-51`) gains `active: true`.** It selects `{ id, name }` today, and `<AssigneePicker>` — reused verbatim in §8 — requires `Array<{ id; name; active: boolean }>` (`assignee-picker.tsx:17`).
- **A fourth query, `clients`**, `{ id: true, name: true }` ordered by name, the shape `project-form.tsx:64` already takes for its client picker. There is no client query on this page today, and §8 item 6's live Combobox — the control that makes the prospect-with-no-project case reachable — has nothing to render without it.

`CalendarGrid` gains one prop, `events`. The subtitle at `:63-65` moves to a pure `calendarPeriodSummary(taskCount, eventCount)` so the two counts are pluralised in one place instead of two nested ternaries. The New event trigger sits in the header row beside `<CalendarFilters>`.

The filters are unchanged in shape and mostly in behaviour. `person` filters events by **attendee** (`attendees: { some: { userId } }`), the same clause shape `listTasksInRange` uses for assignees (`task-queries.ts:142`); `project` filters by `projectId`. **`status` does not touch events** — events have no status, and quietly hiding all of them behind a task filter would make the calendar lie. The visible consequence is stated rather than hidden: choosing "Done" shows completed tasks *and* every event. `CalendarFilters` itself needs no edit; it is one GET form for a reason (`calendar-filters.tsx:16-26`), and adding a fourth select would mean deciding what "no events" means as a URL state, which nobody has asked for.

Module layout, following the repo's own split — pure logic in `<domain>.ts`, reads in `<domain>-queries.ts`, writes in `<domain>-service.ts`:

- `src/lib/calendar-event.ts` — `calendarEventSchema`, `validateEventTimes`, `splitDayEvents`, `eventTimeLabel`, `timelineWindow`, `eventPosition`, `assignLanes`, `monthCellRows`, `calendarPeriodSummary`, `attendeeInitialsLabel`. No Prisma, no React.
- `src/lib/calendar-event-queries.ts` — `CalendarEventRow` and `listCalendarEventsInRange(db, { from, to, userId, projectId })`.
- `src/lib/calendar-event-service.ts` — `createCalendarEvent`, `updateCalendarEvent`, `removeCalendarEvent`, each `(db: PrismaClient, input)` returning `ActionResult` (`src/lib/action-result.ts:1-3`).
- `src/server/actions/calendar-events.ts` — three actions, opening with the revalidation-map block comment the two existing action files carry (`server/actions/tasks.ts:3-25`, `announcements.ts:3-18`).
- `src/components/calendar/event-form.tsx` and `event-remove-control.tsx`.

`CalendarEventRow` is the grid's whole contract, and like `TaskListRow` (`task-queries.ts:13-26`) it is flat and pre-formatted where formatting is shared:

```ts
export type CalendarEventRow = {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  creatorId: string;
  projectId: string | null;
  projectName: string | null;
  clientId: string | null;
  clientName: string | null;
  attendees: Array<{ id: string; name: string; initials: string }>;
};
```

`initials` comes from `clientInitials`, the same helper `mapAssignees` uses (`task-queries.ts:57`). Ordering is `[{ allDay: "desc" }, { startsAt: "asc" }, { createdAt: "asc" }]` — `desc` puts all-day first because Postgres sorts `false` before `true`, and all-day events belong at the top of a cell where the untimed band is.

## 7. Month, week and day rendering

`CalendarGrid` stays a server component (no `"use client"` today, and nothing here needs one). Its props become `{ view, anchor, now, rows, events }`, and it builds two maps at `:207` instead of one:

```tsx
const tasksByDay = groupByAppDay(rows, (r) => r.dueDate);
const eventsByDay = groupByAppDay(events, (e) => e.startsAt);
```

**Month.** Each cell renders events first, then tasks, capped at three rows total with a `+N more` count that spans both kinds. That is `monthCellRows(events, tasks, 3)` returning `{ events, tasks, overflow }` — the two lists already capped, in that order, and the overflow counted across both. Pure, so the truncation rule is testable and cannot drift between the row lists and the count. Two lists rather than one merged `rows` array because the renderer draws an event chip and a task chip differently, and a merged `Array<E | T>` would force it to discriminate the union at every element to find out which — §12's generic signature is the one both sections use. The existing comment at `calendar-grid.tsx:100-102` ("Truncated rather than scrolled: a cell that scrolls is a cell nobody scrolls. The count is the invitation to open the day view") stands and is now doing more work. An event row is a chip: a filled dot in `--accent` if it has no project, otherwise the project swatch already computed by `projectColorIndex` (`:32`), then `appTimeLabel(startsAt)` in the mono class, then the title truncated. All-day events show no time. The cell number comes from `appDayOfMonth(day)` in place of `day.getUTCDate()` (`:94`).

**Day and week** share `ColumnsView` as they do today (`:210-220`), and it gains two stacked regions.

*The untimed band* sits directly under each column header and contains that day's due tasks and its all-day events. It is the only place a due task appears in these two views. It renders nothing at all — no heading, no empty dash — when the day has neither, so a week of pure meetings does not grow seven empty captions.

**Its heading depends on the column, and this is the one place §13 locks two strings instead of one.** `Due today · no set time` is true of today and false of the other six days a week view shows — printing it over all seven would be a factual error on six columns, and on all seven whenever the visible week is not the current one. So the band reads `Due today · no set time` when `isSameAppDay(day, now)` — the check `ColumnsView` already makes at `calendar-grid.tsx:134` for its header highlight, reused rather than re-derived — and `No set time` otherwise. The day view of today gets the first; the day view of any other day, and six or seven columns of any week, get the second. Varying the string by day was considered against dropping "Due today" everywhere, and rejected: the day view of today is the screen people actually live on, and "Due today" is the phrase that tells them the band is not decoration.

*The hour timeline* sits below it and carries only timed events. Its window is computed once for the whole view, across every day on screen, by `timelineWindow(splitDayEvents(events).timed)`: from the earlier of 08:00 and the earliest start floored to the hour, to the later of 19:00 and the latest end ceiled to the hour. **It is fed the timed rows only, never the raw array**, and that is load-bearing rather than tidy: an all-day event runs app-midnight to app-midnight (D5), so a single "Priya on leave" anywhere in the visible period would drag the window to 00:00–24:00 for every column — producing exactly the fixed full-day scroller this paragraph rejects, for a row the timeline does not even carry. One window for all seven columns, because per-column windows would leave the hour rows unaligned across the grid and make the week unreadable. A fixed 00:00–24:00 scroller was rejected: it opens on fourteen empty rows above the first meeting, every single time.

Within the window each event gets `eventPosition(event, window)` → `{ topPct, heightPct }`, both percentages of the window height, so the timeline scales with whatever height the column is given. A minimum height lives in CSS (`min-h-[22px]`), not in the arithmetic — a 15-minute call must stay clickable without the pure function knowing what a pixel is.

Overlapping events are laid out side by side by `assignLanes(events)`, a single sweep over events sorted by start that places each in the first lane whose last end is at or before its start, and reports `{ lane, laneCount }` per event where `laneCount` is the width of its overlapping cluster. Two calls at 15:00 render as two half-width boxes. **This is layout, not conflict detection** — nothing warns, nothing is flagged, nobody is told they are double-booked (§2).

Every event links to the day view for its own day rather than to a detail page (§2): `/calendar?view=day&date=YYYY-MM-DD`, with `transitionTypes={["nav-forward"]}` like every other link in the file (`:35`, `:164`). Clicking an event **in the day view** opens the edit modal instead — the event box *is* the trigger, which is why `<EventForm>` takes an optional trigger slot (§8) rather than always rendering its own `<Button>`. The box cannot simply be a `<button>`: gate 2 forbids a raw one, and the box is an absolutely positioned element carrying `topPct`/`heightPct`, a lane width, a time label and a title, none of which a default trigger knows about. It passes itself in.

## 8. Create, edit and delete

`<EventForm>` copies `<TaskForm>`'s contract clause by clause, because every clause was paid for:

- `"use client"`, trigger and `<Modal>` as siblings in a fragment, `const [open, setOpen] = useState(false)` (`task-form.tsx:90`, `:153-163`). **One divergence:** the trigger is a `trigger?: ReactNode` prop rendered in place of the default `<Button>` when supplied, because the day view opens this same form from an event box rather than a labelled button (§7). Unsupplied — the create case, and the edit case anywhere else — it is the `<Button>` `TaskForm` renders. The slot is `ReactNode` rather than a `renderTrigger` callback because the caller needs no state from the form; it needs only to be clickable, and `<EventForm>` wraps whatever arrives in the same click handler that sets `open`.
- One `Values` object seeded by a pure `initialValues()`, controlled, with a generic `set<K extends keyof Values>` — because "React 19 resets an uncontrolled form after the action resolves, including when it failed validation" (`task-form.tsx:91-94`).
- `<form key={attempt}>` with `attempt` bumped **only** in the failure branch (`:103`, `:112-114`, `:189`), for the `<select>`-and-checkbox reason at `:98-102`. This form has both: an All day checkbox and an attendee list.
- `useActionState`, `FormError` as the form's first child (`:202`), a `cancel()` that closes **and** resets wired to both `onClose` and the Cancel button (`:132-135`, `:167`), a stable `formId` (`:151`) with the submit button in the modal footer using `form={formId}` and `disabled={pending}` (`:181`).
- `className="w-full"` on every field — width is a call-site decision (`field.tsx:10-14`).
- Modal `icon="event"`, already in `ICON_NAMES` (`icons.ts:49`) and already rendered by `notificationIcon` (`notifications.ts:48`), so gates 7 and 8 are untouched and the font is not regenerated.

Fields, in document order — which is also focus order, since `modal.tsx:64` focuses the first non-hidden `input`/`select`/`textarea`:

1. **Title** — `<Field required>`.
2. **Date** — `<Field type="date">`, value via `toDateInputValue`, exactly as the task form's due date does it (`task-form.tsx:63`, `:291-298`). No new primitive is needed for this field or for the two below it: `type` is a native `InputHTMLAttributes` key and `Field` spreads every one of them onto the `<input>` (`field.tsx:75`, `:82`), so `type="time"` already type-checks today. What does not exist is the parse/format pair, which is why §5 adds it to `dates.ts` beside the app's only other input parser.
3. **All day** — `<Checkbox label="All day" name="allDay" value="1">`. Checking it hides the two time fields rather than disabling them, so nothing invisible is submitted.
4. **Start** / **End** — two `<Field type="time">` in a `grid gap-4 sm:grid-cols-2`, matching the pairing at `task-form.tsx:260`. Changing Start moves End to keep the gap, defaulting to one hour on the first pick; the user can then set End to anything the validator accepts.
5. **Project** — `<Combobox>` (`src/components/ui/combobox.tsx`), with the `{ value: "", label: "No project" }` sentinel first, exactly as the task form's project picker does (`task-form.tsx:231`).
6. **Client** — `<Combobox>`, `disabled` whenever a project is chosen and its value derived from that project. The combobox's `disabled` goes to the visible input only and the hidden input still submits, which is the documented reason a disabled combobox does not drop its field out of `FormData`. With no project chosen the picker is live, which is what makes the prospect-with-no-project case reachable (D5's sibling ruling in §4).
7. **Attendees** — `<AssigneePicker>` reused verbatim (`src/components/tasks/assignee-picker.tsx`). It renders no `<form>` of its own and names every checkbox `userId`, so the action reads `formData.getAll("userId").map(String)` — the one documented multi-value exception in this codebase (`server/actions/tasks.ts:20-24`). `handleFormChange` (`task-form.tsx:141-147`) comes across unchanged; it tests `target.name === "userId"` and is inert against every other field here. The creator is pre-checked in create mode and can be unchecked — nobody is forced to attend their own booking, and `notify` drops them from the recipient list regardless.

   **This picker renders in edit mode too, which the task form's does not**, and the divergence is deliberate rather than a copying error. `task-form.tsx:301-306` suppresses it on edit because "`updateTaskAction` never [reads `userId`] — the assignee set is owned solely by `setTaskAssignees` … Rendering this picker in edit mode would be a second, identical-looking control whose changes silently do nothing on save." An event has no second form to own its attendees and no reason to grow one: `updateCalendarEventAction` reads `userId` and `updateCalendarEvent` diffs the set, so the control does exactly what it appears to do. The trap that comment names is a picker whose changes are dropped, not a picker on an edit form.
8. **Description** — `<TextareaField>`.

Hidden inputs carry `eventId` in edit mode and the derived `clientId`, first in the form, as at `task-form.tsx:194-195`. `node_modules/next/dist/docs/01-app/02-guides/forms.md:126` names hidden inputs as the way to pass a value, with the caveat that "the value will be part of the rendered HTML and will not be encoded" — no new exposure, since these ids are already in the DOM as combobox option values.

**Delete** is `<EventRemoveControl>`, which copies `task-remove-control.tsx`'s *shape* and not its ending: its own `"use client"` component with a plain `<form action={run}>`, fire-and-forget with its own `try`/`catch` rather than a `useActionState` reducer, for the first half of the reason written at `:10-14` — "Deletion has no form state worth preserving on failure, so there's nothing to remount".

**The second half of that comment does not transfer, and neither does the line it justifies.** It reads "on success the task no longer exists, so this navigates away itself instead of relying on revalidatePath to re-render a page whose data is gone", and the implementation is `router.push("/my-tasks")` (`:34`). A task lives on its own page; an event lives in a modal on `/calendar`, and removing it leaves that page perfectly alive. A verbatim copy would dump the user on `/my-tasks` after deleting a meeting. So: **no `router.push`.** On success the control calls an `onDone` callback supplied by `<EventForm>` — the same `cancel()` that closes and resets (`task-form.tsx:132-135`) — and `revalidatePath("/calendar")`, declared in the action file's revalidation-map comment, re-renders the grid underneath. Without that callback the control has no way to close the modal, because `open` is owned by `<EventForm>`'s own `useState` (`:90`), and the user would be left looking at an edit form for a row that no longer exists.

It sits in the modal footer, left of the `<span className="flex-1" />`, and it is a **sibling** of the edit form, not a descendant: `modal.tsx:110` and `:113` render the body and the footer as separate `<div>`s, so a `<form>` in the footer nests inside nothing. Getting this backwards produces invalid HTML that browsers silently reparent. The button reads **Remove**, matching `task-remove-control.tsx:50` and avoiding the collision "Cancel event" would have with the modal's own Cancel. There is no confirmation step — deletion of a task has none either.

**The service.** `createCalendarEvent` follows `createTask`'s order exactly (`task-service.ts:106-186`): trim and validate, return `err(...)` early; resolve the project's `clientId` with a plain read and surface a missing FK as an `ActionResult` rather than a thrown foreign-key error (`:117-124`, and the reason at `:201-205`); resolve attendees through the same `active: true` filter, de-duplicating and rejecting the whole write when fewer rows come back than distinct ids requested; read the notification audience **before** opening the transaction (`:271-274`); then one `db.$transaction` containing, in order, the row write, the attendee `createMany({ skipDuplicates: true })`, `recordActivity(tx, …)`, `notify(tx, …)`. Wrap in `try`/`catch` and translate P2025 the same way. Return `ok({ id })`.

**Neither borrowed helper can be imported, and the two go opposite ways.** `resolveAssignees` (`task-service.ts:70`) and `isRowGoneRace` (`:350`) are both declared without `export`.

- **`isRowGoneRace` is duplicated**, three lines, following the precedent already set: `announcement-service.ts:8-10` copies it verbatim rather than importing it, and `notifications.ts:26-29` writes the file-local voice for exactly this trade — duplicated "rather than shared: that copy is module-private there, and exporting it to save six lines would couple" two vocabularies "which are free to diverge".
- **`resolveAssignees` gets a `resolveAttendees` twin** in `calendar-event-service.ts`, nine lines, with its own doc comment. Exporting the original was the alternative and is the weaker one: it would couple two services through a function whose comment currently says "Module-private; reused by Task 5's assignment diff", and a nine-line `findMany` is not obviously worth that. Implementer's call if the twin turns out to diverge in nothing at all — but it is a call, not an import that already works.

`updateCalendarEvent` loads the event first, enforces D10 (creator or admin, the `announcement-service.ts:82` check), diffs with `fieldDiff` (`activity.ts:101-116`) over `["title", "description", "startsAt", "endsAt", "allDay", "projectId", "clientId"]`, and returns `ok(undefined)` when nothing changed — `fieldDiff`'s `normalize` compares dates by value (`activity.ts:97`), so re-saving an unchanged time logs nothing and rings nothing. The attendee set is a true diff, the `attemptTaskAssigneeDiff` shape (`task-service.ts:357-435`): only added ids are validated, removals read their names off rows already loaded, and an unchanged submission writes nothing.

Exactly one activity row per call (`task-service.ts:160-161`), with `meta: { name: title }` so the feed renders without a join and survives a rename (`:398`).

## 9. Notifications

One type, `EVENT_SCHEDULED` (D7). Two firing conditions and no others:

- **On create** — recipients are the resolved attendees. `meta` carries `{ name: title, when: <formatted app-time string>, date: toDateInputValue(startsAt) }`.
- **On a time change** — recipients are the attendees *after* the diff, fired only when `startsAt` or `endsAt` or `allDay` appears in `fieldDiff`'s result. `meta` adds `movedFrom: <the previous formatted string>`, and `date` is the **new** day — the notification's job is to point at where the event now is, while `when` and `movedFrom` keep the frozen strings that say where it was.

`date` is a `YYYY-MM-DD` in the app zone, which is what post-D4 `toDateInputValue` returns and what makes `notificationHref`'s link land on the right cell. It is written on both paths and not only one: without it every `EVENT_SCHEDULED` row takes the fallback below and lands on `/calendar` at whatever period the URL defaults to, which is a link that appears to work and does not.

Nothing fires on a title edit, a description edit, an attendee change, or a delete. Removal notifies nobody for the reason `task-service.ts:420-424` already gives about assignment removals.

**The actor is never notified, and no code here checks that.** `notification-service.ts:45` is the single enforcement point — `const recipients = [...new Set(input.recipientIds)].filter((id) => id !== input.actorId)` — documented at `:19-32` as centrally enforced because "every caller would otherwise have to remember this, and the one that forgot would be the one nobody noticed". The schema asserts the same invariant at `schema.prisma:348-349`. So the creator, pre-checked as their own attendee in §8, gets a row on their own calendar and no row in their bell. The same call also dedupes, so an attendee added twice by a racing edit gets one notification.

`notify` is called with the transaction client, never the outer `db`. `NotificationDb` is `Pick<PrismaClient, "notification">` precisely so a `tx` satisfies it (`notification-service.ts:8`), and the reason is at `:3-7`: widening it "would force every caller to notify outside its transaction — and then a rolled-back assignment would still have told somebody it happened."

Four pure-layer edits, each keeping its function total:

- `NotificationEntity` (`notification-service.ts:15`) gains `"CALENDAR_EVENT"`. It is a union rather than a free string so `notificationHref` stays exhaustive (`:12-14`).
- `notificationIcon` (`notifications.ts:39`) maps `EVENT_SCHEDULED` → `"event"`. No new icon, no font regeneration, gates 7 and 8 unaffected.
- `describeNotification` (`notifications.ts:59`) gains one case with two sentences: `` `${who} scheduled ${what} — ${when}` `` when `meta.movedFrom` is absent, `` `${who} moved ${what} to ${when}` `` when it is present. Both read `meta` defensively through `metaString` (`:21-24`), which returns null for anything that is not a string, so a hand-edited row never renders `undefined`. **But this case does not use the shared `what`.** `notifications.ts:65` is `const what = metaString(n.meta, "name") ?? "a task";` — one binding for every branch, with a fallback that is a lie here: an `EVENT_SCHEDULED` row missing `meta.name` would read "Priya scheduled a task", leaking the wrong noun into the surface §13 locks hardest. So the new case reads `metaString(n.meta, "name") ?? "an event"` locally. Hoisting the fallback to a per-type default map was the alternative and is worth doing the moment a third type needs a noun of its own; at two it is a local `const`.
- `notificationHref` (`notifications.ts:87`) gains a case returning `` `/calendar?view=day&date=${date}` `` where `date` is the `YYYY-MM-DD` string both firing conditions above write into `meta`, falling back to `/calendar` when it is absent or malformed — which, given that contract, only a hand-edited row can be. Its parameter widens to `{ entityType: string; entityId: string; meta?: Record<string, unknown> | null }`. The one call site already passes the whole row (`notification-bell.tsx:126`, where `NotificationRow` carries `meta`), and making the new field optional means `tests/notifications.test.ts` compiles unchanged.

The captured `when` string is display data frozen at write time, exactly as `schema.prisma:367-369` prescribes for `meta`: "Read rather than re-queried, so the panel is one query and a since-renamed task still reads as it did when the thing happened." A notification that said "moved to 15:00" keeps saying so after a second move, which is the correct history. `date` is frozen by the same rule and for the same reason — each row carries the day the event was on *when that row was written*, so an old notification links to the day it announced rather than silently re-pointing at wherever the event ended up.

`removeCalendarEvent` calls `clearNotificationsFor(tx, { entityType: "CALENDAR_EVENT", entityId })` inside its transaction, because `entityId` carries no foreign key and nothing cascades (`notification-service.ts:60-66`, `task-service.ts:330`). Activity rows are left alone.

## 10. Empty, loading and error states

- **A period with no tasks and no events** — the existing `<EmptyState>` under the grid (`calendar/page.tsx:85-91`) keeps its place and gains the second half of the sentence: nothing due, nothing scheduled, and undated work still lives at `/my-tasks`. Said once under the grid rather than in every cell, which is the rule the comment at `:82-84` already states.
- **A month cell with nothing in it** — blank, as today. A dash per empty cell across 42 cells is noise.
- **A day column with no untimed rows** — the band does not render. Not an em-dash, not a caption. The band is a heading over content; with no content there is nothing to head.
- **A day with events but none timed** — the band renders, the timeline does not.
- **A day with no events at all in the day view** — the timeline still renders its hour rows over the default 08:00–19:00 window, because an empty grid of hours reads as "nothing booked" while a blank panel reads as broken.
- **Loading** — no `loading.tsx` is added. The route has none today (thirteen others do), the page is one `Promise.all` of five small queries (§6), and `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/loading.md:78` describes exactly what one would do — wrap the page in a `<Suspense>` boundary — which is a decision about this route's perceived latency, not about events. Out of scope; raise it as its own item.
- **Form errors** — every failure returns `err(...)` and surfaces through `<FormError>` as the form's first child (`task-form.tsx:202`). The strings: `Give the event a title`; `An event needs a start and an end time`; `The end time must be after the start time`; `Project not found`; `Event not found`; `You can only edit events you created`. There is deliberately **no** same-day error: D5 explains why the rule is structural, and a string no input can reach is a string that rots. The last two are the shapes `task-service.ts:196` and `announcement-service.ts:83` already use.
- **A stale form** — an event deleted by someone else between render and save surfaces as `Event not found` through the P2025 translation (`task-service.ts:350-352`), never as a thrown Prisma error.
- **A deactivated attendee** — renders identically to an active one, because `AssigneePicker`'s own comment records that "the vocabulary lock has no string for 'inactive', so this list never says it". New attendees are resolved through the `active: true` filter and an unknown or deactivated id returns `Invalid input` with no write issued (`task-service.ts:65-81`).

## 11. Security

- **Every action is `requireUser`.** No `requireAdmin` at the door, matching `server/actions/tasks.ts:17-18` and `announcements.ts:15-17`. `requireUser` is `src/server/guards.ts:6-9`, and `AuthError` is caught per action with `catch (e) { if (e instanceof AuthError) return err(e.message); throw e; }`.
- **Reads are unfiltered by design** (D6). There is no per-viewer `where` clause on events, and adding one later means deciding what a hidden event does to a shared day count.
- **Writes are creator-or-admin** (D10), enforced in the service and not at the door, "because a member editing their *own* post is allowed" (`announcements.ts:16-17`) — the same asymmetry, for the same reason.
- **The action never reads the session.** It passes `prisma` as the first argument and `actorId: user.id`, and the service takes both. That is what makes `calendar-event-service.ts` testable against a fake db (§12).
- **Every scalar `FormData` read is `String(formData.get("x") ?? "")`**, with `formData.getAll("userId").map(String)` as the one documented multi-value exception (`tasks.ts:20-24`).
- **`allDay` is parsed, not defaulted.** A checkbox submits its `value` when checked and nothing at all when unchecked, so the read is `formData.get("allDay") === "1"`. The times are re-parsed through `parseTimeInput`, which returns null for anything that is not `HH:MM` — a tampered `"25:99"` is an `err`, never a silently clamped instant. This is the rule `tasks.ts:62-68` states for enums: "A silent fallback would let a tampered or stale request create a task under a status the sender did not choose, and report success."
- **`userId` values are opaque cuids** and are validated by existence, not by shape — an unknown id fails `resolveAssignees` and the whole write is rejected.
- **Nothing new is logged that was not already public.** An event's title reaches the activity feed and the bell as `meta.name`, and both are studio-wide surfaces already.

## 12. Testing

`vitest.config.ts` is `environment: "node"`, `include: ["tests/**/*.test.ts"]`, no setup files, no plugins. **Components cannot be rendered in this repo** and this spec does not pretend otherwise: `calendar-grid.tsx`, `event-form.tsx` and `event-remove-control.tsx` have no unit tests and cannot have any. Services *can* be tested, and are — `tests/task-service.test.ts` builds a hand-rolled fake with separate write sinks for `db` and `tx` (`:52-57`) so that "a write issued on the outer `db` … lands in `dbW` and fails any test asserting it empty, instead of silently passing". Three files:

**`tests/calendar-event.test.ts`** — the pure layer.

```ts
export function validateEventTimes(start: number | null, end: number | null, allDay: boolean): string | null;
export function splitDayEvents(events: CalendarEventRow[]): { untimed: CalendarEventRow[]; timed: CalendarEventRow[] };
export function eventTimeLabel(event: { startsAt: Date; endsAt: Date; allDay: boolean }): string;
export function timelineWindow(timed: CalendarEventRow[]): { startHour: number; endHour: number };
export function eventPosition(event: CalendarEventRow, window: { startHour: number; endHour: number }): { topPct: number; heightPct: number };
export function assignLanes(events: CalendarEventRow[]): Array<{ id: string; lane: number; laneCount: number }>;
export function monthCellRows<E, T>(events: E[], tasks: T[], limit: number): { events: E[]; tasks: T[]; overflow: number };
export function calendarPeriodSummary(taskCount: number, eventCount: number): string;
```

The parameter is named `timed` because that is what it must be given: `<ColumnsView>` calls it as `timelineWindow(splitDayEvents(events).timed)`, and handing it the raw array would let one all-day row open every column at 00:00–24:00 (§7).

Asserting: `validateEventTimes` rejects a null start, a null end, an end equal to the start and an end before it, each with its own string, and accepts any pair in order while returning null outright for `allDay` — there is no same-day case because the signature cannot express a cross-day end, which is the whole of D5's structural argument written as an absence; `splitDayEvents` puts every `allDay` row in `untimed` and every other row in `timed`, preserving the query's order within each; `eventTimeLabel` renders `"15:00 – 16:00"` with the same en-dash `calendarTitle` uses (`calendar.ts:128`) and `"All day"` for an all-day row, formatted in `Asia/Kolkata` from a UTC instant — the one test that would have caught a display-only timezone fix; `timelineWindow` returns 8–19 for an empty list and for a day entirely inside it, widens down for an 06:30 start and up for a 20:15 end, floors and ceils to whole hours, returns **one** window for a seven-day array whose extremes fall on different days, and — the case that pins §7's contract — **returns 8–19 for an array containing one all-day row and one 09:00–10:00 row**, so a leave day never opens the timeline to midnight; `eventPosition` puts a 09:00–10:00 event at 1/11th height in an 08:00–19:00 window and returns 0 for an event starting exactly at the window start; `assignLanes` gives one lane to non-overlapping events, two half-width lanes to a pair that overlaps, and reports the cluster width rather than the running total, so a third event overlapping only the second does not shrink the first; `monthCellRows` fills events before tasks, caps at the limit, counts overflow across both kinds, and returns zero overflow when the total is under the cap; `calendarPeriodSummary` singularises both counts independently and says so when either is zero.

**`tests/calendar.test.ts`** — extended, not replaced, with the assertion edits enumerated in §5, the two new `calendarTitle` month-boundary cases, plus new cases pinning D2. The important one is an **independent oracle**: for a spread of instants across three years, `startOfAppDay(t)` must format to the same `YYYY-MM-DD` under `Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" })` as `t` does, and must itself be `00:00` in that zone. That test fails the moment the offset constant and the IANA name disagree, which is the entire risk D2 accepts. Plus: `groupByAppDay` buckets a 19:30Z instant into the *following* app day (the 01:00 IST case from §1, asserted directly); and `startOfAppDay(parseDateInput(x))` names day `x` for a year of consecutive dates, which is the §5 proof written as an executable claim rather than a paragraph.

**`tests/calendar-event-service.test.ts`** — the `fakeDb` shape from `tests/task-service.test.ts`, asserting: the row, the attendee rows, the activity row and the notification rows all land on the **tx** sink and never on the outer `db`; exactly one activity row per call; a create with a project resolves and stores that project's `clientId`; a create whose `projectId` does not resolve returns `Project not found` with nothing written; an update by a non-creator non-admin returns `You can only edit events you created` with nothing written; an update that changes only the title writes no notification; an update that moves `startsAt` writes one notification per attendee carrying `movedFrom`; a create whose only attendee is the actor writes zero notifications, proving the `notification-service.ts:45` filter is doing the work rather than the call site; a remove clears notifications and leaves the activity row.

`tests/notifications.test.ts` gains cases for both `EVENT_SCHEDULED` sentences, the `"event"` icon, the `notificationHref` day link built from `meta.date` **and** its `/calendar` fallback when `meta.date` is missing, and — the one that catches the shared-fallback trap — an `EVENT_SCHEDULED` row with no `meta.name`, which must read "an event" and never "a task".

**What this does not test, stated plainly:** the grid's rendering, the timeline's CSS, the modal's focus and Escape behaviour, the All-day checkbox hiding the time fields, and whether a half-width lane is actually clickable at phone width. Browser QA carries all five, as it has carried components since Phase 1 — and per `TODO.md:111-113` it must be done in `chrome-devtools-mcp` with `document.visibilityState === "visible"` asserted first, because the embedded browser pane does not composite and will show a correct page as a blank one.

## 13. Vocabulary lock

**The model is `CalendarEvent`; the user-facing noun is "event".** Both halves need defending.

`CalendarEvent` rather than `Event` because "event" is already taken twice, informally, in prose the app ships with: `schema.prisma:337` calls a `Notification` "one row per person per event", and `activity.ts:76` documents `clientId` as "Null for events that outlive their client". Neither is a `CalendarEvent`. A model called `Event` would make every one of those sentences ambiguous the day it lands, and `prisma.event` would sit in autocomplete next to `prisma.activityLog` meaning something entirely different. The qualifier costs eleven characters at the call site and removes the ambiguity permanently. Those two comments are amended in the same commit to say "notification row" and "activity rows" instead.

"Event" rather than "meeting" as the user-facing noun because the mockup's **New meeting** is a lie for half the model. "Priya on leave" is not a meeting; neither is an all-day maintenance window, nor a deadline someone wants on the shared calendar. Naming the button for the most common case forces every other case to be filed under a word that does not describe it, which is how a feature acquires a folk workaround. "Entry" was considered and rejected as jargon nobody says out loud; "booking" was rejected because it implies a resource being reserved, and nothing here reserves anything.

Locked strings, used everywhere and nowhere varied — **with one deliberate exception, the untimed band heading**, which is chosen per column by `isSameAppDay(day, now)` for the reason §7 gives: "Due today" is a claim about a day, and a week view shows six days it is false of.

| Surface | String |
|---|---|
| Trigger button, create | `New event` |
| Modal title | `New event` / `Edit event` |
| Submit button | `Create event` / `Saving…` / `Save changes` |
| Delete button | `Remove` |
| All-day field | `All day` |
| All-day row label on the grid | `All day` |
| Untimed band heading, today's column | `Due today · no set time` |
| Untimed band heading, any other column | `No set time` |
| People field | `Attendees` |
| Page subtitle | `N tasks due · M events in this period` |
| Empty state | `Nothing due or scheduled in this period. Tasks with no due date never appear here —` + `see all your tasks.` |
| Activity, create | `{who} scheduled {what}` |
| Activity, update | `{who} updated the event {what}` |
| Activity, remove | `{who} cancelled {what}` |
| Notification, create | `{who} scheduled {what} — {when}` |
| Notification, move | `{who} moved {what} to {when}` |

**There is no edit-trigger string**, and its absence is a decision rather than an omission. `TaskForm` renders an "Edit" button because a task page has room for one; an event is edited by clicking the event itself, in the month cell or on the day timeline, so the chip *is* the label and a second word beside it would say nothing the title has not. That is what §8's trigger slot exists to allow.

**Not used anywhere:** "meeting", "invite", "invitee", "guest", "appointment", "booking", "busy", "free", "RSVP", "accepted", "declined". The absent ones are absent because the features they name are out of scope, and shipping the word before the feature is how people come to expect it.

The three activity verbs are `event.created`, `event.updated`, `event.removed`, stored as plain strings in the `ActivityAction` union (`activity.ts:16-52`) which is "never a Prisma enum, so later phases add verbs without a migration" (`:14-15`). `ActivityEntityType` gains `"CALENDAR_EVENT"` (`:3-12`). `describeActivity` gains three cases and stays total — its `default` branch already returns `` `${who} updated this record` `` rather than throwing (`:244-246`). The stored verb is `event.removed`, following the file's `.removed` convention, while the rendered sentence says "cancelled": the column is a key, the sentence is English, and cancelling a meeting is what actually happened.

## 14. Migration and sequencing

Four deployable steps. The first is the risky one and it ships alone.

**Step 1 — the timezone rename, no new tables.** Everything in §5: the constants, `startOfAppDay`, the four accessors, the six renames in `calendar.ts`, **the two arithmetic fixes at `calendar.ts:116` and `:139`**, the `groupByAppDay` accessor signature, the call-site renames, the nine changed test assertions and the two new `calendarTitle` cases. It touches five `src/lib` files and three test files, all named in §2. **No migration, no schema change, no new feature.** It is verifiable entirely by `npm test` plus a browser pass confirming that every task sits on the day it sat on yesterday — which §5 proves it must, and which is exactly why this step is separable. Shipping it inside the events work would mean a red suite that could be blamed on either half.

**Step 2 — the model and the migration.** `prisma migrate dev` for `CalendarEvent`, `CalendarEventAttendee`, `EVENT_SCHEDULED`, and the four back-relations. No data migration: nothing existing becomes an event, and no column changes type. **Restart the dev server after `prisma generate`** or the client is stale and the new model is simply absent. Deployment needs nothing extra — `build` is already `prisma migrate deploy && next build` (`package.json`).

**Step 3 — reads and rendering.** `calendar-event.ts`, `calendar-event-queries.ts`, the rewritten `calendar-grid.tsx`, and the page's second query. Events are visible and nothing can create one yet, so the whole of §7 can be QA'd against seeded rows before any write path exists.

**Step 4 — writes and notifications.** `calendar-event-service.ts`, the actions, `event-form.tsx`, `event-remove-control.tsx`, and the four pure-layer edits in §9.

Gates, checked against `scripts/gates.mjs` rather than assumed:

- **Gate 1** (`:62`) greps `dark:|#[0-9a-fA-F]{3,6}` across `src/**/*.tsx` **and** `src/**/*.ts`, and is **not** comment-stripped — `stripComments` wraps gates 2, 3, 6 and 9 only. Doc comments in the four new `src/lib` files must contain nothing shaped like a hex colour.
- **Gate 2** (`:66`): no raw `<button>`. Every control here is `<Button>`.
- **Gate 3** (`:72-77`): no raw `<input>`/`<select>`/`<textarea>` outside `src/components/ui/`, hidden inputs exempt via `tagIsHidden` (`:9-19`). `<Field type="time">` and `<Field type="date">` go through the primitive, so nothing new is raw.
- **Gate 6** (`:96`): the modal already uses `shadow-[var(--shadow-lg)]` (`modal.tsx:89`); event chips use `--shadow` or nothing. Tailwind's built-in `shadow-lg` fails and gate 1 cannot see it, because no hex is involved.
- **Gates 7 and 8** (`:112`, `:121`): no icon is added and none becomes unused, so the font subset is untouched and `fetch-icon-font.mjs --check` still passes.
- **Gate 5** (`:99-105`) checks three named `ui/` files for the focus-ring literal. Nothing here touches them, and adding a new file to that list would fail the gate on a compliant file.

`TODO.md:64-72` is checked off in the same commit as step 4, with the spec path recorded the way the combobox entry does it (`TODO.md:77`).

## 15. Success criteria

- [ ] Every task that sat on a given day before step 1 sits on the same day after it — checked against a real month with tasks in it, not only in the suite.
- [ ] An event created for 01:00 appears in the cell for that day and prints `01:00` on it. The two agree; this is the bug the whole spec exists to prevent.
- [ ] An event created for 23:30 appears on that day and not the next one.
- [ ] Paging the calendar back and forward with the arrows lands on the expected month, and `Today` returns to today's cell — the `toDateInputValue` round trip through a `YYYY-MM-DD` anchor is lossless. Checked from the 31st in both directions and across a year boundary, because those are the three cases `stepAnchor`'s month branch gets wrong if `:139` is treated as a rename.
- [ ] The week heading names both months when a week straddles them, including the week of Mon 26 Oct 2026 (`26 Oct – 1 Nov 2026`), and names one when it does not, including the week of Mon 1 Jun 2026 (`1 – 7 Jun 2026`).
- [ ] A month cell containing two events and three tasks shows the two events above the first task and reads `+3 more`, with the count covering both kinds.
- [ ] The day view of today shows a due task and an all-day event together under `Due today · no set time`, and neither appears anywhere on the hour timeline.
- [ ] A week view whose visible days are not today reads `No set time` over every band, and the same week viewed while it *is* the current week reads `Due today · no set time` over exactly one column.
- [ ] A day carrying one all-day event and one 09:00–10:00 meeting shows a timeline that still opens at 08:00, not 00:00.
- [ ] No task is ever drawn at an hour position, at any zoom, in any view.
- [ ] A day whose only event runs 06:30–07:15 shows a timeline that starts at 06:00, and the week containing it uses one window across all seven columns with the hour rows aligned.
- [ ] Two events at 15:00 render side by side and both are clickable. Nothing warns about the overlap.
- [ ] Creating an event notifies every attendee except the creator, even when the creator is checked as an attendee.
- [ ] Moving an event's time notifies the attendees once, with a sentence naming the new time. Renaming it notifies nobody.
- [ ] Clicking that notification lands on the day view for the event's day.
- [ ] Removing an event closes the modal, leaves the viewer on `/calendar` with the grid re-rendered, clears the event's notifications and leaves its activity row; the activity feed reads `… cancelled …` and the bell shows nothing pointing at a 404. Nobody is navigated to `/my-tasks`.
- [ ] A member who is not the creator and not an admin sees the event, opens it, and gets `You can only edit events you created` rather than a silent failure or a hidden button.
- [ ] Choosing a project fills the client and locks the client picker; clearing the project unlocks it; an event with a client and no project saves and shows that client.
- [ ] Submitting an end time before the start time shows the error above the fields and keeps every value the user typed, including the All day checkbox and the attendee checkboxes, after the rejected submit.
- [ ] Ticking All day hides the time fields and saves a row whose `endsAt` is exactly 24h after `startsAt`.
- [ ] Opening the New event modal puts focus in the Title field, and Escape closes the modal without saving.
- [ ] The activity feed reads `Priya scheduled Verity kickoff call` — actor first, present tense, the same voice as every other sentence in the feed.
- [ ] Filtering by a person narrows both the tasks and the events; filtering by status narrows only the tasks, and every event stays visible.
- [ ] The calendar at phone width — the month cell, the day timeline and the modal. `TODO.md:104` records that only 1280px has ever been looked at.
- [ ] Both themes; the event chips read correctly in dark, and no colour is hardcoded.
- [ ] Browser QA run in `chrome-devtools-mcp` with `document.visibilityState === "visible"` asserted before any measurement is believed (`TODO.md:111-113`).
- [ ] `npm run gates`, `npm test`, `npx tsc --noEmit`, `npm run lint` and `npm run build` all clean.
