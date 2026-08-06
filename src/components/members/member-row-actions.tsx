"use client";

import { useState } from "react";
import {
  toggleMemberActiveAction,
  setMemberRoleAction,
  resetMemberPasswordAction,
} from "@/server/actions/members";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/form-error";

export function MemberRowActions({
  userId,
  role,
  active,
  isSelf,
}: {
  userId: string;
  role: "ADMIN" | "MEMBER";
  active: boolean;
  isSelf: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null);

  async function run(action: (fd: FormData) => Promise<{ ok: boolean; error?: string }>, fd: FormData) {
    setError(null);
    try {
      const result = await action(fd);
      if (!result.ok && result.error) setError(result.error);
    } catch {
      setError("Something went wrong — try again");
    }
  }

  /** Its own handler rather than `run`, because `run` discards the result and
   * this is the one action whose result is the whole point. The temporary
   * password is returned once and stored nowhere — not logged, not
   * recoverable from the database, which keeps only its hash — so dropping
   * it here would mean resetting again. */
  async function resetPassword(fd: FormData) {
    setError(null);
    setTemporaryPassword(null);
    try {
      const result = await resetMemberPasswordAction(fd);
      if (result.ok) setTemporaryPassword(result.data.temporaryPassword);
      else setError(result.error);
    } catch {
      setError("Something went wrong — try again");
    }
  }

  return (
    <div className="flex items-center gap-2">
      <form
        action={(fd) => run(setMemberRoleAction, fd)}
      >
        <input type="hidden" name="userId" value={userId} />
        <input type="hidden" name="role" value={role === "ADMIN" ? "MEMBER" : "ADMIN"} />
        <Button type="submit" size="xs">
          {role === "ADMIN" ? "Make Member" : "Make Admin"}
        </Button>
      </form>
      {!isSelf && (
        <form action={(fd) => run(toggleMemberActiveAction, fd)}>
          <input type="hidden" name="userId" value={userId} />
          <input type="hidden" name="active" value={active ? "false" : "true"} />
          <Button type="submit" size="xs">
            {active ? "Deactivate" : "Reactivate"}
          </Button>
        </form>
      )}
      {/* Inside the same `!isSelf` guard the Deactivate button uses.
          `resetMemberPassword` refuses a self-reset regardless — this only
          avoids offering a button whose single outcome would be an error. */}
      {!isSelf && (
        <form action={resetPassword}>
          <input type="hidden" name="userId" value={userId} />
          <Button type="submit" size="xs">
            Reset password
          </Button>
        </form>
      )}
      {temporaryPassword ? (
        <span className="flex items-center gap-2 text-xs text-[var(--text-2)]">
          <code className="rounded border border-[var(--border)] bg-[var(--surface-2)] px-1.5 py-0.5 font-[family-name:var(--mono)]">
            {temporaryPassword}
          </code>
          {/* Says so out loud, because an admin who assumes they can find it
              again will navigate away and have to reset a second time. */}
          <span className="text-[var(--text-3)]">shown once — copy it now</span>
          <Button size="xs" onClick={() => setTemporaryPassword(null)}>
            Done
          </Button>
        </span>
      ) : null}
      {error && <FormError message={error} size="xs" />}
    </div>
  );
}
