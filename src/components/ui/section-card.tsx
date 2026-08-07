import type { ReactNode } from "react";
import { cardClass } from "@/components/ui/card";

/** A titled panel: a framed section with a header rule, one heading rhythm and
 * one body padding, everywhere in the app.
 *
 * This is a promotion, not an invention. The Settings page had exactly this
 * component defined privately inside its own file, while the task and client
 * detail pages rendered their sections as a bare `<h2>` over unwrapped
 * content — some of which then wrapped *itself* in `cardClass` and some of
 * which did not. That is what "no fixed structure, no proper box, things
 * floating between other things" describes: not a missing style, a style that
 * existed on one page out of four.
 *
 * Two heading scales were in use for the same job — `text-lg font-medium` in
 * the left column of the detail pages and `text-sm font-semibold` in their
 * right-hand asides, so a section's importance appeared to depend on which
 * column it landed in. This keeps the Settings scale, because Settings is the
 * page the design was drawn for and the one nobody complained about the look
 * of.
 *
 * `flush` exists for bodies that are lists of full-bleed rows — project rows,
 * member rows — which draw their own separators and must reach the card's
 * edge. Padding those would produce a gutter down both sides that no other
 * list in the app has. */
export function SectionCard({
  title,
  meta,
  action,
  flush = false,
  className,
  children,
}: {
  title: string;
  /** A count or short qualifier beside the title — "3 active", "12". */
  meta?: ReactNode;
  /** A control pinned to the right of the header, e.g. a "New project" button. */
  action?: ReactNode;
  flush?: boolean;
  className?: string;
  children: ReactNode;
}) {
  // Built as its own constant rather than interpolated inline. Tailwind v4
  // finds classes by scanning source text, and a literal class written flush
  // against a `${` is silently dropped from the build — no error, just a rule
  // that never existed. See AGENTS.md.
  const frame = className ? `overflow-hidden ${className}` : "overflow-hidden";
  // `overflow-x-auto` on the flush body: a full-bleed list that is genuinely
  // wider than a phone (the members table, the project-row grid) scrolls
  // sideways inside the card instead of being clipped by the frame's
  // overflow-hidden. Costs nothing when the content fits.
  const body = flush ? "overflow-x-auto" : "p-4";

  return (
    <section className={cardClass({ className: frame })}>
      <header className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="truncate text-[13.5px] font-bold tracking-[-0.01em] text-[var(--text)]">
            {title}
          </h2>
          {meta ? <span className="flex-none text-xs text-[var(--text-3)]">{meta}</span> : null}
        </div>
        {action ? <div className="flex flex-none items-center gap-2">{action}</div> : null}
      </header>
      <div className={body}>{children}</div>
    </section>
  );
}
