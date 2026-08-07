import { Card } from "@/components/ui/card";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="space-y-6 p-4 sm:p-8">
      <Skeleton className="h-7 w-40" />
      <Skeleton className="h-9 w-72" />
      <Card className="p-4">
        <SkeletonText lines={5} />
      </Card>
      <Card className="p-4">
        <SkeletonText lines={5} />
      </Card>
    </div>
  );
}
