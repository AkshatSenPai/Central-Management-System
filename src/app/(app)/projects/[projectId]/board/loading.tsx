import { Card } from "@/components/ui/card";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="space-y-6 p-4 sm:p-8">
      <Skeleton className="h-4 w-56" />
      <Skeleton className="h-8 w-64" />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card className="p-3">
          <SkeletonText lines={3} />
        </Card>
        <Card className="p-3">
          <SkeletonText lines={3} />
        </Card>
        <Card className="p-3">
          <SkeletonText lines={3} />
        </Card>
        <Card className="p-3">
          <SkeletonText lines={3} />
        </Card>
      </div>
    </div>
  );
}
