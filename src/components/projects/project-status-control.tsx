"use client";

import { useState } from "react";
import {
  PROJECT_LIFECYCLE_STATUSES,
  PROJECT_STATUS_LABEL,
  type ProjectStatus,
} from "@/lib/project";
import { setProjectStatusAction } from "@/server/actions/projects";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/field";
import { FormError } from "@/components/ui/form-error";

/** Two controls answering two different questions. The dropdown answers
 * "where is this project now" and offers the four lifecycle statuses; the
 * button answers "are we finished" and is the only route to `DONE`.
 *
 * They were split because the dropdown auto-submits on change. Finishing a
 * client engagement is the one status change that pulls a project out of the
 * default projects list, the task form's project picker and the calendar
 * filter — and it previously cost a single mis-click, reading no differently
 * from moving the project to On Hold.
 *
 * **Reopening sets `MAINTENANCE`, not `IN_PROGRESS`.** A finished project
 * that comes back almost always comes back for support: the client took
 * delivery, ran it themselves for a while, and has returned asking whether
 * the studio will keep it going. The button says "Reopen for maintenance"
 * rather than "Reopen project" because it lands in a specific status, and a
 * control that silently picks one is a small surprise every time. If the
 * return really is new build work, the dropdown is back immediately after
 * and one click changes it.
 *
 * Neither button confirms. Each undoes the other in one click, so a dialog
 * would be friction against a reversible action — the same call this
 * component has always made ("a project moved to Done must always be able to
 * come back").
 *
 * The status rides on a hidden input in both button forms rather than on the
 * button's own `value`, so neither button contributes a `name`/`value` pair
 * of its own and there is no way for a submitter to collide with the
 * `status` field. */
export function ProjectStatusControl({
  projectId,
  clientId,
  status,
}: {
  projectId: string;
  clientId: string;
  status: ProjectStatus;
}) {
  const [error, setError] = useState<string | null>(null);

  async function run(formData: FormData) {
    setError(null);
    try {
      const result = await setProjectStatusAction(formData);
      if (!result.ok) setError(result.error);
    } catch {
      setError("Something went wrong — try again");
    }
  }

  const scope = (
    <>
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="clientId" value={clientId} />
    </>
  );

  if (status === "DONE") {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-[var(--text-3)]">This project is done.</span>
          <form action={run}>
            {scope}
            <input type="hidden" name="status" value="MAINTENANCE" />
            <Button type="submit" size="xs">
              Reopen for maintenance
            </Button>
          </form>
        </div>
        {error ? <FormError message={error} size="xs" /> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <form action={run}>
          {scope}
          <SelectField
            size="sm"
            name="status"
            aria-label="Project status"
            defaultValue={status}
            onChange={(e) => e.currentTarget.form?.requestSubmit()}
          >
            {PROJECT_LIFECYCLE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {PROJECT_STATUS_LABEL[s]}
              </option>
            ))}
          </SelectField>
        </form>
        <form action={run}>
          {scope}
          <input type="hidden" name="status" value="DONE" />
          <Button type="submit" size="xs">
            Mark project as done
          </Button>
        </form>
      </div>
      {error ? <FormError message={error} size="xs" /> : null}
    </div>
  );
}
