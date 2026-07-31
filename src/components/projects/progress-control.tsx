"use client";

import { useActionState, useState } from "react";
import type { ProgressMode } from "@/lib/progress";
import { setProjectProgressAction } from "@/server/actions/projects";

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
        <select
          name="progressMode"
          value={mode}
          onChange={(e) => setMode(e.currentTarget.value as ProgressMode)}
          className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--text)]"
        >
          <option value="AUTO">Auto</option>
          <option value="MANUAL">Manual</option>
        </select>
        <input
          type="number"
          name="manualProgress"
          min={0}
          max={100}
          disabled={mode !== "MANUAL"}
          value={percent}
          onChange={(e) => setPercent(e.target.value)}
          className="w-20 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--text)] disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text-2)] hover:bg-[var(--surface-2)] disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
      {state && !state.ok ? <span className="text-xs text-[var(--bad)]">{state.error}</span> : null}
    </form>
  );
}
