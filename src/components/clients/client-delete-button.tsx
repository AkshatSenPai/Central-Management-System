"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { deleteClientAction } from "@/server/actions/clients";

/** Rendered only for admins. The service refuses while the client still has
 * projects; that refusal is surfaced inline rather than thrown away. */
export function ClientDeleteButton({ clientId }: { clientId: string }) {
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function run(formData: FormData) {
    setError(null);
    try {
      const result = await deleteClientAction(formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // The page we are standing on no longer exists.
      router.push("/clients");
    } catch {
      setError("Something went wrong — try again");
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <form action={run}>
        <input type="hidden" name="clientId" value={clientId} />
        <button
          type="submit"
          className="rounded-md border border-[var(--bad-line)] bg-[var(--bad-bg)] px-3 py-1.5 text-sm text-[var(--bad)] hover:bg-[var(--surface-2)]"
        >
          Delete client
        </button>
      </form>
      {error ? <span className="text-xs text-[var(--bad)]">{error}</span> : null}
    </div>
  );
}
