"use client";

import { useState } from "react";
import { InitialsAvatar } from "@/components/ui/initials-avatar";
import { Badge } from "@/components/ui/badge";
import { clientInitials } from "@/lib/client";
import { setPrimaryContactAction, removeContactAction } from "@/server/actions/clients";

type Contact = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string | null;
  isPrimary: boolean;
};

export function ContactList({ clientId, contacts }: { clientId: string; contacts: Contact[] }) {
  const [error, setError] = useState<string | null>(null);

  async function run(
    action: (fd: FormData) => Promise<{ ok: boolean; error?: string }>,
    fd: FormData
  ) {
    setError(null);
    try {
      const result = await action(fd);
      if (!result.ok && result.error) setError(result.error);
    } catch {
      setError("Something went wrong — try again");
    }
  }

  const rowBtn =
    "rounded-md border border-[var(--border)] px-2 py-1 text-xs text-[var(--text-2)] hover:bg-[var(--surface-2)]";

  return (
    <div className="space-y-3">
      {contacts.map((contact) => (
        <div key={contact.id} className="flex items-start gap-2.5">
          <InitialsAvatar initials={clientInitials(contact.name)} shape="circle" size={28} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-medium text-[var(--text)]">{contact.name}</span>
              {contact.isPrimary ? <Badge kind="neutral">Primary</Badge> : null}
            </div>
            {contact.role ? (
              <p className="truncate text-xs text-[var(--text-3)]">{contact.role}</p>
            ) : null}
            {contact.email ? (
              <p className="truncate text-xs text-[var(--text-3)]">{contact.email}</p>
            ) : null}
            <div className="mt-1.5 flex items-center gap-1.5">
              {!contact.isPrimary ? (
                <form action={(fd) => run(setPrimaryContactAction, fd)}>
                  <input type="hidden" name="clientId" value={clientId} />
                  <input type="hidden" name="contactId" value={contact.id} />
                  <button type="submit" className={rowBtn}>
                    Make primary
                  </button>
                </form>
              ) : null}
              <form action={(fd) => run(removeContactAction, fd)}>
                <input type="hidden" name="clientId" value={clientId} />
                <input type="hidden" name="contactId" value={contact.id} />
                <button type="submit" className={rowBtn}>
                  Remove
                </button>
              </form>
            </div>
          </div>
        </div>
      ))}
      {error ? <p className="text-xs text-[var(--bad)]">{error}</p> : null}
    </div>
  );
}
