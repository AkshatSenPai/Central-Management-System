"use client";

import { useActionState, useState } from "react";
import { addContactAction } from "@/server/actions/clients";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";

type SaveState = { ok: true; data: unknown } | { ok: false; error: string };
type SaveAction = (prev: SaveState | null, formData: FormData) => Promise<SaveState>;

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
      <Button onClick={() => setOpen(true)}>Add contact</Button>
    );
  }

  return (
    <form key={attempt} action={formAction} className="space-y-3">
      <input type="hidden" name="clientId" value={clientId} />
      {state && !state.ok ? <p className="text-sm text-[var(--bad)]">{state.error}</p> : null}

      <Field
        label="Name"
        size="sm"
        className="w-full"
        name="name"
        required
        value={values.name}
        onChange={(e) => set("name", e.target.value)}
      />
      <Field
        label="Email"
        size="sm"
        className="w-full"
        name="email"
        type="email"
        value={values.email}
        onChange={(e) => set("email", e.target.value)}
      />
      <Field
        label="Phone"
        size="sm"
        className="w-full"
        name="phone"
        value={values.phone}
        onChange={(e) => set("phone", e.target.value)}
      />
      <Field
        label="Role"
        size="sm"
        className="w-full"
        name="role"
        value={values.role}
        onChange={(e) => set("role", e.target.value)}
      />

      <div className="flex items-center gap-2">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button onClick={cancel}>Cancel</Button>
      </div>
    </form>
  );
}
