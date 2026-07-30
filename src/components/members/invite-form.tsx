"use client";

import { useActionState } from "react";
import { createInviteAction } from "@/server/actions/invites";

export function InviteForm() {
  const [state, formAction, pending] = useActionState(createInviteAction, null);

  return (
    <div className="max-w-md space-y-3">
      <form action={formAction} className="flex gap-2">
        <input
          name="email"
          type="email"
          required
          placeholder="teammate@company.com"
          className="flex-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-3)]"
        />
        <select
          name="role"
          className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-2 text-sm text-[var(--text)]"
        >
          <option value="MEMBER">Member</option>
          <option value="ADMIN">Admin</option>
        </select>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-[var(--btn)] px-4 py-2 text-sm text-[var(--on-btn)] hover:bg-[var(--btn-h)] disabled:opacity-50"
        >
          {pending ? "Inviting…" : "Invite"}
        </button>
      </form>
      {state && !state.ok && <p className="text-sm text-[var(--bad)]">{state.error}</p>}
      {state?.ok && (
        <div className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-3 text-sm text-[var(--text)]">
          <p className="mb-2">Invite created — share this link (valid 7 days):</p>
          <code className="block break-all text-xs text-[var(--text-2)]">
            {state.data.inviteUrl}
          </code>
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(state.data.inviteUrl)}
            className="mt-2 rounded-md border border-[var(--border)] px-2 py-1 text-xs text-[var(--text-2)] hover:bg-[var(--surface-2)]"
          >
            Copy link
          </button>
        </div>
      )}
    </div>
  );
}
