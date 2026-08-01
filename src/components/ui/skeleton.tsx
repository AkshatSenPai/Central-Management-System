/** Shape-only placeholder for the loading.tsx files. Pulses via opacity
 * rather than a sweeping gradient: a gradient needs a hardcoded colour stop,
 * and this codebase allows none outside globals.css. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`block animate-pulse rounded-md bg-[var(--surface-3)]${className ? ` ${className}` : ""}`}
    />
  );
}

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <span className={`block space-y-2${className ? ` ${className}` : ""}`}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={i === lines - 1 ? "h-3 w-2/3" : "h-3 w-full"} />
      ))}
    </span>
  );
}
