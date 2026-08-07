import { Skeleton } from "@/components/ui/skeleton";

/** Mirrors the two-column dashboard rather than the old three-card grid, so
 * the skeleton settles into the real layout instead of being swapped for a
 * different one. */
function SectionSkeleton({ rows }: { rows: number }) {
  return (
    <div className="overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow)]">
      <div className="border-b border-[var(--border)] px-3.5 py-3">
        <Skeleton className="h-4 w-32" />
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 border-b border-[var(--border)] px-3.5 py-3 last:border-b-0"
        >
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}

export default function Loading() {
  return (
    <div className="mx-auto max-w-[1240px] px-4 pb-10 pt-5 sm:px-6">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="mt-2 h-4 w-40" />
      <div className="mt-5 flex flex-wrap items-start gap-5">
        <div className="flex min-w-0 flex-1 basis-[480px] flex-col gap-5">
          <SectionSkeleton rows={3} />
          <SectionSkeleton rows={3} />
        </div>
        <div className="flex min-w-0 max-w-[340px] flex-1 basis-[296px] flex-col gap-5">
          <SectionSkeleton rows={4} />
          <SectionSkeleton rows={4} />
        </div>
      </div>
    </div>
  );
}
