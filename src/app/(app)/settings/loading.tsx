import { Skeleton } from "@/components/ui/skeleton";

/** Mirrors the three-section settings page, so the skeleton settles into the
 * real layout rather than being swapped for a different one. */
function SectionSkeleton({ rows }: { rows: number }) {
  return (
    <div className="overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow)]">
      <div className="border-b border-[var(--border)] px-4 py-3">
        <Skeleton className="h-4 w-24" />
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3 last:border-b-0"
        >
          <Skeleton className="h-7 w-7 flex-none rounded-lg" />
          <Skeleton className="h-4 flex-1" />
        </div>
      ))}
    </div>
  );
}

export default function Loading() {
  return (
    <div className="mx-auto max-w-[720px] space-y-5 px-4 pb-10 pt-5 sm:px-6">
      <Skeleton className="h-8 w-32" />
      <SectionSkeleton rows={1} />
      <SectionSkeleton rows={1} />
      <SectionSkeleton rows={2} />
    </div>
  );
}
