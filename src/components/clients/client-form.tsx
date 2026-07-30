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

export function ClientForm({
  client,
  members,
}: {
  client?: ClientDefaults;
  members: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<SaveState | null, FormData>(
    (client ? updateClientAction : createClientAction) as SaveAction,
    null
  );

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
      action={formAction}
      className="w-full max-w-xl space-y-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"
    >
      {client ? <input type="hidden" name="clientId" value={client.id} /> : null}
      {state && !state.ok ? <p className="text-sm text-[var(--bad)]">{state.error}</p> : null}

      <label className={LABEL}>
        Name
        <input name="name" required defaultValue={client?.name ?? ""} className={FIELD} />
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className={LABEL}>
          Status
          <select name="status" defaultValue={client?.status ?? "ACTIVE"} className={FIELD}>
            {CLIENT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {CLIENT_STATUS_LABEL[status]}
              </option>
            ))}
          </select>
        </label>
        <label className={LABEL}>
          Sector
          <input name="sector" defaultValue={client?.sector ?? ""} className={FIELD} />
        </label>
        <label className={LABEL}>
          Website
          <input
            name="website"
            placeholder="https://"
            defaultValue={client?.website ?? ""}
            className={FIELD}
          />
        </label>
        <label className={LABEL}>
          Engagement type
          <input
            name="engagementType"
            defaultValue={client?.engagementType ?? ""}
            className={FIELD}
          />
        </label>
        <label className={LABEL}>
          Client since
          <input
            type="date"
            name="clientSince"
            defaultValue={toDateInputValue(client?.clientSince ?? null)}
            className={FIELD}
          />
        </label>
        <label className={LABEL}>
          Account lead
          <select name="accountLeadId" defaultValue={client?.accountLeadId ?? ""} className={FIELD}>
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
        <textarea name="notes" rows={3} defaultValue={client?.notes ?? ""} className={FIELD} />
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
          onClick={() => setOpen(false)}
          className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text-2)] hover:bg-[var(--surface-2)]"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
