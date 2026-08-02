"use client";

import { useActionState, useState } from "react";
import type { ProgressMode } from "@/lib/progress";
import { setProjectProgressAction } from "@/server/actions/projects";
import { Button } from "@/components/ui/button";
import { Field, SelectField } from "@/components/ui/field";
import { FormError } from "@/components/ui/form-error";

/** Switching to Auto leaves the stored manual value untouched server-side, so
 * toggling back and forth is lossless. */
export function ProgressControl({
  projectId,
  clientId,
  progressMode,
  manualProgress,
}: {
  projectId: string;
  clientId: string;
  progressMode: ProgressMode;
  manualProgress: number | null;
}) {
  const [mode, setMode] = useState<ProgressMode>(progressMode);
  // Controlled for the same reason as the other forms: React 19 resets an
  // uncontrolled form once the action resolves, so a rejected value would
  // vanish before the user could correct it.
  const [percent, setPercent] = useState<string>(manualProgress?.toString() ?? "");
  // React 19 resets the form after the action resolves, and a <select> is not
  // re-synced from React state by that reset. Remount on a rejected submit.
  const [attempt, setAttempt] = useState(0);
  const [state, formAction, pending] = useActionState(
    async (prev: Awaited<ReturnType<typeof setProjectProgressAction>> | null, formData: FormData) => {
      const result = await setProjectProgressAction(prev, formData);
      if (!result.ok) setAttempt((a) => a + 1);
      return result;
    },
    null
  );

  return (
    <form key={attempt} action={formAction} className="flex flex-col gap-1">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="clientId" value={clientId} />
      <div className="flex items-center gap-2">
        <SelectField
          size="sm"
          name="progressMode"
          value={mode}
          onChange={(e) => setMode(e.currentTarget.value as ProgressMode)}
        >
          <option value="AUTO">Auto</option>
          <option value="MANUAL">Manual</option>
        </SelectField>
        <Field
          size="sm"
          className="w-20"
          type="number"
          name="manualProgress"
          min={0}
          max={100}
          disabled={mode !== "MANUAL"}
          value={percent}
          onChange={(e) => setPercent(e.target.value)}
        />
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
      {state && !state.ok ? <FormError message={state.error} size="xs" /> : null}
    </form>
  );
}
