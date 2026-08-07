import type { ReactNode } from "react";

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    // flex-wrap so a long title and a wide action button can stack on a
    // phone instead of shoving each other off the edge. On desktop there is
    // always room, so this never fires there.
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold text-[var(--text)]">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-[var(--text-3)]">{subtitle}</p> : null}
      </div>
      {action ? <div className="flex-none">{action}</div> : null}
    </div>
  );
}
