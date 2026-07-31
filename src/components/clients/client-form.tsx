"use client";

import { useActionState, useState } from "react";
import { CLIENT_STATUSES, CLIENT_STATUS_LABEL, type ClientStatus } from "@/lib/client";
import { toDateInputValue } from "@/lib/dates";
import { createClientAction, updateClientAction } from "@/server/actions/clients";

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

const FIELD =
  "mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)]";
const LABEL = "block text-sm text-[var(--text-2)]";

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
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          client
            ? "rounded-md border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text-2)] hover:bg-[var(--surface-2)]"
            : "rounded-md bg-[var(--btn)] px-4 py-2 text-sm text-[var(--on-btn)] hover:bg-[var(--btn-h)]"
        }
      >
        {client ? "Edit" : "New client"}
      </button>
    );
  }

  return (
    <form
      key={attempt}
      action={formAction}
      className="w-full max-w-xl space-y-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"
    >
      {client ? <input type="hidden" name="clientId" value={client.id} /> : null}
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

      <div className="grid gap-4 sm:grid-cols-2">
        <label className={LABEL}>
          Status
          <select
            name="status"
            value={values.status}
            onChange={(e) => set("status", e.target.value as ClientStatus)}
            className={FIELD}
          >
            {CLIENT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {CLIENT_STATUS_LABEL[status]}
              </option>
            ))}
          </select>
        </label>
        <label className={LABEL}>
          Sector
          <input
            name="sector"
            value={values.sector}
            onChange={(e) => set("sector", e.target.value)}
            className={FIELD}
          />
        </label>
        <label className={LABEL}>
          Website
          <input
            name="website"
            placeholder="https://"
            value={values.website}
            onChange={(e) => set("website", e.target.value)}
            className={FIELD}
          />
        </label>
        <label className={LABEL}>
          Engagement type
          <input
            name="engagementType"
            value={values.engagementType}
            onChange={(e) => set("engagementType", e.target.value)}
            className={FIELD}
          />
        </label>
        <label className={LABEL}>
          Client since
          <input
            type="date"
            name="clientSince"
            value={values.clientSince}
            onChange={(e) => set("clientSince", e.target.value)}
            className={FIELD}
          />
        </label>
        <label className={LABEL}>
          Account lead
          <select
            name="accountLeadId"
            value={values.accountLeadId}
            onChange={(e) => set("accountLeadId", e.target.value)}
            className={FIELD}
          >
            <option value="">No account lead</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className={LABEL}>
        Notes
        <textarea
          name="notes"
          rows={3}
          value={values.notes}
          onChange={(e) => set("notes", e.target.value)}
          className={FIELD}
        />
      </label>

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-[var(--btn)] px-4 py-2 text-sm text-[var(--on-btn)] hover:bg-[var(--btn-h)] disabled:opacity-50"
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
