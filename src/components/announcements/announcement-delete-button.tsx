"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/form-error";
import { Icon } from "@/components/ui/icon";
import { removeAnnouncementAction } from "@/server/actions/announcements";

/** A client component rather than a bare form on the page, for the same
 * reason <ClientDeleteButton> is one: the action returns an ActionResult, and
 * a form action must resolve to void. Wrapping it here means a refusal — "you
 * can only delete your own announcements" — is shown rather than swallowed. */
export function AnnouncementDeleteButton({ announcementId }: { announcementId: string }) {
  const [error, setError] = useState<string | null>(null);

  async function remove(formData: FormData) {
    setError(null);
    const result = await removeAnnouncementAction(formData);
    if (!result.ok) setError(result.error);
  }

  return (
    <form action={remove} className="flex items-center gap-2">
      <input type="hidden" name="announcementId" value={announcementId} />
      {error ? <FormError message={error} size="xs" /> : null}
      <Button type="submit" size="xs" className="gap-1.5">
        <Icon name="delete" size="sm" />
        Delete
      </Button>
    </form>
  );
}
