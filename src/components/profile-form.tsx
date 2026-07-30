"use client";

import { useActionState } from "react";
import { updateProfileAction } from "@/server/actions/profile";

export function ProfileForm({
  defaults,
}: {
  defaults: { name: string; title: string; phone: string; avatarUrl: string };
}) {
  const [state, formAction, pending] = useActionState(updateProfileAction, null);

  const field =
    "mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)]";

  return (
    <form action={formAction} className="max-w-md space-y-4">
      {state && !state.ok && <p className="text-sm text-[var(--bad)]">{state.error}</p>}
      {state?.ok && <p className="text-sm text-[var(--ok)]">Profile saved.</p>}
      <label className="block text-sm text-[var(--text-2)]">
        Name
        <input name="name" required defaultValue={defaults.name} className={field} />
      </label>
      <label className="block text-sm text-[var(--text-2)]">
        Job title
        <input name="title" defaultValue={defaults.title} className={field} />
      </label>
      <label className="block text-sm text-[var(--text-2)]">
        Phone
        <input name="phone" defaultValue={defaults.phone} className={field} />
      </label>
      <label className="block text-sm text-[var(--text-2)]">
        Avatar URL
        <input name="avatarUrl" defaultValue={defaults.avatarUrl} className={field} />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-[var(--btn)] px-4 py-2 text-sm text-[var(--on-btn)] hover:bg-[var(--btn-h)] disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save profile"}
      </button>
    </form>
  );
}
