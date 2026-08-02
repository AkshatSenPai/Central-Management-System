"use client";

import { useState } from "react";
import { InitialsAvatar } from "@/components/ui/initials-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/form-error";
import { Icon } from "@/components/ui/icon";
import { ContactForm } from "@/components/clients/contact-form";
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
            {/* Both, always. The phone was loaded by getClientDetail and then
                simply never rendered — the studio reaches clients on either,
                so showing one and dropping the other made the panel look
                complete while hiding half the answer. Each is a live link:
                mailto and tel, so a click does the thing you came here for. */}
            {contact.email ? (
              <a
                href={`mailto:${contact.email}`}
                className="flex items-center gap-1.5 text-xs text-[var(--text-3)] hover:text-[var(--accent)]"
              >
                <Icon name="mail" size="sm" className="flex-none" />
                <span className="truncate">{contact.email}</span>
              </a>
            ) : null}
            {contact.phone ? (
              <a
                href={`tel:${contact.phone}`}
                className="flex items-center gap-1.5 text-xs text-[var(--text-3)] hover:text-[var(--accent)]"
              >
                <Icon name="call" size="sm" className="flex-none" />
                <span className="truncate">{contact.phone}</span>
              </a>
            ) : null}
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <ContactForm clientId={clientId} contact={contact} />
              {!contact.isPrimary ? (
                <form action={(fd) => run(setPrimaryContactAction, fd)}>
                  <input type="hidden" name="clientId" value={clientId} />
                  <input type="hidden" name="contactId" value={contact.id} />
                  <Button type="submit" size="xs">
                    Make primary
                  </Button>
                </form>
              ) : null}
              <form action={(fd) => run(removeContactAction, fd)}>
                <input type="hidden" name="clientId" value={clientId} />
                <input type="hidden" name="contactId" value={contact.id} />
                <Button type="submit" size="xs">
                  Remove
                </Button>
              </form>
            </div>
          </div>
        </div>
      ))}
      {error ? <FormError message={error} size="xs" /> : null}
    </div>
  );
}
