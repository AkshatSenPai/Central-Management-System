import Link from "next/link";

/** A muted sentence plus at most one inline emphasis — no illustration, no
 * card, no button. */
export function EmptyState({
  message,
  actionLabel,
  actionHref,
}: {
  message: string;
  actionLabel?: string;
  actionHref?: string;
}) {
  return (
    <p className="text-sm text-[var(--text-3)]">
      {message}
      {actionLabel ? " " : null}
      {actionLabel && actionHref ? (
        <Link href={actionHref} className="font-semibold text-[var(--accent)]">
          {actionLabel}
        </Link>
      ) : actionLabel ? (
        <span className="font-semibold text-[var(--accent)]">{actionLabel}</span>
      ) : null}
    </p>
  );
}
