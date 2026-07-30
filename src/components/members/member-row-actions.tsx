"use client";

import { useState } from "react";
import {
  toggleMemberActiveAction,
  setMemberRoleAction,
} from "@/server/actions/members";

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

  async function run(action: (fd: FormData) => Promise<{ ok: boolean; error?: string }>, fd: FormData) {
    setError(null);
    const result = await action(fd);
    if (!result.ok && result.error) setError(result.error);
  }

  const btn = "rounded-md border border-[var(--border)] px-2 py-1 text-xs hover:bg-[var(--surface-2)]";

  return (
    <div className="flex items-center gap-2">
      <form
        action={(fd) => run(setMemberRoleAction, fd)}
      >
        <input type="hidden" name="userId" value={userId} />
        <input type="hidden" name="role" value={role === "ADMIN" ? "MEMBER" : "ADMIN"} />
        <button type="submit" className={btn}>
          {role === "ADMIN" ? "Make Member" : "Make Admin"}
        </button>
      </form>
      {!isSelf && (
        <form action={(fd) => run(toggleMemberActiveAction, fd)}>
          <input type="hidden" name="userId" value={userId} />
          <input type="hidden" name="active" value={active ? "false" : "true"} />
          <button type="submit" className={btn}>
            {active ? "Deactivate" : "Reactivate"}
          </button>
        </form>
      )}
      {error && <span className="text-xs text-[var(--bad)]">{error}</span>}
    </div>
  );
}
