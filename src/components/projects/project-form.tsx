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

type Values = {
  clientId: string;
  name: string;
  description: string;
  status: ProjectStatus;
  health: ProjectHealth;
  startDate: string;
  dueDate: string;
};

function initialValues(project?: ProjectDefaults, presetClientId?: string): Values {
  return {
    clientId: project?.clientId ?? presetClientId ?? "",
    name: project?.name ?? "",
    description: project?.description ?? "",
    status: project?.status ?? "PLANNING",
    health: project?.health ?? "ON_TRACK",
    startDate: toDateInputValue(project?.startDate ?? null),
    dueDate: toDateInputValue(project?.dueDate ?? null),
  };
}

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
  // Controlled on purpose: React 19 resets an uncontrolled form after the
  // action resolves, including when it failed validation, which would wipe
  // everything the user typed and leave them an error about a field they can
  // no longer see. Values held in state survive that reset.
  const [values, setValues] = useState<Values>(() => initialValues(project, presetClientId));
  // React 19 resets the form once the action resolves. Text inputs get their
  // controlled value restored, but a <select> does not — React's state did not
  // change, so nothing re-commits its DOM value. Remounting the form subtree
  // on a rejected submit makes every field re-read from `values` above.
  const [attempt, setAttempt] = useState(0);
  const save = (project ? updateProjectAction : createProjectAction) as SaveAction;
  const [state, formAction, pending] = useActionState<SaveState | null, FormData>(
    async (prev, formData) => {
      const result = await save(prev, formData);
      if (result.ok) {
        setOpen(false);
        // A create form starts empty again; an edit form keeps what was saved.
        if (!project) setValues(initialValues(undefined, presetClientId));
      } else {
        setAttempt((a) => a + 1);
      }
      return result;
    },
    null
  );

  const fixedClientId = project?.clientId ?? presetClientId;

  function set<K extends keyof Values>(key: K, value: Values[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  function cancel() {
    setOpen(false);
    setValues(initialValues(project, presetClientId));
  }

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
      key={attempt}
      action={formAction}
      className="w-full max-w-xl space-y-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"
    >
      {project ? <input type="hidden" name="projectId" value={project.id} /> : null}
      {fixedClientId ? <input type="hidden" name="clientId" value={fixedClientId} /> : null}
      {state && !state.ok ? <p className="text-sm text-[var(--bad)]">{state.error}</p> : null}

      {!fixedClientId && clients ? (
        <label className={LABEL}>
          Client
          <select
            name="clientId"
            required
            value={values.clientId}
            onChange={(e) => set("clientId", e.target.value)}
            className={FIELD}
          >
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
        <input
          name="name"
          required
          value={values.name}
          onChange={(e) => set("name", e.target.value)}
          className={FIELD}
        />
      </label>

      <label className={LABEL}>
        Description
        <textarea
          name="description"
          rows={3}
          value={values.description}
          onChange={(e) => set("description", e.target.value)}
          className={FIELD}
        />
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className={LABEL}>
          Status
          <select
            name="status"
            value={values.status}
            onChange={(e) => set("status", e.target.value as ProjectStatus)}
            className={FIELD}
          >
            {PROJECT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {PROJECT_STATUS_LABEL[status]}
              </option>
            ))}
          </select>
        </label>
        <label className={LABEL}>
          Health
          <select
            name="health"
            value={values.health}
            onChange={(e) => set("health", e.target.value as ProjectHealth)}
            className={FIELD}
          >
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
            value={values.startDate}
            onChange={(e) => set("startDate", e.target.value)}
            className={FIELD}
          />
        </label>
        <label className={LABEL}>
          Due date
          <input
            type="date"
            name="dueDate"
            value={values.dueDate}
            onChange={(e) => set("dueDate", e.target.value)}
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
          onClick={cancel}
          className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text-2)] hover:bg-[var(--surface-2)]"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
