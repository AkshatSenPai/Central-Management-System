import type { ReactNode } from "react";

/** `--shadow` and `--shadow-md` were defined in Phase 1 and consumed nowhere
 * — every card in the app has been a flat 1px border. This is where the
 * elevation the token set already describes finally gets used. */
const BASE = "rounded-lg border border-[var(--border)] bg-[var(--surface)]";

export function cardClass(opts: { raised?: boolean; className?: string } = {}): string {
  const { raised = false, className } = opts;
  const elevation = raised ? "shadow-[var(--shadow-md)]" : "shadow-[var(--shadow)]";
  return `${BASE} ${elevation}${className ? ` ${className}` : ""}`;
}

export function Card({
  raised,
  className,
  children,
}: {
  raised?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return <div className={cardClass({ raised, className })}>{children}</div>;
}
