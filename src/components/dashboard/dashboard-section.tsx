import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/ui/icon";

/** The design's dashboard panel: a titled header rule over a run of rows,
 * with the rows meeting the panel edge rather than sitting inside padding.
 * That is why this is not <Card> — Card is a padded box, and every row here
 * needs its own full-bleed hover and divider. */
export function DashboardSection({
  title,
  meta,
  linkHref,
  linkLabel,
  children,
}: {
  title: string;
  meta?: string;
  linkHref?: string;
  linkLabel?: string;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow)]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-3.5 py-3">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="text-[13.5px] font-bold tracking-[-0.01em] text-[var(--text)]">{title}</h2>
          {meta ? <span className="truncate text-[12.5px] text-[var(--text-3)]">{meta}</span> : null}
        </div>
        {linkHref && linkLabel ? (
          <Link
            href={linkHref}
            transitionTypes={["nav-forward"]}
            className="flex-none text-[12.5px] font-semibold text-[var(--accent)]"
          >
            {linkLabel}
          </Link>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/** The overdue callout. A whole section rather than a badge on each row,
 * because the design's claim is about the set — "these need attention before
 * anything else" — and a per-row marker cannot say that.
 *
 * Rendered only when the count is non-zero; the caller decides. An empty
 * "0 overdue" panel would give the loudest treatment on the screen to the
 * best possible news. */
export function OverdueSection({ count, children }: { count: number; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-[10px] border border-[var(--bad-line)] bg-[var(--surface)] shadow-[var(--shadow)]">
      <div className="flex items-center gap-2 border-b border-[var(--bad-line)] bg-[var(--bad-bg)] px-3.5 py-2.5">
        <Icon name="error" size="sm" className="text-[var(--bad)]" />
        <span className="flex-none text-[13px] font-bold text-[var(--bad)]">
          {count} overdue
        </span>
        <span className="truncate text-[12.5px] text-[var(--text-2)]">
          — these need attention before anything else
        </span>
      </div>
      {children}
    </section>
  );
}
