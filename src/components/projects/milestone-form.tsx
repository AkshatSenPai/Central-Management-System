"use client";

import { useActionState, useState } from "react";
import { addMilestoneAction } from "@/server/actions/projects";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { FormError } from "@/components/ui/form-error";

type SaveState = { ok: true; data: unknown } | { ok: false; error: string };
type SaveAction = (prev: SaveState | null, formData: FormData) => Promise<SaveState>;

type Values = { title: string; dueDate: string };

const EMPTY: Values = { title: "", dueDate: "" };

export function MilestoneForm({
  projectId,
  clientId,
}: {
  projectId: string;
  clientId: string;
}) {
  const [open, setOpen] = useState(false);
  // Controlled on purpose: React 19 resets an uncontrolled form after the
  // action resolves, including on validation failure.
  const [values, setValues] = useState<Values>(EMPTY);
  // See ClientForm: React 19 resets the form after the action resolves, so a
  // rejected submit remounts the subtree to re-read `values`.
  const [attempt, setAttempt] = useState(0);
  const [state, formAction, pending] = useActionState<SaveState | null, FormData>(
    async (prev, formData) => {
      const result = await (addMilestoneAction as SaveAction)(prev, formData);
      // Milestones are added several at a time, so the form stays open on
      // success and only clears its fields, ready for the next one.
      if (result.ok) setValues(EMPTY);
      else setAttempt((a) => a + 1);
      return result;
    },
    null
  );

  function set<K extends keyof Values>(key: K, value: Values[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  function cancel() {
    setOpen(false);
    setValues(EMPTY);
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)}>Add milestone</Button>
    );
  }

  return (
    <form key={attempt} action={formAction} className="space-y-2">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="clientId" value={clientId} />
      {state && !state.ok ? <FormError message={state.error} /> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Field
          size="sm"
          name="title"
          required
          placeholder="Milestone title"
          value={values.title}
          onChange={(e) => set("title", e.target.value)}
        />
        <Field
          size="sm"
          type="date"
          name="dueDate"
          value={values.dueDate}
          onChange={(e) => set("dueDate", e.target.value)}
        />
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button onClick={cancel}>Cancel</Button>
      </div>
    </form>
  );
}
