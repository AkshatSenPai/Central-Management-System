"use client";

import { useActionState, useState } from "react";
import { addMilestoneAction } from "@/server/actions/projects";

type SaveState = { ok: true; data: unknown } | { ok: false; error: string };
type SaveAction = (prev: SaveState | null, formData: FormData) => Promise<SaveState>;

const FIELD =
  "rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--text)]";

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
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text-2)] hover:bg-[var(--surface-2)]"
      >
        Add milestone
      </button>
    );
  }

  return (
    <form key={attempt} action={formAction} className="space-y-2">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="clientId" value={clientId} />
      {state && !state.ok ? <p className="text-sm text-[var(--bad)]">{state.error}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <input
          name="title"
          required
          placeholder="Milestone title"
          value={values.title}
          onChange={(e) => set("title", e.target.value)}
          className={FIELD}
        />
        <input
          type="date"
          name="dueDate"
          value={values.dueDate}
          onChange={(e) => set("dueDate", e.target.value)}
          className={FIELD}
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-[var(--btn)] px-3 py-1.5 text-sm text-[var(--on-btn)] hover:bg-[var(--btn-h)] disabled:opacity-50"
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
