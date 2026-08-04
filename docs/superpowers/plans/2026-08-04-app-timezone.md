# App Timezone Implementation Plan — step 1 of the calendar events spec

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every day boundary and every printed date from UTC to a single app timezone, `Asia/Kolkata`. **No new tables, no new feature, no migration.** This is step 1 of four in `docs/superpowers/specs/2026-08-04-calendar-events-design.md` §14, and it ships alone so that a red suite can only be blamed on this half.

**Why it is separable:** every stored date is a UTC-midnight instant, and UTC midnight always falls strictly inside the matching `Asia/Kolkata` day with 5.5 hours of margin. So no row moves. The success criterion is precise — **every task sits on the day it sat on yesterday** — and it is checkable by `npm test` plus one browser pass.

**Spec:** `docs/superpowers/specs/2026-08-04-calendar-events-design.md`. §5 is the whole of this plan; D1–D4 are the rulings. Where this plan and the spec disagree, the spec wins — report the conflict rather than choosing.

## Global Constraints

- **`parseDateInput` does NOT change** (D3). It keeps returning UTC midnight. Re-pointing it would rewrite the meaning of every `dueDate`, `startDate`, `clientSince` and `pinnedUntil` row already in the database, to fix nothing.
- **`addDays` does NOT change** (D2). Fixed 86 400 000 ms is exact in a zone with no DST. Its comment gains a sentence saying so, because the next reader will assume otherwise.
- **`isOverdue` and `relativeTime` do NOT change.** Both compare or subtract instants, which no zone affects.
- **Never export a shifted `Date`.** The four accessors return numbers. A shifted `Date` is an instant that lies about which instant it is, and the first person to store one gets a five-and-a-half-hour bug with no symptom.
- **Gate 1** (`scripts/gates.mjs:62`) greps `dark:|#[0-9a-fA-F]{3,6}` over `src/**/*.ts` **and** `.tsx`, and is **not** comment-stripped. No doc comment may contain anything shaped like a hex colour.
- **The test-file `iso` helper is written out in the test file, never imported from `dates.ts`.** That is what makes the suite an independent oracle for the offset arithmetic instead of checking production code against itself.
- **Two rows in the spec's table are real edits, not renames** — `calendar.ts:116` and `calendar.ts:139`. Everything else in `calendar.ts` is composition or a mechanical rename. Treating either as a rename ships a visible regression.
- No new dependency. No jsdom, no `@testing-library` — `vitest.config.ts` is `environment: "node"` and components are not renderable in tests here.

## File Structure

| File | Change |
|---|---|
| `src/lib/dates.ts` | Constants, `startOfAppDay`, four accessors, three formatter swaps, one comment |
| `tests/dates.test.ts` | **Untouched** — every fixture sits at 12:00Z, which is 17:30 IST, same day |
| `src/lib/calendar.ts` | Six renames, two real arithmetic edits, one signature change |
| `tests/calendar.test.ts` | The `iso` helper, six assertion changes, two new cases, renames |
| `src/lib/dashboard.ts` | `todayLabel`, the re-export |
| `tests/dashboard.test.ts` | Three assertion changes |
| `src/lib/announcement.ts` | `isPinned` import swap, `pinLabel` zone swap |
| `tests/announcement.test.ts` | One fixture change |
| `src/components/calendar/calendar-grid.tsx` | Mechanical renames + `groupByAppDay`'s accessor argument |

---

### Task 1: `dates.ts` — the constants, the root helper, the accessors

**Files:** modify `src/lib/dates.ts`, create `tests/app-timezone.test.ts`

**Produces:** `APP_TIMEZONE`, `startOfAppDay`, `appWeekday`, `appYear`, `appMonth`, `appDayOfMonth`, and app-zone `shortDate` / `monthYear` / `toDateInputValue`.

- [ ] **Step 1: Write the failing tests**

Create `tests/app-timezone.test.ts`. This file is the independent oracle — it checks the offset arithmetic against `Intl`, never against `dates.ts`'s own constant:

```ts
import { describe, expect, it } from "vitest";
import {
  APP_TIMEZONE,
  appDayOfMonth,
  appMonth,
  appWeekday,
  appYear,
  parseDateInput,
  startOfAppDay,
  toDateInputValue,
} from "@/lib/dates";

/** Deliberately NOT imported from dates.ts. This is the oracle: if the
 * fixed-offset arithmetic and the IANA zone ever disagree, these fail. */
const istDate = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);

describe("APP_TIMEZONE", () => {
  it("is Asia/Kolkata", () => {
    expect(APP_TIMEZONE).toBe("Asia/Kolkata");
  });

  it("has exactly one offset across three years — no DST, ever", () => {
    // D2 rests on this. If India ever adopts DST the fixed-offset arithmetic
    // silently breaks, and this is the test that says so.
    const offsets = new Set<string>();
    for (let i = 0; i < 1100; i++) {
      const d = new Date(Date.UTC(2025, 0, 1) + i * 86400000);
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Kolkata",
        timeZoneName: "longOffset",
      }).formatToParts(d);
      offsets.add(parts.find((p) => p.type === "timeZoneName")!.value);
    }
    expect([...offsets]).toEqual(["GMT+05:30"]);
  });
});

describe("startOfAppDay", () => {
  it("returns the app-midnight instant, which is 18:30Z the previous day", () => {
    expect(startOfAppDay(new Date("2026-07-29T10:00:00.000Z")).toISOString()).toBe(
      "2026-07-28T18:30:00.000Z"
    );
  });

  it("treats 18:30Z as the first instant of the next app day", () => {
    expect(startOfAppDay(new Date("2026-07-29T18:30:00.000Z")).toISOString()).toBe(
      "2026-07-29T18:30:00.000Z"
    );
    expect(startOfAppDay(new Date("2026-07-29T18:29:59.999Z")).toISOString()).toBe(
      "2026-07-28T18:30:00.000Z"
    );
  });

  it("agrees with Intl for 800 consecutive UTC-midnight instants", () => {
    // The proof that no stored row moves: every dueDate, startDate,
    // clientSince and pinnedUntil is a UTC-midnight instant, and each must
    // still name the same calendar day it names today.
    for (let i = 0; i < 800; i++) {
      const utcMidnight = new Date(Date.UTC(2025, 0, 1) + i * 86400000);
      expect(istDate(startOfAppDay(utcMidnight))).toBe(istDate(utcMidnight));
    }
  });

  it("keeps every parseDateInput value naming its own day", () => {
    for (const s of ["2026-01-01", "2026-02-28", "2026-03-01", "2026-12-31"]) {
      expect(istDate(startOfAppDay(parseDateInput(s)!))).toBe(s);
    }
  });
});

describe("app field accessors", () => {
  it("read app-local fields off an app-midnight instant", () => {
    // 2026-07-28T18:30:00Z IS app-midnight on Wednesday 29 July.
    const appMidnight = startOfAppDay(new Date("2026-07-29T10:00:00.000Z"));
    expect(appYear(appMidnight)).toBe(2026);
    expect(appMonth(appMidnight)).toBe(6); // zero-based, July
    expect(appDayOfMonth(appMidnight)).toBe(29);
    expect(appWeekday(appMidnight)).toBe(3); // Wednesday
  });

  it("disagrees with the getUTC* equivalents, which is the whole point", () => {
    const appMidnight = startOfAppDay(new Date("2026-07-29T10:00:00.000Z"));
    expect(appDayOfMonth(appMidnight)).not.toBe(appMidnight.getUTCDate());
  });
});

describe("toDateInputValue", () => {
  it("formats an app-midnight instant as its own app day", () => {
    // D4: a UTC slice would return the previous day here.
    expect(toDateInputValue(startOfAppDay(new Date("2026-07-29T10:00:00.000Z")))).toBe(
      "2026-07-29"
    );
  });

  it("round-trips with parseDateInput", () => {
    expect(toDateInputValue(parseDateInput("2026-08-04")!)).toBe("2026-08-04");
  });

  it("returns an empty string for null", () => {
    expect(toDateInputValue(null)).toBe("");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run tests/app-timezone.test.ts
```

Expected: FAIL — `APP_TIMEZONE`, `startOfAppDay` and the accessors are not exported.

- [ ] **Step 3: Write the implementation**

In `src/lib/dates.ts`:

1. Add the constants at the top, beside the helpers that consume them:

```ts
export const APP_TIMEZONE = "Asia/Kolkata";
/** +05:30, and no DST — ever. Asia/Kolkata has had exactly one offset for its
 * whole modern history, verified across three years of instants in
 * tests/app-timezone.test.ts. That is what lets every day boundary in this app
 * be fixed-offset arithmetic instead of an Intl round trip, which is roughly
 * thirty times slower per cell and returns strings that must be re-parsed. */
const APP_OFFSET_MS = 330 * 60 * 1000;
```

2. Replace `startOfUtcDay` with `startOfAppDay`. The old doc comment argues from "west of UTC" and is superseded, not edited — rewrite it:

```ts
/** The first instant of the app day containing `d`.
 *
 * Its RESULT is an app-midnight instant, which is 18:30Z on the previous
 * calendar day — surprising the first time, and the reason getUTCDate() and
 * friends are wrong on anything this returns. Read app-local fields with the
 * accessors below instead. */
export function startOfAppDay(d: Date): Date {
  const DAY = 24 * 60 * 60 * 1000;
  return new Date(Math.floor((d.getTime() + APP_OFFSET_MS) / DAY) * DAY - APP_OFFSET_MS);
}
```

3. Add the four accessors. **They return numbers, never a shifted `Date`** — a shifted `Date` is an instant that lies about which instant it is:

```ts
/** App-local calendar fields. Numbers, deliberately: exporting the shifted
 * Date was rejected because the first person to store one or compare it
 * against a real timestamp gets a five-and-a-half-hour bug with no symptom. */
const shifted = (d: Date) => new Date(d.getTime() + APP_OFFSET_MS);
export const appWeekday = (d: Date) => shifted(d).getUTCDay();
export const appYear = (d: Date) => shifted(d).getUTCFullYear();
export const appMonth = (d: Date) => shifted(d).getUTCMonth();
export const appDayOfMonth = (d: Date) => shifted(d).getUTCDate();
```

4. `shortDate` and `monthYear`: `timeZone: "UTC"` → `timeZone: APP_TIMEZONE`.

5. `toDateInputValue`: `toISOString().slice(0, 10)` becomes an `Intl` format. `en-CA` because its short pattern *is* `YYYY-MM-DD`:

```ts
export function toDateInputValue(d: Date | null): string {
  if (!d) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: APP_TIMEZONE }).format(d);
}
```

6. `addDays`: body unchanged. Add to its comment: fixed 86 400 000 ms arithmetic is exact here because the app zone has no DST — in a DST zone this line would be the whole problem.

7. `parseDateInput`, `isOverdue`, `relativeTime`: **unchanged.**

- [ ] **Step 4: Run the new tests**

```bash
npx vitest run tests/app-timezone.test.ts
```

Expected: PASS.

- [ ] **Step 5: Confirm `dates.test.ts` still passes untouched**

```bash
npx vitest run tests/dates.test.ts
```

Expected: PASS with **no edits to that file**. Its own comment at `:11-13` explains why — every fixture sits at 12:00Z, which is 17:30 IST, the same day. If it fails, something in step 3 is wrong; do not edit the test to make it pass.

- [ ] **Step 6: Gates and types**

```bash
npm run gates && npx tsc --noEmit
```

`tsc` will report errors in `calendar.ts`, `dashboard.ts` and `announcement.ts` — those files still import `startOfUtcDay`, and Tasks 2 and 3 fix them. **That is expected at this point.** Gates must be 9/9.

- [ ] **Step 7: Commit**

```bash
git add src/lib/dates.ts tests/app-timezone.test.ts
git commit -m "feat: app timezone constants, startOfAppDay and the app-field accessors"
```

---

### Task 2: `calendar.ts` — six renames and two real edits

**Files:** modify `src/lib/calendar.ts`, `tests/calendar.test.ts`

**Consumes:** everything Task 1 exported.

⚠️ **Two rows here are arithmetic edits, not renames.** Read spec §5's table for `calendarTitle` and `stepAnchor` before starting. Both read a UTC field off a value that is now an app-midnight instant.

- [ ] **Step 1: Update the test file's `iso` helper and fixtures**

In `tests/calendar.test.ts`:

1. The `iso` helper at `:16` is `toISOString().slice(0, 10)`, itself UTC. Replace with an `Intl` call **written out here, not imported from `dates.ts`** — the suite must be an independent oracle:

```ts
const iso = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);
```

2. Change these fixtures and assertions:

| Line | Change |
|---|---|
| `:147` | `isOverdueOnDay(WED, new Date("2026-07-29T23:59:59.000Z"))` → fixture becomes `2026-07-29T18:29:59.999Z`, the last instant of the IST day, which is what "at any time of day" always meant |
| `:173` and `:186` | **both** `map.get(WED.getTime())` → `map.get(startOfAppDay(WED).getTime())`. Rename the `describe` block and its first case from "UTC day" to "app day" |
| `:218` | `isSameAppDay(WED, "2026-07-29T18:30:00.000Z")` now expects `false` — that instant is the IST 30th. Fixture moves to `18:29:59.999Z`. **`:219` needs nothing** |
| `:247` | `startOfAppMonth(WED).toISOString()` expects `"2026-06-30T18:30:00.000Z"` |

3. Add two new cases pinning `calendarTitle`'s `:116`, because no existing fixture starts or ends a week on the 1st:

```ts
  it("names both months when a week straddles them", () => {
    expect(calendarTitle("week", new Date("2026-10-28T00:00:00.000Z"))).toBe(
      "26 Oct – 1 Nov 2026"
    );
  });

  it("names one month when the week does not straddle", () => {
    expect(calendarTitle("week", new Date("2026-06-03T00:00:00.000Z"))).toBe(
      "1 – 7 Jun 2026"
    );
  });
```

4. Rename every call to the new names. **Do not touch** `:44-63`, `:93-127` (including the exact-24h assertion at `:110`), `:129-139`, `:176-179`, `:189-191`, or `:223-243` beyond renames — every one of those was re-derived under `Asia/Kolkata` and is unchanged.

5. **Do not touch `:194-214` at all.** Those three `stepAnchor` month assertions keep their expected strings and are the regression guard for the `:139` fix. Run them and believe the failure.

- [ ] **Step 2: Run and watch it fail in the right places**

```bash
npx vitest run tests/calendar.test.ts
```

Expected: FAIL — the renamed functions do not exist yet.

- [ ] **Step 3: Rewrite `calendar.ts`**

Mechanical renames and composition:
- `startOfUtcWeek` → `startOfAppWeek`: `day.getUTCDay()` → `appWeekday(day)`. The `(day + 6) % 7` shift survives verbatim. **Its comment at `:24` does not** — it reads "`getUTCDay()` is 0 for Sunday, so the shift is…", naming a call the code no longer makes. Update it to `appWeekday()`; the Sunday-is-0 fact stays true because the accessor returns `getUTCDay()` of a shifted instant. This is the ninth `getUTC` hit in `src/`, and the only one in a comment.
- `startOfUtcMonth` → `startOfAppMonth`: built from `appYear`/`appMonth`, fed through `startOfAppDay`.
- `isSameUtcDay` → `isSameAppDay`, `isInUtcMonth` → `isInAppMonth` (`getUTCFullYear`/`getUTCMonth` → `appYear`/`appMonth`), `isOverdueOnDay` composition only — **its comment at `:74-79` is a day-granularity argument, not a zone one, and stays word for word.**
- `calendarRange`, `monthGrid`: composition only.

`groupByUtcDay` → `groupByAppDay`, **and its signature takes an accessor** so events can reuse it in step 3:

```ts
export function groupByAppDay<T>(rows: T[], at: (row: T) => Date | null): Map<number, T[]> {
```

Tasks pass `(r) => r.dueDate`. A second near-identical function was rejected; so was widening the constraint to a union, which would make the map's own type depend on which arm arrived.

**The two real edits:**

`calendarTitle` — four `timeZone: "UTC"` literals (`:110`, `:120`, `:126`, `:130`) become `APP_TIMEZONE`, **and the fifth UTC read at `:116` that is not a literal**:

```ts
  const same = appMonth(from) === appMonth(to);
```

`from` and `to` come from `startOfAppWeek`, so their UTC month is the previous one whenever a week touches a month boundary — and `same` is exactly what decides whether the left date prints its month.

`stepAnchor` — the month branch at `:139`:

```ts
    return startOfAppDay(new Date(Date.UTC(appYear(first), appMonth(first) + direction, 1)));
```

`first` comes from `startOfAppMonth`, so it is 18:30Z on the last day of the previous month and both UTC accessors report the wrong month. Left as composition, the forward arrow does nothing and stepping back from 31 March skips February. The via-the-first month step and its February comment stand — the comment now describes something the code actually does.

- [ ] **Step 4: Run**

```bash
npx vitest run tests/calendar.test.ts
```

Expected: PASS, including the three untouched `stepAnchor` month assertions and both new `calendarTitle` cases.

- [ ] **Step 5: Commit**

```bash
git add src/lib/calendar.ts tests/calendar.test.ts
git commit -m "feat: calendar day boundaries move to the app timezone"
```

---

### Task 3: `dashboard.ts` and `announcement.ts`

**Files:** modify `src/lib/dashboard.ts`, `src/lib/announcement.ts`, `tests/dashboard.test.ts`, `tests/announcement.test.ts`

- [ ] **Step 1: Update the tests**

`tests/dashboard.test.ts`:

| Line | Change |
|---|---|
| `:30` | `startOfAppDay(NOW).toISOString()` expects `"2026-07-28T18:30:00.000Z"` |
| `:36-40` | Fixture `2026-07-29T23:59:59.000Z` → `18:29:59.999Z`; name "…late-evening UTC time" → "…late-evening IST time". The premise inverts: 23:59:59Z *is* the next app day |
| `:133-135` | `todayLabel(new Date("2026-07-29T23:30:00.000Z"))` returns `"Thursday, 30 July"`, not Wednesday. Fixture → `2026-07-29T18:29:59.999Z`, name → "…late-evening IST time" |

⚠️ `:133-135` sits **130 lines away** from `:36-40` and is the same bug with the same fix. It is the easiest one in this plan to miss.

`tests/announcement.test.ts`:

| `:19` | `isPinned(d("2026-08-02"), new Date("2026-08-02T23:59:59.000Z"))` expects `true` and would become `false`. Fixture → `2026-08-02T18:29:59.999Z` |

- [ ] **Step 2: Run and watch them fail**

```bash
npx vitest run tests/dashboard.test.ts tests/announcement.test.ts
```

- [ ] **Step 3: Implement**

`src/lib/dashboard.ts`:
- `todayLabel` (`:21-25`): two `timeZone: "UTC"` literals → `APP_TIMEZONE`, one `getUTCDate()` → `appDayOfMonth`. **Its three-lookup assembly and the reason for it at `:14-20` are untouched.**
- The re-export at `:11`: `export { addDays, startOfUtcDay }` → `startOfAppDay`. This carries the rename into `dashboard-queries.ts:5`, `:104` and `dashboard.ts:43`, `:76`.

`src/lib/announcement.ts`:
- `isPinned` (`:24-27`): **import swap only.** The whole-day pin argument at `:16-22` is a day-granularity argument, not a zone one, and survives.
- `pinLabel` (`:50-54`): `timeZone: "UTC"` → `APP_TIMEZONE`.

- [ ] **Step 4: Run**

```bash
npx vitest run tests/dashboard.test.ts tests/announcement.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dashboard.ts src/lib/announcement.ts tests/dashboard.test.ts tests/announcement.test.ts
git commit -m "feat: dashboard and announcement day boundaries move to the app timezone"
```

---

### Task 4: call sites, the completeness check, and full verification

**Files:** modify `src/components/calendar/calendar-grid.tsx`; no test changes

- [ ] **Step 1: Update `calendar-grid.tsx`**

Mechanical renames at `:8-16` (imports), `:75-77`, `:134`, `:207`, `:211`, `:220`, plus:
- `day.getUTCDate()` → `appDayOfMonth(day)` at `:94`
- `groupByAppDay(rows)` → `groupByAppDay(rows, (r) => r.dueDate)` at `:207`

⚠️ **`monthGrid`'s cell keys and `groupByAppDay`'s keys must move in lockstep.** If one is app-midnight and the other UTC-midnight, `byDay.get(day.getTime())` at `:75` silently returns nothing and every cell renders empty — with no error anywhere.

- [ ] **Step 2: The completeness check**

```bash
grep -rn "getUTC" src/
```

Before this plan the grep returns **nine lines: eight code sites and one comment.** The code sites are `dates.ts:38`, `calendar.ts:29`, `:33`, `:71`, `:116`, `:139`, `dashboard.ts:24`, `calendar-grid.tsx:94` — this plan converts all eight. The comment is `calendar.ts:24`, updated in Task 2 Step 3.

Afterwards, expect **only the four `shifted(...)` accessor bodies in `src/lib/dates.ts`**. Every other hit is a site this plan named.

**If anything else survives, stop and report it.** It is a place nobody reasoned about, and it should be treated as a bug rather than renamed on sight.

- [ ] **Step 3: Confirm `calendar-filters.tsx` needed no edit**

```bash
git diff --stat
```

`src/components/calendar/calendar-filters.tsx` must **not** appear. Its three call sites pass an anchor to `toDateInputValue`, which keeps its name — D4 changed only the body, so the file is fixed by that change without being touched. If it appears in the diff, something was renamed that should not have been.

- [ ] **Step 4: Full toolchain**

```bash
npx tsc --noEmit && npm run lint && npm run gates && npm test && npm run build
```

Expected: tsc clean, lint 0 errors 0 warnings, gates 9/9, all tests pass, build succeeds. **Stop the dev server and `rm -rf .next` before building** — a live server's Turbopack cache breaks the build if it is deleted underneath it.

- [ ] **Step 5: Commit**

```bash
git add src/components/calendar/calendar-grid.tsx
git commit -m "feat: calendar grid reads app-zone day fields and keys"
```

---

### Task 5: browser proof that no task moved

**Files:** none unless a defect is found.

This is the criterion the whole step exists to satisfy, and no test can show it: **every task sits on the day it sat on before.**

⚠️ **Use real Chrome via `mcp__plugin_chrome-devtools-mcp`, never the embedded Browser pane** — that pane reports `visibilityState: "hidden"`, so skeletons hang forever while scripted assertions pass against a blank screen. Assert `document.visibilityState === "visible"` alongside `location.pathname` before believing any measurement.

- [ ] **Step 1: Record the before state**

Before deploying anything, query the database directly for every task with a `dueDate` and record the day each one should appear on. Four tasks currently have due dates; the seed's Launch Toolkit tasks are the population.

- [ ] **Step 2: Check the calendar in all three views**

Month, week and day. Every task appears on the same date its `dueDate` names. Cross a month boundary in both directions.

- [ ] **Step 3: Exercise the two arithmetic fixes specifically**

- Page **back and forward from the 31st** of a month, and across a year boundary. These are the three cases `stepAnchor`'s month branch gets wrong if `:139` is treated as a rename.
- Navigate to the week of **Mon 26 Oct 2026** — the heading must read `26 Oct – 1 Nov 2026`, with October present. Then the week of **Mon 1 Jun 2026** — it must read `1 – 7 Jun 2026`, with the month elided.

- [ ] **Step 4: Check the dashboard and announcements**

`todayLabel` on the dashboard names today. A pinned announcement is still pinned through the whole of its final IST day.

- [ ] **Step 5: Report**

For each unmet criterion: what you did, what happened, what you expected. Do not fix defects in this task — report them, and they become their own task with their own commit.

---

## Self-Review

**Spec coverage.** §5's function table: `dates.ts` rows → Task 1; `calendar.ts` rows including both real edits → Task 2; `dashboard.ts` and `announcement.ts` rows → Task 3; call sites and the completeness check → Task 4. §5's test enumeration: `calendar.test.ts` → Task 2 Step 1, `dashboard.test.ts` and `announcement.test.ts` → Task 3 Step 1, the `dates.test.ts` no-op → Task 1 Step 5. D1–D4 → Global Constraints and Task 1. §14's step 1 boundary → this plan's scope; the new time helpers (`parseTimeInput`, `toTimeInputValue`, `appTimeLabel`, `appDateTime`) are **step 4** and deliberately absent here. §15's first four criteria → Task 5.

**Placeholders.** None. Every code step carries real code; every command is runnable.

**Type consistency.** `startOfAppDay(Date): Date` and the four accessors returning `number` are declared in Task 1 and consumed unchanged in Tasks 2–4. `groupByAppDay<T>(rows: T[], at: (row: T) => Date | null)` is declared in Task 2 and called with its accessor in Task 4.

**The one thing most likely to go wrong.** Task 2 and Task 4 must agree about key space. `monthGrid` produces cell keys and `groupByAppDay` produces bucket keys; if a rename lands in one and not the other, every cell renders empty and nothing errors. Task 4 Step 1 carries that warning, and Task 5 Step 2 is what would catch it.

## Execution Handoff

Subagent-driven, a fresh implementer per task with a review between each.
