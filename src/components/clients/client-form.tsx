"use client";

import { useActionState, useState } from "react";
import { CLIENT_STATUSES, CLIENT_STATUS_LABEL, type ClientStatus } from "@/lib/client";
import { toDateInputValue } from "@/lib/dates";
import { createClientAction, updateClientAction } from "@/server/actions/clients";
import { Button } from "@/components/ui/button";
import { cardClass } from "@/components/ui/card";
import { Field, SelectField, TextareaField } from "@/components/ui/field";
import { FormError } from "@/components/ui/form-error";

type ClientDefaults = {
  id: string;
  name: string;
  status: ClientStatus;
  sector: string | null;
  website: string | null;
  engagementType: string | null;
  clientSince: Date | null;
  accountLeadId: string | null;
  notes: string | null;
};

/** The two actions differ only in their success payload, and this form reads
 * nothing but ok/error from it. */
type SaveState = { ok: true; data: unknown } | { ok: false; error: string };
type SaveAction = (prev: SaveState | null, formData: FormData) => Promise<SaveState>;

type Values = {
  name: string;
  status: ClientStatus;
  sector: string;
  website: string;
  engagementType: string;
  clientSince: string;
  accountLeadId: string;
  notes: string;
};

function initialValues(client?: ClientDefaults): Values {
  return {
    name: client?.name ?? "",
    status: client?.status ?? "ACTIVE",
    sector: client?.sector ?? "",
    website: client?.website ?? "",
    engagementType: client?.engagementType ?? "",
    clientSince: toDateInputValue(client?.clientSince ?? null),
    accountLeadId: client?.accountLeadId ?? "",
    notes: client?.notes ?? "",
  };
}

export function ClientForm({
  client,
  members,
}: {
  client?: ClientDefaults;
  members: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  // Controlled on purpose: React 19 resets an uncontrolled form after the
  // action resolves, including on validation failure, which would wipe
  // everything the user typed.
  const [values, setValues] = useState<Values>(() => initialValues(client));
  // React 19 resets the form once the action resolves. Text inputs get their
  // controlled value restored, but a <select> does not — React's state did not
  // change, so nothing re-commits its DOM value. Remounting the form subtree
  // on a rejected submit makes every field re-read from `values` above.
  const [attempt, setAttempt] = useState(0);
  const save = (client ? updateClientAction : createClientAction) as SaveAction;
  const [state, formAction, pending] = useActionState<SaveState | null, FormData>(
    async (prev, formData) => {
      const result = await save(prev, formData);
      if (result.ok) {
        setOpen(false);
        // A create form starts empty again; an edit form keeps what was saved.
        if (!client) setValues(initialValues(undefined));
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
    setValues(initialValues(client));
  }

  if (!open) {
    return (
      <Button
        onClick={() => setOpen(true)}
        variant={client ? "secondary" : "primary"}
        size={client ? "sm" : "md"}
      >
        {client ? "Edit" : "New client"}
      </Button>
    );
  }

  return (
    <form
      key={attempt}
      action={formAction}
      className={cardClass({ className: "w-full max-w-xl space-y-4 p-4" })}
    >
      {client ? <input type="hidden" name="clientId" value={client.id} /> : null}
      {state && !state.ok ? <FormError message={state.error} /> : null}

      <Field
        label="Name"
        className="w-full"
        name="name"
        required
        value={values.name}
        onChange={(e) => set("name", e.target.value)}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label="Status"
          className="w-full"
          name="status"
          value={values.status}
          onChange={(e) => set("status", e.target.value as ClientStatus)}
        >
          {CLIENT_STATUSES.map((status) => (
            <option key={status} value={status}>
              {CLIENT_STATUS_LABEL[status]}
            </option>
          ))}
        </SelectField>
        <Field
          label="Sector"
          className="w-full"
          name="sector"
          value={values.sector}
          onChange={(e) => set("sector", e.target.value)}
        />
        <Field
          label="Website"
          className="w-full"
          name="website"
          placeholder="https://"
          value={values.website}
          onChange={(e) => set("website", e.target.value)}
        />
        <Field
          label="Engagement type"
          className="w-full"
          name="engagementType"
          value={values.engagementType}
          onChange={(e) => set("engagementType", e.target.value)}
        />
        <Field
          label="Client since"
          className="w-full"
          type="date"
          name="clientSince"
          value={values.clientSince}
          onChange={(e) => set("clientSince", e.target.value)}
        />
        <SelectField
          label="Account lead"
          className="w-full"
          name="accountLeadId"
          value={values.accountLeadId}
          onChange={(e) => set("accountLeadId", e.target.value)}
        >
          <option value="">No account lead</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </SelectField>
      </div>

      <TextareaField
        label="Notes"
        className="w-full"
        name="notes"
        rows={3}
        value={values.notes}
        onChange={(e) => set("notes", e.target.value)}
      />

      <div className="flex items-center gap-2">
        <Button type="submit" variant="primary" size="md" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button onClick={cancel}>Cancel</Button>
      </div>
    </form>
  );
}
