import * as React from "react";
import { cn } from "@/lib/utils";

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "secondary" | "outline";
}

export const Badge = React.forwardRef<HTMLDivElement, BadgeProps>(
  ({ className, variant = "default", ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
          variant === "default" && "bg-primary text-primary-foreground shadow",
          variant === "secondary" && "bg-white/10 text-white/80",
          variant === "outline" && "border border-white/10 text-white/80 bg-transparent",
          className,
        )}
        {...props}
      />
    );
  },
);

Badge.displayName = "Badge";
