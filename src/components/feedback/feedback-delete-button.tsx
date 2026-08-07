"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/form-error";
import { Icon } from "@/components/ui/icon";
import { removeFeedbackAction } from "@/server/actions/feedback";

/** A client component rather than a bare form, for the same reason
 * <AnnouncementDeleteButton> is one: the action returns an ActionResult and a
 * form action must resolve to void, so wrapping it here means a refusal is
 * shown rather than swallowed. */
export function FeedbackDeleteButton({ feedbackId }: { feedbackId: string }) {
  const [error, setError] = useState<string | null>(null);

  async function remove(formData: FormData) {
    setError(null);
    const result = await removeFeedbackAction(formData);
    if (!result.ok) setError(result.error);
  }

  return (
    <form action={remove} className="flex items-center gap-2">
      <input type="hidden" name="feedbackId" value={feedbackId} />
      {error ? <FormError message={error} size="xs" /> : null}
      <Button type="submit" size="xs" className="gap-1.5">
        <Icon name="delete" size="sm" />
        Delete
      </Button>
    </form>
  );
}
