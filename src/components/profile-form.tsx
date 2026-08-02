"use client";

import { useActionState } from "react";
import { updateProfileAction } from "@/server/actions/profile";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { FormError } from "@/components/ui/form-error";

export function ProfileForm({
  defaults,
}: {
  defaults: { name: string; title: string; phone: string; avatarUrl: string };
}) {
  const [state, formAction, pending] = useActionState(updateProfileAction, null);

  return (
    <form action={formAction} className="max-w-md space-y-4">
      {state && !state.ok && <FormError message={state.error} />}
      {state?.ok && <p className="text-sm text-[var(--ok)]">Profile saved.</p>}
      <Field label="Name" className="w-full" name="name" required defaultValue={defaults.name} />
      <Field label="Job title" className="w-full" name="title" defaultValue={defaults.title} />
      <Field label="Phone" className="w-full" name="phone" defaultValue={defaults.phone} />
      <Field
        label="Avatar URL"
        className="w-full"
        name="avatarUrl"
        defaultValue={defaults.avatarUrl}
      />
      <Button type="submit" variant="primary" size="md" disabled={pending}>
        {pending ? "Saving…" : "Save profile"}
      </Button>
    </form>
  );
}
