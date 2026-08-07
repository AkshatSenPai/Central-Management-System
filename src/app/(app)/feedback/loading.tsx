import { Card } from "@/components/ui/card";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto max-w-[860px] space-y-5 px-6 pb-10 pt-5">
      <Skeleton className="h-7 w-40" />
      <Skeleton className="h-9 w-52" />
      <Card className="p-4">
        <SkeletonText lines={3} />
      </Card>
      <Card className="p-4">
        <SkeletonText lines={3} />
      </Card>
    </div>
  );
}
