"use client";

import { useState } from "react";
import { FEEDBACK_STATUSES, FEEDBACK_STATUS_LABEL, type FeedbackStatus } from "@/lib/feedback";
import { setFeedbackStatusAction } from "@/server/actions/feedback";
import { SelectField } from "@/components/ui/field";
import { FormError } from "@/components/ui/form-error";

/** Triage, admin-only. Same fire-and-forget shape as <TaskStatusControl>,
 * including its `key={status}`: remounting when the server value changes is
 * what stops the rendered option and the stored row drifting apart after a
 * refused or raced submit.
 *
 * Rendering this at all is gated by the page, but `setFeedbackStatus` refuses
 * a non-admin on its own — hiding a control is not the same as withholding
 * the capability. */
export function FeedbackStatusControl({
  feedbackId,
  status,
}: {
  feedbackId: string;
  status: FeedbackStatus;
}) {
  const [error, setError] = useState<string | null>(null);

  async function run(formData: FormData) {
    setError(null);
    try {
      const result = await setFeedbackStatusAction(formData);
      if (!result.ok) setError(result.error);
    } catch {
      setError("Something went wrong — try again");
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <form action={run}>
        <input type="hidden" name="feedbackId" value={feedbackId} />
        <SelectField
          key={status}
          size="xs"
          name="status"
          defaultValue={status}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
        >
          {FEEDBACK_STATUSES.map((s) => (
            <option key={s} value={s}>
              {FEEDBACK_STATUS_LABEL[s]}
            </option>
          ))}
        </SelectField>
      </form>
      {error ? <FormError message={error} size="xs" /> : null}
    </div>
  );
}
