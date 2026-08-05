"use client";

import { useState } from "react";
import { removeCalendarEventAction } from "@/server/actions/calendar-events";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/form-error";
import { Icon } from "@/components/ui/icon";

/** Copies `task-remove-control.tsx`'s *shape* — own `"use client"`, a plain
 * `<form action={run}>`, fire-and-forget with its own try/catch rather than a
 * `useActionState` reducer — for the first half of that file's reasoning:
 * "deletion has no form state worth preserving on failure, so there's
 * nothing to remount" (`task-remove-control.tsx:10-14`).
 *
 * **Not the ending.** `task-remove-control.tsx:34` is `router.push("/my-tasks")`,
 * because a task lives on its own page and removing it leaves nothing behind
 * to render. That reasoning does not transfer: an event lives in a modal on
 * `/calendar`, and removing it leaves that page perfectly alive. So on
 * success this calls `onDone` — the same `cancel()` `<EventForm>` wires to
 * its own Cancel button, which closes the modal and resets its state — and
 * `revalidatePath("/calendar")` (declared in the action's revalidation map)
 * re-renders the grid underneath. Without `onDone` this control would have
 * no way to close the modal, because `open` is owned by `<EventForm>`'s own
 * `useState`, and the user would be left looking at an edit form for a row
 * that no longer exists. */
export function EventRemoveControl({
  eventId,
  onDone,
}: {
  eventId: string;
  onDone: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function run(formData: FormData) {
    setError(null);
    setPending(true);
    try {
      const result = await removeCalendarEventAction(formData);
      if (!result.ok) setError(result.error);
      else onDone();
    } catch {
      setError("Something went wrong — try again");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <form action={run}>
        <input type="hidden" name="eventId" value={eventId} />
        <Button type="submit" disabled={pending} className="gap-1.5">
          <Icon name="delete" size="sm" />
          Remove
        </Button>
      </form>
      {error ? <FormError message={error} size="xs" /> : null}
    </div>
  );
}
