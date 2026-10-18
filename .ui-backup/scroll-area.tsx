import * as React from "react";
import { cn } from "@/lib/utils";

export function ScrollArea({
  children,
  className,
  ...props
}: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn("relative overflow-hidden", className)}
      {...props}
    >
      <div className="absolute inset-0 overflow-auto">{children}</div>
    </div>
  );
}
