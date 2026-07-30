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
    <div className="flex items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-[var(--text)]">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-[var(--text-3)]">{subtitle}</p> : null}
      </div>
      {action ? <div className="flex-none">{action}</div> : null}
    </div>
  );
}
