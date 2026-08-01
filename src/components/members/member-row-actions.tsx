"use client";

import { useState } from "react";
import {
  toggleMemberActiveAction,
  setMemberRoleAction,
} from "@/server/actions/members";
import { Button } from "@/components/ui/button";

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
    try {
      const result = await action(fd);
      if (!result.ok && result.error) setError(result.error);
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
      {error && <span className="text-xs text-[var(--bad)]">{error}</span>}
    </div>
  );
}
