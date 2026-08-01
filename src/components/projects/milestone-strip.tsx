"use client";

import { useState } from "react";
import { toggleMilestoneAction, removeMilestoneAction } from "@/server/actions/projects";
import type { MilestoneState } from "@/lib/milestones";
import { Button } from "@/components/ui/button";
import { cardClass } from "@/components/ui/card";

type StripMilestone = {
  id: string;
  title: string;
  state: MilestoneState;
  overdue: boolean;
  metaLabel: string;
  completedAt: Date | null;
};

const DOT_CLASS: Record<"ok" | "strong" | "mute", string> = {
  ok: "bg-[var(--ok)]",
  strong: "bg-[var(--text)]",
  mute: "bg-[var(--text-3)]",
};

export function MilestoneStrip({
  projectId,
  clientId,
  milestones,
}: {
  projectId: string;
  clientId: string;
  milestones: Array<StripMilestone & { dot: "ok" | "strong" | "mute" }>;
}) {
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
    <div className="space-y-2">
      <div className="flex gap-3 overflow-x-auto pb-1">
        {milestones.map((m) => (
          <div
            key={m.id}
            className={cardClass({ className: "flex w-56 flex-none flex-col gap-2 p-3" })}
          >
            <div className="flex items-start gap-2">
              <span className={`mt-1.5 h-1.5 w-1.5 flex-none rounded-full ${DOT_CLASS[m.dot]}`} />
              <p className="text-sm font-medium text-[var(--text)]">{m.title}</p>
            </div>
            <p className={`text-xs ${m.overdue ? "text-[var(--bad)]" : "text-[var(--text-3)]"}`}>
              {m.metaLabel}
            </p>
            <div className="mt-auto flex items-center gap-1.5">
              <form action={(fd) => run(toggleMilestoneAction, fd)}>
                <input type="hidden" name="projectId" value={projectId} />
                <input type="hidden" name="clientId" value={clientId} />
                <input type="hidden" name="milestoneId" value={m.id} />
                <input
                  type="hidden"
                  name="complete"
                  value={m.completedAt ? "false" : "true"}
                />
                <Button type="submit" size="xs">
                  {m.completedAt ? "Reopen" : "Complete"}
                </Button>
              </form>
              <form action={(fd) => run(removeMilestoneAction, fd)}>
                <input type="hidden" name="projectId" value={projectId} />
                <input type="hidden" name="clientId" value={clientId} />
                <input type="hidden" name="milestoneId" value={m.id} />
                <Button type="submit" size="xs">
                  Remove
                </Button>
              </form>
            </div>
          </div>
        ))}
      </div>
      {error ? <p className="text-xs text-[var(--bad)]">{error}</p> : null}
    </div>
  );
}
