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
import { Button } from "@/components/ui/button";
import { cardClass } from "@/components/ui/card";
import { Field, SelectField, TextareaField } from "@/components/ui/field";

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
      <Button
        onClick={() => setOpen(true)}
        variant={project ? "secondary" : "primary"}
        size={project ? "sm" : "md"}
      >
        {project ? "Edit" : "New project"}
      </Button>
    );
  }

  return (
    <form
      key={attempt}
      action={formAction}
      className={cardClass({ className: "w-full max-w-xl space-y-4 p-4" })}
    >
      {project ? <input type="hidden" name="projectId" value={project.id} /> : null}
      {fixedClientId ? <input type="hidden" name="clientId" value={fixedClientId} /> : null}
      {state && !state.ok ? <p className="text-sm text-[var(--bad)]">{state.error}</p> : null}

      {!fixedClientId && clients ? (
        <SelectField
          label="Client"
          className="w-full"
          name="clientId"
          required
          value={values.clientId}
          onChange={(e) => set("clientId", e.target.value)}
        >
          <option value="" disabled>
            Select a client
          </option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </SelectField>
      ) : null}

      <Field
        label="Name"
        className="w-full"
        name="name"
        required
        value={values.name}
        onChange={(e) => set("name", e.target.value)}
      />

      <TextareaField
        label="Description"
        className="w-full"
        name="description"
        rows={3}
        value={values.description}
        onChange={(e) => set("description", e.target.value)}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label="Status"
          className="w-full"
          name="status"
          value={values.status}
          onChange={(e) => set("status", e.target.value as ProjectStatus)}
        >
          {PROJECT_STATUSES.map((status) => (
            <option key={status} value={status}>
              {PROJECT_STATUS_LABEL[status]}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Health"
          className="w-full"
          name="health"
          value={values.health}
          onChange={(e) => set("health", e.target.value as ProjectHealth)}
        >
          {PROJECT_HEALTHS.map((health) => (
            <option key={health} value={health}>
              {PROJECT_HEALTH_LABEL[health]}
            </option>
          ))}
        </SelectField>
        <Field
          label="Start date"
          className="w-full"
          type="date"
          name="startDate"
          value={values.startDate}
          onChange={(e) => set("startDate", e.target.value)}
        />
        <Field
          label="Due date"
          className="w-full"
          type="date"
          name="dueDate"
          value={values.dueDate}
          onChange={(e) => set("dueDate", e.target.value)}
        />
      </div>

      <div className="flex items-center gap-2">
        <Button type="submit" variant="primary" size="md" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button onClick={cancel}>Cancel</Button>
      </div>
    </form>
  );
}
