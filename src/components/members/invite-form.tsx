"use client";

import { useActionState, useRef, useState } from "react";
import { createInviteAction } from "@/server/actions/invites";
import { Button } from "@/components/ui/button";
import { cardClass } from "@/components/ui/card";
import { Field, SelectField } from "@/components/ui/field";

export function InviteForm() {
  const [state, formAction, pending] = useActionState(createInviteAction, null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const copyResetTimer = useRef<number | undefined>(undefined);

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    window.clearTimeout(copyResetTimer.current);
    copyResetTimer.current = window.setTimeout(() => setCopyState("idle"), 2000);
  }

  return (
    <div className="max-w-md space-y-3">
      <form action={formAction} className="flex gap-2">
        <Field
          className="flex-1"
          name="email"
          type="email"
          required
          placeholder="teammate@company.com"
        />
        <SelectField name="role">
          <option value="MEMBER">Member</option>
          <option value="ADMIN">Admin</option>
        </SelectField>
        <Button type="submit" variant="primary" size="md" disabled={pending}>
          {pending ? "Inviting…" : "Invite"}
        </Button>
      </form>
      {state && !state.ok && <p className="text-sm text-[var(--bad)]">{state.error}</p>}
      {state?.ok && (
        <div className={cardClass({ className: "p-3 text-sm text-[var(--text)]" })}>
          <p className="mb-2">Invite created — share this link (valid 7 days):</p>
          <code className="block break-all text-xs text-[var(--text-2)]">
            {state.data.inviteUrl}
          </code>
          <Button size="xs" className="mt-2" onClick={() => copyLink(state.data.inviteUrl)}>
            {copyState === "copied" ? "Copied" : "Copy link"}
          </Button>
          {copyState === "failed" && (
            <p className="mt-2 text-xs text-[var(--bad)]">
              Couldn&apos;t copy — select the link above and copy it manually.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
