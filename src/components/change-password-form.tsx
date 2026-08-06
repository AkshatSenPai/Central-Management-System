"use client";

import { useActionState, useState } from "react";
import { changePasswordAction } from "@/server/actions/profile";
import { Button } from "@/components/ui/button";
import { PasswordField } from "@/components/ui/password-field";
import { FormError } from "@/components/ui/form-error";

/** Its own `<form>`, separate from `<ProfileForm>`, and that separation is
 * the point rather than an accident of file layout: the two submit
 * independently because they fail independently. A rejected password change
 * must not discard an unsaved name or phone edit sitting in the other form,
 * and a saved profile must not clear half-typed password fields.
 *
 * **No props.** `changePasswordAction` reads the user id from the session,
 * so there is deliberately nothing here identifying whose password this is —
 * this component cannot be pointed at another account even by a caller
 * trying to.
 *
 * On success the three fields are cleared by remounting through `key`, the
 * same trick `<CommentComposer>` uses. On failure they are kept: a typo in
 * the confirmation should not cost all three entries, which is the one thing
 * guaranteed to make someone give up and ask for a reset instead. */
export function ChangePasswordForm() {
  const [attempt, setAttempt] = useState(0);
  const [state, formAction, pending] = useActionState(
    async (prev: Awaited<ReturnType<typeof changePasswordAction>> | null, formData: FormData) => {
      const result = await changePasswordAction(prev, formData);
      if (result.ok) setAttempt((a) => a + 1);
      return result;
    },
    null
  );

  return (
    <form key={attempt} action={formAction} className="max-w-md space-y-4">
      {state && !state.ok ? <FormError message={state.error} /> : null}
      {state?.ok ? <p className="text-sm text-[var(--ok)]">Password changed.</p> : null}
      {/* autoComplete tells a password manager which field is which, so it
          offers to update the stored entry rather than saving a second one. */}
      <PasswordField
        label="Current password"
        className="w-full"
        name="currentPassword"
        required
        autoComplete="current-password"
      />
      <PasswordField
        label="New password"
        className="w-full"
        name="newPassword"
        required
        autoComplete="new-password"
      />
      <PasswordField
        label="Confirm new password"
        className="w-full"
        name="confirmPassword"
        required
        autoComplete="new-password"
      />
      <Button type="submit" variant="primary" size="md" disabled={pending}>
        {pending ? "Changing…" : "Change password"}
      </Button>
    </form>
  );
}
