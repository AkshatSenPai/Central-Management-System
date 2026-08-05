"use client";

import { useActionState, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox } from "@/components/ui/combobox";
import { Field, TextareaField } from "@/components/ui/field";
import { FormError } from "@/components/ui/form-error";
import { Icon } from "@/components/ui/icon";
import { Modal } from "@/components/ui/modal";
import { parseTimeInput, toDateInputValue, toTimeInputValue } from "@/lib/dates";
import { createCalendarEventAction, updateCalendarEventAction } from "@/server/actions/calendar-events";
import { AssigneePicker } from "@/components/tasks/assignee-picker";
import { EventRemoveControl } from "@/components/calendar/event-remove-control";

/** `<EventForm>` copies `<TaskForm>`'s contract clause by clause (spec
 * §8:329-352) — every comment below that says so is naming the clause it is
 * paying for, not decoration. */

type EventDefaults = {
  id: string;
  title: string;
  description: string | null;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  projectId: string | null;
  clientId: string | null;
};

type ProjectOption = { id: string; name: string; clientId: string };
type ClientOption = { id: string; name: string };
type MemberOption = { id: string; name: string; active: boolean };

type SaveState = { ok: true; data: unknown } | { ok: false; error: string };
type SaveAction = (prev: SaveState | null, formData: FormData) => Promise<SaveState>;

type Values = {
  title: string;
  description: string;
  date: string;
  allDay: boolean;
  startTime: string;
  endTime: string;
  projectId: string;
  /** Only read when no project is chosen — see `clientValue` below, which is
   * what actually reaches the Combobox. Kept in `Values` anyway so a client
   * typed in before a project is picked is not lost if the project is
   * cleared again. */
  clientId: string;
  attendeeIds: string[];
};

function initialValues(event: EventDefaults | undefined, selectedAttendeeIds: string[] | undefined): Values {
  return {
    title: event?.title ?? "",
    description: event?.description ?? "",
    date: toDateInputValue(event?.startsAt ?? null),
    allDay: event?.allDay ?? false,
    // Repopulated from the stored instant exactly as toDateInputValue repopulates
    // the date above. An all-day event's stored bounds are a storage artefact
    // (calendar-event.ts's eventTimeLabel comment), never a wall-clock time a
    // user set, so there is nothing meaningful to read into these two here —
    // the fields are hidden the moment allDay is true anyway (field 3 below).
    startTime: event && !event.allDay ? toTimeInputValue(event.startsAt) : "",
    endTime: event && !event.allDay ? toTimeInputValue(event.endsAt) : "",
    projectId: event?.projectId ?? "",
    clientId: event?.clientId ?? "",
    attendeeIds: selectedAttendeeIds ?? [],
  };
}

/** Keeps the Start-End gap when Start moves, defaulting to one hour the
 * first time either field has no prior valid pair to preserve a gap from.
 * Not part of calendar-event.ts's pure, tested layer (§12's export list has
 * no such function) — this is form interaction that nothing else in the app
 * reads or must agree with, unlike validateEventTimes, which the service
 * calls too and which is exactly why that one is tested and this one is
 * form-local. Minutes are clamped to a single day (0-1439): D5's rule that
 * an event cannot span more than a day, so a Start of 23:30 defaulting +60m
 * lands at 23:59 rather than rolling into a next day <input type="time">
 * cannot express. The user can then set End to anything the validator
 * accepts, exactly as spec §8:343 says. */
function shiftEndTime(prevStart: string, prevEnd: string, nextStart: string): string {
  const nextStartMin = parseTimeInput(nextStart);
  if (nextStartMin === null) return prevEnd;
  const prevStartMin = parseTimeInput(prevStart);
  const prevEndMin = parseTimeInput(prevEnd);
  const gap = prevStartMin !== null && prevEndMin !== null ? prevEndMin - prevStartMin : 60;
  const nextEndMin = Math.min(Math.max(nextStartMin + gap, 0), 23 * 60 + 59);
  const hh = String(Math.floor(nextEndMin / 60)).padStart(2, "0");
  const mm = String(nextEndMin % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function EventForm({
  event,
  projects,
  clients,
  members = [],
  selectedAttendeeIds,
  trigger,
}: {
  event?: EventDefaults;
  projects: ProjectOption[];
  clients: ClientOption[];
  /** Rendered by <AssigneePicker> in both create and edit mode (see the
   * Attendees field below) — unlike TaskForm, whose `members` is create-only. */
  members?: MemberOption[];
  /** The creator is pre-checked in create mode by passing `[actorId]` here;
   * an edit-mode caller passes the event's current attendee ids. Mirrors
   * TaskForm's `selectedAssigneeIds` contract exactly (task-form.tsx:88). */
  selectedAttendeeIds?: string[];
  /** One divergence from TaskForm (spec §8): rendered in place of the default
   * <Button> when supplied, because the day view opens this same form from an
   * event box (§7) rather than a labelled button. ReactNode, not a render
   * callback — the caller needs no state from the form, only to be clickable,
   * and <EventForm> wraps whatever arrives in the same click handler that
   * sets `open`. */
  trigger?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  // Controlled on purpose: React 19 resets an uncontrolled form after the
  // action resolves, including when it failed validation, which would wipe
  // everything the user typed and leave them an error about a field they can
  // no longer see. Values held in state survive that reset.
  const [values, setValues] = useState<Values>(() => initialValues(event, selectedAttendeeIds));
  // React 19 resets the form once the action resolves. Text inputs get their
  // controlled value restored, but a <select> (and a checkbox's `checked`)
  // does not — React's state did not change, so nothing re-commits its DOM
  // value. Remounting the form subtree on a rejected submit makes every field
  // re-read from `values` above. This form has both an All day checkbox and
  // an attendee checkbox list, which is exactly the case that requires it.
  const [attempt, setAttempt] = useState(0);
  const save = (event ? updateCalendarEventAction : createCalendarEventAction) as SaveAction;
  const [state, formAction, pending] = useActionState<SaveState | null, FormData>(
    async (prev, formData) => {
      const result = await save(prev, formData);
      if (result.ok) {
        setOpen(false);
        // A create form starts empty again; an edit form keeps what was saved.
        if (!event) setValues(initialValues(undefined, selectedAttendeeIds));
      } else {
        setAttempt((a) => a + 1);
      }
      return result;
    },
    null
  );

  const selectedProject = projects.find((p) => p.id === values.projectId);
  // Field 6: live and user-chosen with no project selected (the
  // prospect-with-no-project case, D5's sibling ruling in §4); forced to the
  // project's own client and disabled the moment a project is chosen, because
  // a project already pins its client and the two must not be allowed to
  // disagree.
  const clientValue = selectedProject ? selectedProject.clientId : values.clientId;

  function set<K extends keyof Values>(key: K, value: Values[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  function cancel() {
    setOpen(false);
    setValues(initialValues(event, selectedAttendeeIds));
  }

  // AssigneePicker's checkboxes are uncontrolled, so the only way to keep
  // `values.attendeeIds` current (and therefore correct after an attempt
  // remount) is to read the live checked set off the form itself whenever a
  // `userId` checkbox change bubbles up. Verbatim from task-form.tsx:141-147.
  function handleFormChange(e: React.FormEvent<HTMLFormElement>) {
    const target = e.target;
    if (target instanceof HTMLInputElement && target.name === "userId") {
      const ids = Array.from(new FormData(e.currentTarget).getAll("userId"), String);
      set("attendeeIds", ids);
    }
  }

  // Stable across the `attempt` remount, and unique per edit target, because
  // the footer's submit button reaches this form by id from outside it.
  const formId = event ? `event-form-${event.id}` : "event-form-new";

  return (
    <>
      {trigger ? (
        <Button type="button" variant="ghost" size="none" onClick={() => setOpen(true)}>
          {trigger}
        </Button>
      ) : (
        <Button onClick={() => setOpen(true)} variant="primary" size="md" className="gap-1.5">
          <Icon name="add" size="sm" />
          New event
        </Button>
      )}

      <Modal
        open={open}
        onClose={cancel}
        title={event ? "Edit event" : "New event"}
        icon="event"
        footer={
          <>
            {/* A sibling of the edit <form> below, not a descendant —
                modal.tsx:110/:113 render the body and the footer as separate
                <div>s, so a <form> placed here nests inside nothing. Edit
                mode only: there is no event to remove yet in create mode. */}
            {event ? <EventRemoveControl eventId={event.id} onDone={cancel} /> : null}
            <span className="flex-1" />
            <Button onClick={cancel}>Cancel</Button>
            {/* Outside the <form> it submits, which is what `form` is for.
                Keeping it here rather than in the body is what lets the fields
                scroll while the commit stays put. */}
            <Button type="submit" form={formId} variant="primary" disabled={pending}>
              {pending ? "Saving…" : event ? "Save changes" : "Create event"}
            </Button>
          </>
        }
      >
        <form
          id={formId}
          key={attempt}
          action={formAction}
          onChange={handleFormChange}
          className="space-y-4"
        >
          {event ? <input type="hidden" name="eventId" value={event.id} /> : null}
          {state && !state.ok ? <FormError message={state.error} /> : null}

          {/* 1. Title */}
          <Field
            label="Title"
            className="w-full"
            name="title"
            required
            value={values.title}
            onChange={(e) => set("title", e.target.value)}
          />

          {/* 2. Date */}
          <Field
            label="Date"
            className="w-full"
            type="date"
            name="date"
            value={values.date}
            onChange={(e) => set("date", e.target.value)}
          />

          {/* 3. All day. Checking it HIDES the two time fields below rather
              than disabling them, so nothing invisible is submitted — an
              unchecked, hidden startTime/endTime pair would still reach
              FormData if it stayed in the DOM merely disabled. */}
          <Checkbox
            label="All day"
            name="allDay"
            value="1"
            checked={values.allDay}
            onChange={(e) => set("allDay", e.target.checked)}
          />

          {/* 4. Start / End. Changing Start moves End to keep the gap
              (shiftEndTime above), defaulting to one hour on the first pick;
              the user can then set End to anything the validator accepts. */}
          {!values.allDay ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Start"
                className="w-full"
                type="time"
                name="startTime"
                value={values.startTime}
                onChange={(e) => {
                  const nextStart = e.target.value;
                  setValues((v) => ({
                    ...v,
                    startTime: nextStart,
                    endTime: shiftEndTime(v.startTime, v.endTime, nextStart),
                  }));
                }}
              />
              <Field
                label="End"
                className="w-full"
                type="time"
                name="endTime"
                value={values.endTime}
                onChange={(e) => set("endTime", e.target.value)}
              />
            </div>
          ) : null}

          {/* 5. Project */}
          <Combobox
            label="Project"
            name="projectId"
            className="w-full"
            value={values.projectId}
            onChange={(id) => set("projectId", id)}
            options={[
              { value: "", label: "No project" },
              ...projects.map((p) => ({ value: p.id, label: p.name })),
            ]}
          />

          {/* 6. Client. Disabled whenever a project is chosen — its visible
              input goes inert, but the Combobox's hidden input always
              renders (combobox.tsx:308), which is the documented reason this
              field does not drop out of FormData while disabled. Live and
              user-chosen only with no project selected. */}
          <Combobox
            label="Client"
            name="clientId"
            className="w-full"
            value={clientValue}
            onChange={(id) => set("clientId", id)}
            disabled={selectedProject !== undefined}
            options={[
              { value: "", label: "No client" },
              ...clients.map((c) => ({ value: c.id, label: c.name })),
            ]}
          />

          {/* 7. Attendees. Renders in edit mode too — the opposite of
              TaskForm, deliberately: updateCalendarEventAction reads userId
              and the service diffs the set, so unlike TaskForm's suppressed
              edit-mode picker (task-form.tsx:301-306), this control's changes
              are never dropped on save. The creator is pre-checked via
              `selectedAttendeeIds` in create mode and can be unchecked —
              nobody is forced to attend their own booking, and the central
              notify() filter drops the actor from recipients regardless. */}
          <div>
            <p className="block text-sm text-[var(--text-2)]">Attendees</p>
            <div className="mt-1">
              <AssigneePicker members={members} selectedIds={values.attendeeIds} />
            </div>
          </div>

          {/* 8. Description */}
          <TextareaField
            label="Description"
            className="w-full"
            name="description"
            rows={3}
            value={values.description}
            onChange={(e) => set("description", e.target.value)}
          />
        </form>
      </Modal>
    </>
  );
}
