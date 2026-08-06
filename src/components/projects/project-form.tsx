"use client";

import { useActionState, useState } from "react";
import {
  PROJECT_LIFECYCLE_STATUSES,
  PROJECT_STATUS_LABEL,
  PROJECT_HEALTHS,
  PROJECT_HEALTH_LABEL,
  type ProjectStatus,
  type ProjectHealth,
} from "@/lib/project";
import { toDateInputValue } from "@/lib/dates";
import { createProjectAction, updateProjectAction } from "@/server/actions/projects";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Field, SelectField, TextareaField } from "@/components/ui/field";
import { FormError } from "@/components/ui/form-error";
import { Icon } from "@/components/ui/icon";
import { Modal } from "@/components/ui/modal";

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
  // The status select offers the lifecycle statuses, and additionally the
  // project's own status when that is not among them — which means Done.
  // Done is deliberately not a choice (finishing is a button on the project's
  // own page), but it must still be *rendered* for a project that already has
  // it, or React selects the first option instead and the next save silently
  // reopens a finished project as Planning.
  const statusOptions = PROJECT_LIFECYCLE_STATUSES.includes(values.status)
    ? PROJECT_LIFECYCLE_STATUSES
    : [...PROJECT_LIFECYCLE_STATUSES, values.status];
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

  // Stable across the `attempt` remount, and unique per edit target, because
  // the footer's submit button reaches this form by id from outside it.
  const formId = project ? `project-form-${project.id}` : "project-form-new";

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        variant={project ? "secondary" : "primary"}
        size={project ? "sm" : "md"}
        className="gap-1.5"
      >
        <Icon name={project ? "edit" : "add"} size="sm" />
        {project ? "Edit" : "New project"}
      </Button>

      <Modal
        open={open}
        onClose={cancel}
        title={project ? "Edit project" : "New project"}
        icon="layers"
        width={720}
        footer={
          <>
            <span className="flex-1" />
            <Button onClick={cancel}>Cancel</Button>
            {/* Outside the <form> it submits, which is what `form` is for.
                Keeping it here rather than in the body is what lets the fields
                scroll while the commit stays put. */}
            <Button type="submit" form={formId} variant="primary" disabled={pending}>
              {pending ? "Saving…" : project ? "Save changes" : "Create project"}
            </Button>
          </>
        }
      >
        <form id={formId} key={attempt} action={formAction} className="space-y-4">
          {project ? <input type="hidden" name="projectId" value={project.id} /> : null}
          {fixedClientId ? <input type="hidden" name="clientId" value={fixedClientId} /> : null}
          {state && !state.ok ? <FormError message={state.error} /> : null}

          {!fixedClientId && clients ? (
            <Combobox
              label="Client"
              name="clientId"
              className="w-full"
              required
              placeholder="Select a client"
              value={values.clientId}
              onChange={(id) => set("clientId", id)}
              options={clients.map((c) => ({ value: c.id, label: c.name }))}
            />
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
              {/* See `statusOptions` above for why this is not simply
                  PROJECT_LIFECYCLE_STATUSES. `tasks/[taskId]/page.tsx:43-46`
                  documents the same React behaviour for its own picker. */}
              {statusOptions.map((status) => (
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

        </form>
      </Modal>
    </>
  );
}
