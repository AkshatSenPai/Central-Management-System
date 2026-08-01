import { Card } from "@/components/ui/card";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="space-y-6 p-8">
      <Skeleton className="h-4 w-56" />
      <Skeleton className="h-8 w-72" />
      <Card className="p-4">
        <SkeletonText lines={6} />
      </Card>
    </div>
  );
}
