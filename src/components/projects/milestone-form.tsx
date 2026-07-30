"use client";

import { useActionState, useState } from "react";
import { addMilestoneAction } from "@/server/actions/projects";

type SaveState = { ok: true; data: unknown } | { ok: false; error: string };
type SaveAction = (prev: SaveState | null, formData: FormData) => Promise<SaveState>;

const FIELD =
  "rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--text)]";

export function MilestoneForm({
  projectId,
  clientId,
}: {
  projectId: string;
  clientId: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<SaveState | null, FormData>(
    addMilestoneAction as SaveAction,
    null
  );

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
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="clientId" value={clientId} />
      {state && !state.ok ? <p className="text-sm text-[var(--bad)]">{state.error}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <input name="title" required placeholder="Milestone title" className={FIELD} />
        <input type="date" name="dueDate" className={FIELD} />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-[var(--btn)] px-3 py-1.5 text-sm text-[var(--on-btn)] hover:bg-[var(--btn-h)] disabled:opacity-50"
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
