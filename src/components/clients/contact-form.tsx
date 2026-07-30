"use client";

import { useActionState, useState } from "react";
import { addContactAction } from "@/server/actions/clients";

type SaveState = { ok: true; data: unknown } | { ok: false; error: string };
type SaveAction = (prev: SaveState | null, formData: FormData) => Promise<SaveState>;

const FIELD =
  "mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--text)]";
const LABEL = "block text-xs text-[var(--text-2)]";

export function ContactForm({ clientId }: { clientId: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<SaveState | null, FormData>(
    addContactAction as SaveAction,
    null
  );

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text-2)] hover:bg-[var(--surface-2)]"
      >
        Add contact
      </button>
    );
  }

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="clientId" value={clientId} />
      {state && !state.ok ? <p className="text-sm text-[var(--bad)]">{state.error}</p> : null}

      <label className={LABEL}>
        Name
        <input name="name" required className={FIELD} />
      </label>
      <label className={LABEL}>
        Email
        <input name="email" type="email" className={FIELD} />
      </label>
      <label className={LABEL}>
        Phone
        <input name="phone" className={FIELD} />
      </label>
      <label className={LABEL}>
        Role
        <input name="role" className={FIELD} />
      </label>

      <div className="flex items-center gap-2">
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
