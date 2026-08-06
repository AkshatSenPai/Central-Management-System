"use client";

import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { CALENDAR_VIEWS, type CalendarView } from "@/lib/calendar";
import { TASK_STATUSES, TASK_STATUS_LABEL, type TaskStatusFilter } from "@/lib/task";
import { toDateInputValue } from "@/lib/dates";

const VIEW_LABEL: Record<CalendarView, string> = {
  month: "Month",
  week: "Week",
  day: "Day",
};

/** ONE form, deliberately.
 *
 * A GET submit replaces the entire query string, so any parameter that is not
 * a field inside the submitting form is silently dropped. Two forms here would
 * mean picking a person threw away the month you had paged to — the exact trap
 * <ProjectFilters> documents. The view and the anchor date are therefore
 * carried as hidden inputs even though this form does not visibly edit them;
 * the prev/next/today buttons are separate submits that override the anchor,
 * and the three view buttons override the view.
 *
 * **Both carried parameters are therefore sent twice, and that is the design,
 * not a defect** — but it was a defect for as long as the server read the
 * wrong one. A hidden input written above the buttons is serialised before
 * them (the HTML form data set is built in tree order, with the submitter's
 * pair inserted where the submitter sits), so the *last* value is always the
 * button that was pressed and the first is the default being carried.
 * `parseCalendarView` and the page's `date` handling both resolve with
 * `lastParam` for that reason. Reading `[0]` is what made the Month/Week/Day
 * switcher inert on every click.
 *
 * The hidden `date` input is the other half of the same rule, and it was
 * missing until 2026-08-06 — so this component's own promise above ("picking
 * a person threw away the month you had paged to") was broken in exactly the
 * way it warns about: a select auto-submit carried no `date` at all, and the
 * page fell back to today. Paging to November and then filtering by a person
 * silently jumped back to August.
 *
 * Every select auto-submits on change, matching the app's other filters, with
 * a <noscript> submit button as the fallback. */
export function CalendarFilters({
  view,
  anchor,
  prevAnchor,
  nextAnchor,
  today,
  userId,
  projectId,
  status,
  members,
  projects,
}: {
  view: CalendarView;
  /** Where the calendar currently sits. Carried, not edited — the prev/next/
   * today buttons override it. */
  anchor: Date;
  prevAnchor: Date;
  nextAnchor: Date;
  today: Date;
  userId: string | null;
  projectId: string | null;
  status: TaskStatusFilter | null;
  members: { id: string; name: string }[];
  projects: { id: string; name: string }[];
}) {
  return (
    <form method="get" className="flex flex-wrap items-center gap-2">
      {/* Carried, not edited, so changing a filter keeps where you are. Both
          must stay ABOVE the submit buttons that override them — the last
          value of a repeated parameter is the one the server takes, and these
          are the defaults, not the overrides. */}
      <input type="hidden" name="view" value={view} />
      <input type="hidden" name="date" value={toDateInputValue(anchor)} />

      <span className="flex items-center gap-0.5">
        <Button
          type="submit"
          name="date"
          value={toDateInputValue(prevAnchor)}
          aria-label="Previous"
          size="none"
          className="h-8 w-8 rounded-lg border border-[var(--border)] text-[var(--text-2)] hover:bg-[var(--surface-2)]"
        >
          <Icon name="chevron_left" size="sm" />
        </Button>
        <Button
          type="submit"
          name="date"
          value={toDateInputValue(nextAnchor)}
          aria-label="Next"
          size="none"
          className="h-8 w-8 rounded-lg border border-[var(--border)] text-[var(--text-2)] hover:bg-[var(--surface-2)]"
        >
          <Icon name="chevron_right" size="sm" />
        </Button>
      </span>

      <Button type="submit" name="date" value={toDateInputValue(today)} size="sm">
        Today
      </Button>

      {/* A submit button per view: the value rides on the button, so no
          JavaScript is needed to switch and each is independently focusable. */}
      <span className="flex gap-0.5 rounded-[9px] bg-[var(--surface-3)] p-0.5">
        {CALENDAR_VIEWS.map((v) => (
          <Button
            key={v}
            type="submit"
            name="view"
            value={v}
            aria-pressed={v === view}
            size="none"
            className={`h-7 rounded-[7px] px-3 text-[12.5px] ${
              v === view
                ? "bg-[var(--surface)] font-semibold text-[var(--text)] shadow-[var(--shadow)]"
                : "text-[var(--text-2)] hover:text-[var(--text)]"
            }`}
          >
            {VIEW_LABEL[v]}
          </Button>
        ))}
      </span>

      <span className="flex-1" />

      <Icon name="filter_list" size="sm" className="text-[var(--text-3)]" />

      <SelectField
        size="sm"
        aria-label="Filter by person"
        name="person"
        defaultValue={userId ?? ""}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
      >
        <option value="">Everyone</option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </SelectField>

      <SelectField
        size="sm"
        aria-label="Filter by project"
        name="project"
        defaultValue={projectId ?? ""}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
      >
        <option value="">All projects</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </SelectField>

      <SelectField
        size="sm"
        aria-label="Filter by status"
        name="status"
        defaultValue={status ?? ""}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
      >
        <option value="">Open work</option>
        <option value="ALL">All statuses</option>
        {TASK_STATUSES.map((s) => (
          <option key={s} value={s}>
            {TASK_STATUS_LABEL[s]}
          </option>
        ))}
      </SelectField>

      <noscript>
        <Button type="submit" size="sm">
          Apply
        </Button>
      </noscript>
    </form>
  );
}
