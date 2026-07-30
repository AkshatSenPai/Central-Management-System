"use client";

import { useActionState, useState } from "react";
import {
  PROJECT_STATUSES,
  PROJECT_STATUS_LABEL,
  PROJECT_HEALTHS,
  PROJECT_HEALTH_LABEL,
  type ProjectStatus,
  type ProjectHealth,
} from "@/lib/project";
import { toDateInputValue } from "@/lib/dates";
import { createProjectAction, updateProjectAction } from "@/server/actions/projects";

type ProjectDefaults = {
  id: string;
  clientId: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  health: ProjectHealth;
  startDate: Date | null;
  dueDate: Date | null;
};

type SaveState = { ok: true; data: unknown } | { ok: false; error: string };
type SaveAction = (prev: SaveState | null, formData: FormData) => Promise<SaveState>;

const FIELD =
  "mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)]";
const LABEL = "block text-sm text-[var(--text-2)]";

export function ProjectForm({
  project,
  clients,
  presetClientId,
}: {
  project?: ProjectDefaults;
  /** Only needed when the client is not already fixed by the surface. */
  clients?: { id: string; name: string }[];
  presetClientId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<SaveState | null, FormData>(
    (project ? updateProjectAction : createProjectAction) as SaveAction,
    null
  );

  const fixedClientId = project?.clientId ?? presetClientId;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          project
            ? "rounded-md border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text-2)] hover:bg-[var(--surface-2)]"
            : "rounded-md bg-[var(--btn)] px-4 py-2 text-sm text-[var(--on-btn)] hover:bg-[var(--btn-h)]"
        }
      >
        {project ? "Edit" : "New project"}
      </button>
    );
  }

  return (
    <form
      action={formAction}
      className="w-full max-w-xl space-y-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"
    >
      {project ? <input type="hidden" name="projectId" value={project.id} /> : null}
      {fixedClientId ? <input type="hidden" name="clientId" value={fixedClientId} /> : null}
      {state && !state.ok ? <p className="text-sm text-[var(--bad)]">{state.error}</p> : null}

      {!fixedClientId && clients ? (
        <label className={LABEL}>
          Client
          <select name="clientId" required defaultValue="" className={FIELD}>
            <option value="" disabled>
              Select a client
            </option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <label className={LABEL}>
        Name
        <input name="name" required defaultValue={project?.name ?? ""} className={FIELD} />
      </label>

      <label className={LABEL}>
        Description
        <textarea
          name="description"
          rows={3}
          defaultValue={project?.description ?? ""}
          className={FIELD}
        />
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className={LABEL}>
          Status
          <select name="status" defaultValue={project?.status ?? "PLANNING"} className={FIELD}>
            {PROJECT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {PROJECT_STATUS_LABEL[status]}
              </option>
            ))}
          </select>
        </label>
        <label className={LABEL}>
          Health
          <select name="health" defaultValue={project?.health ?? "ON_TRACK"} className={FIELD}>
            {PROJECT_HEALTHS.map((health) => (
              <option key={health} value={health}>
                {PROJECT_HEALTH_LABEL[health]}
              </option>
            ))}
          </select>
        </label>
        <label className={LABEL}>
          Start date
          <input
            type="date"
            name="startDate"
            defaultValue={toDateInputValue(project?.startDate ?? null)}
            className={FIELD}
          />
        </label>
        <label className={LABEL}>
          Due date
          <input
            type="date"
            name="dueDate"
            defaultValue={toDateInputValue(project?.dueDate ?? null)}
            className={FIELD}
          />
        </label>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-[var(--btn)] px-4 py-2 text-sm text-[var(--on-btn)] hover:bg-[var(--btn-h)] disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text-2)] hover:bg-[var(--surface-2)]"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
