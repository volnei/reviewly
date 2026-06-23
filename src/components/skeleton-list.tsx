import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * A stack of placeholder rows — the single loading pattern for lists, replacing
 * the repeated `[...Array(n)].map(<Skeleton/>)` boilerplate. `className` styles
 * the wrapper (spacing/padding); `itemClassName` overrides each row's height.
 */
export function SkeletonList({
  count = 6,
  className,
  itemClassName,
}: {
  count?: number;
  className?: string;
  itemClassName?: string;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className={cn("h-12 w-full rounded-md", itemClassName)} />
      ))}
    </div>
  );
}
