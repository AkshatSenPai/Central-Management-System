"use client";

import { useActionState, useState } from "react";
import {
  TASK_PRIORITIES,
  TASK_PRIORITY_LABEL,
  TASK_STATUSES,
  TASK_STATUS_LABEL,
  taskReference,
  type TaskPriority,
} from "@/lib/task";
import { Button } from "@/components/ui/button";
import { Field, SelectField, TextareaField } from "@/components/ui/field";
import { FormError } from "@/components/ui/form-error";
import { Icon } from "@/components/ui/icon";
import { Modal } from "@/components/ui/modal";
import { toDateInputValue } from "@/lib/dates";
import { createTaskAction, updateTaskAction } from "@/server/actions/tasks";
import { AssigneePicker } from "@/components/tasks/assignee-picker";

type TaskDefaults = {
  id: string;
  reference: number;
  title: string;
  description: string | null;
  projectId: string | null;
  milestoneId: string | null;
  priority: TaskPriority;
  dueDate: Date | null;
};

type ProjectOption = { id: string; name: string; clientId: string };
type MilestoneOptions = { projectId: string; options: Array<{ id: string; title: string }> };
type MemberOption = { id: string; name: string; active: boolean };

type SaveState = { ok: true; data: unknown } | { ok: false; error: string };
type SaveAction = (prev: SaveState | null, formData: FormData) => Promise<SaveState>;

type Values = {
  title: string;
  description: string;
  projectId: string;
  milestoneId: string;
  priority: TaskPriority;
  status: (typeof TASK_STATUSES)[number];
  dueDate: string;
  assigneeIds: string[];
};

function initialValues(
  task: TaskDefaults | undefined,
  presetProjectId: string | null | undefined,
  selectedAssigneeIds: string[] | undefined
): Values {
  return {
    title: task?.title ?? "",
    description: task?.description ?? "",
    projectId: task?.projectId ?? presetProjectId ?? "",
    milestoneId: task?.milestoneId ?? "",
    priority: task?.priority ?? "MEDIUM",
    status: "TO_DO",
    dueDate: toDateInputValue(task?.dueDate ?? null),
    assigneeIds: selectedAssigneeIds ?? [],
  };
}

export function TaskForm({
  task,
  projectId,
  clientId,
  projects,
  milestones,
  members = [],
  selectedAssigneeIds,
}: {
  task?: TaskDefaults;
  /** Fixed context: when provided (even as null), no project select is
   * rendered and the task is locked to this project (or, for null, to no
   * project at all). Omit entirely to let the form's own select choose. */
  projectId?: string | null;
  clientId?: string | null;
  projects: ProjectOption[];
  milestones: MilestoneOptions | null;
  /** Only read in create mode (see the Assignees block below) — an edit-mode
   * caller has no functional use for this, so it's optional there. */
  members?: MemberOption[];
  selectedAssigneeIds?: string[];
}) {
  const [open, setOpen] = useState(false);
  // Controlled on purpose: React 19 resets an uncontrolled form after the
  // action resolves, including when it failed validation, which would wipe
  // everything the user typed and leave them an error about a field they can
  // no longer see. Values held in state survive that reset.
  const [values, setValues] = useState<Values>(() =>
    initialValues(task, projectId, selectedAssigneeIds)
  );
  // React 19 resets the form once the action resolves. Text inputs get their
  // controlled value restored, but a <select> (and a checkbox's `checked`)
  // does not — React's state did not change, so nothing re-commits its DOM
  // value. Remounting the form subtree on a rejected submit makes every
  // field re-read from `values` above.
  const [attempt, setAttempt] = useState(0);
  const save = (task ? updateTaskAction : createTaskAction) as SaveAction;
  const [state, formAction, pending] = useActionState<SaveState | null, FormData>(
    async (prev, formData) => {
      const result = await save(prev, formData);
      if (result.ok) {
        setOpen(false);
        // A create form starts empty again; an edit form keeps what was saved.
        if (!task) setValues(initialValues(undefined, projectId, selectedAssigneeIds));
      } else {
        setAttempt((a) => a + 1);
      }
      return result;
    },
    null
  );

  const isProjectFixed = projectId !== undefined;
  const selectedProject = projects.find((p) => p.id === values.projectId);
  const derivedClientId = isProjectFixed ? (clientId ?? "") : (selectedProject?.clientId ?? "");

  const prevProjectId = task?.projectId ?? "";
  const prevProject = projects.find((p) => p.id === prevProjectId);
  const prevClientId = isProjectFixed ? (clientId ?? "") : (prevProject?.clientId ?? "");

  function set<K extends keyof Values>(key: K, value: Values[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  function cancel() {
    setOpen(false);
    setValues(initialValues(task, projectId, selectedAssigneeIds));
  }

  // AssigneePicker's checkboxes are uncontrolled, so the only way to keep
  // `values.assigneeIds` current (and therefore correct after an attempt
  // remount) is to read the live checked set off the form itself whenever a
  // `userId` checkbox change bubbles up.
  function handleFormChange(e: React.FormEvent<HTMLFormElement>) {
    const target = e.target;
    if (target instanceof HTMLInputElement && target.name === "userId") {
      const ids = Array.from(new FormData(e.currentTarget).getAll("userId"), String);
      set("assigneeIds", ids);
    }
  }

  // Stable across the `attempt` remount, and unique per edit target, because
  // the footer's submit button reaches this form by id from outside it.
  const formId = task ? `task-form-${task.id}` : "task-form-new";

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        variant={task ? "secondary" : "primary"}
        size={task ? "sm" : "md"}
        className="gap-1.5"
      >
        <Icon name={task ? "edit" : "add"} size="sm" />
        {task ? "Edit" : "New task"}
      </Button>

      <Modal
        open={open}
        onClose={cancel}
        title={task ? "Edit task" : "New task"}
        icon="check_circle"
        // Edit mode only: a task that does not exist yet has no reference,
        // and inventing one before the insert would be a promise the
        // sequence has not made.
        meta={task ? taskReference(task.reference) : undefined}
        footer={
          <>
            <span className="flex-1" />
            <Button onClick={cancel}>Cancel</Button>
            {/* Outside the <form> it submits, which is what `form` is for.
                Keeping it here rather than in the body is what lets the fields
                scroll while the commit stays put. */}
            <Button type="submit" form={formId} variant="primary" disabled={pending}>
              {pending ? "Saving…" : task ? "Save changes" : "Create task"}
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
          {task ? <input type="hidden" name="taskId" value={task.id} /> : null}
          <input type="hidden" name="clientId" value={derivedClientId} />
          {task ? (
            <>
              <input type="hidden" name="prevProjectId" value={prevProjectId} />
              <input type="hidden" name="prevClientId" value={prevClientId} />
            </>
          ) : null}
          {state && !state.ok ? <FormError message={state.error} /> : null}

          <Field
            label="Title"
            className="w-full"
            name="title"
            required
            value={values.title}
            onChange={(e) => set("title", e.target.value)}
          />

          <TextareaField
            label="Description"
            className="w-full"
            name="description"
            rows={3}
            value={values.description}
            onChange={(e) => set("description", e.target.value)}
          />

          {isProjectFixed ? (
            <input type="hidden" name="projectId" value={projectId ?? ""} />
          ) : (
            <SelectField
              label="Project"
              className="w-full"
              name="projectId"
              value={values.projectId}
              onChange={(e) => setValues((v) => ({ ...v, projectId: e.target.value, milestoneId: "" }))}
            >
                <option value="">No project (personal task)</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </SelectField>
          )}

          {/* Pairing milestone options with the project id they were loaded for
              keeps a project chosen in the select from quietly contradicting a
              milestone list this repo (no client-side data fetching) never
              re-fetched for it. Anything else — no milestones prop, or a project
              swapped away from the one they were loaded for — hides the select
              and forces milestoneId to submit empty. */}
          {milestones !== null && values.projectId === milestones.projectId ? (
            <SelectField
              label="Milestone"
              className="w-full"
              name="milestoneId"
              value={values.milestoneId}
              onChange={(e) => set("milestoneId", e.target.value)}
            >
                <option value="">No milestone</option>
                {milestones.options.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title}
                  </option>
                ))}
            </SelectField>
          ) : (
            <input type="hidden" name="milestoneId" value="" />
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              label="Priority"
              className="w-full"
              name="priority"
              value={values.priority}
              onChange={(e) => set("priority", e.target.value as TaskPriority)}
            >
                {TASK_PRIORITIES.map((priority) => (
                  <option key={priority} value={priority}>
                    {TASK_PRIORITY_LABEL[priority]}
                  </option>
                ))}
            </SelectField>

            {!task ? (
              <SelectField
                label="Status"
                className="w-full"
                name="status"
                value={values.status}
                onChange={(e) => set("status", e.target.value as Values["status"])}
              >
                  {TASK_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {TASK_STATUS_LABEL[status]}
                    </option>
                  ))}
              </SelectField>
            ) : null}

            <Field
              label="Due date"
              className="w-full"
              type="date"
              name="dueDate"
              value={values.dueDate}
              onChange={(e) => set("dueDate", e.target.value)}
            />
          </div>

          {/* Create-only: createTaskAction reads `userId` and seeds the new
              task's assignees, but updateTaskAction never does — the assignee
              set is owned solely by setTaskAssignees (task-service.ts), reached
              through its own dedicated form wherever a task can be edited.
              Rendering this picker in edit mode would be a second, identical-
              looking control whose changes silently do nothing on save. */}
          {!task ? (
            <div>
              <p className="block text-sm text-[var(--text-2)]">Assignees</p>
              <div className="mt-1">
                <AssigneePicker members={members} selectedIds={values.assigneeIds} />
              </div>
            </div>
          ) : null}

        </form>
      </Modal>
    </>
  );
}
