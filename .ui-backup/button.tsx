import * as React from "react";
import { cn } from "@/lib/utils";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "outline" | "ghost" | "secondary";
  size?: "default" | "sm" | "icon" | "lg";
  className?: string;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", ...props }, ref) => {
    return (
      <button
        className={cn(
          "inline-flex items-center justify-center rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-[#07090f] disabled:pointer-events-none disabled:opacity-50",
          variant === "default" &&
            "bg-primary text-primary-foreground shadow hover:bg-primary/90",
          variant === "secondary" &&
            "bg-white/10 text-white/90 hover:bg-white/15",
          variant === "outline" &&
            "border border-white/10 bg-transparent text-white hover:bg-white/5",
          variant === "ghost" &&
            "bg-transparent text-white/80 hover:bg-white/5 hover:text-white",
          size === "default" && "h-9 px-4 py-2 text-sm",
          size === "sm" && "h-8 px-3 text-xs",
          size === "icon" && "h-8 w-8",
          size === "lg" && "h-10 px-6 text-base",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);

Button.displayName = "Button";
