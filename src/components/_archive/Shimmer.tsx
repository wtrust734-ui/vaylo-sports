import { cn } from "@/lib/utils";

/**
 * Skeleton block with shimmer sweep. GPU-friendly (background-position only,
 * but kept lightweight; falls back to subtle pulse for reduced motion).
 */
const Shimmer = ({ className }: { className?: string }) => (
  <div
    className={cn(
      "relative overflow-hidden rounded-md bg-muted/40",
      "before:absolute before:inset-0 before:-translate-x-full",
      "before:bg-[linear-gradient(90deg,transparent,hsla(0,0%,100%,0.06),transparent)]",
      "before:animate-[shimmer-sweep_1.6s_infinite] motion-reduce:before:hidden motion-reduce:animate-pulse",
      className,
    )}
  />
);

export default Shimmer;
