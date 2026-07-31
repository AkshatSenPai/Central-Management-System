"use client";

import { useActionState, useState } from "react";
import { addContactAction } from "@/server/actions/clients";

type SaveState = { ok: true; data: unknown } | { ok: false; error: string };
type SaveAction = (prev: SaveState | null, formData: FormData) => Promise<SaveState>;

const FIELD =
  "mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--text)]";
const LABEL = "block text-xs text-[var(--text-2)]";

type Values = { name: string; email: string; phone: string; role: string };

const EMPTY: Values = { name: "", email: "", phone: "", role: "" };

export function ContactForm({ clientId }: { clientId: string }) {
  const [open, setOpen] = useState(false);
  // Controlled on purpose: React 19 resets an uncontrolled form after the
  // action resolves, including on validation failure.
  const [values, setValues] = useState<Values>(EMPTY);
  // See ClientForm: React 19 resets the form after the action resolves, so a
  // rejected submit remounts the subtree to re-read `values`.
  const [attempt, setAttempt] = useState(0);
  const [state, formAction, pending] = useActionState<SaveState | null, FormData>(
    async (prev, formData) => {
      const result = await (addContactAction as SaveAction)(prev, formData);
      if (result.ok) {
        setOpen(false);
        setValues(EMPTY);
      } else {
        setAttempt((a) => a + 1);
      }
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
        Add contact
      </button>
    );
  }

  return (
    <form key={attempt} action={formAction} className="space-y-3">
      <input type="hidden" name="clientId" value={clientId} />
      {state && !state.ok ? <p className="text-sm text-[var(--bad)]">{state.error}</p> : null}

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
        Email
        <input
          name="email"
          type="email"
          value={values.email}
          onChange={(e) => set("email", e.target.value)}
          className={FIELD}
        />
      </label>
      <label className={LABEL}>
        Phone
        <input
          name="phone"
          value={values.phone}
          onChange={(e) => set("phone", e.target.value)}
          className={FIELD}
        />
      </label>
      <label className={LABEL}>
        Role
        <input
          name="role"
          value={values.role}
          onChange={(e) => set("role", e.target.value)}
          className={FIELD}
        />
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
          onClick={cancel}
          className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text-2)] hover:bg-[var(--surface-2)]"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
