import * as React from "react";
import { cn } from "@/lib/utils";

interface SheetContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const SheetContext = React.createContext<SheetContextValue | undefined>(undefined);

export function useSheet() {
  const context = React.useContext(SheetContext);
  if (!context) {
    throw new Error("Sheet components must be used within a Sheet root");
  }
  return context;
}

export interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  side?: "left" | "right" | "top" | "bottom";
  className?: string;
}

export function Sheet({
  open,
  onOpenChange,
  children,
  side = "right",
  className,
}: SheetProps) {
  return (
    <SheetContext.Provider value={{ open, setOpen: onOpenChange }}>
      <div
        className={cn(
          "fixed inset-0 z-50 flex",
          side === "left" && "justify-start",
          side === "right" && "justify-end",
          side === "top" && "items-start",
          side === "bottom" && "items-end",
          open ? "visible" : "invisible",
        )}
        {...className && { className }}
      >
        {open && <div className="fixed inset-0 bg-black/60" onClick={() => onOpenChange(false)} />}
        <div
          className={cn(
            "relative z-50 h-full w-64 bg-[#0f1118] shadow-xl transition-transform",
            side === "left" && "translate-x-0",
            side === "right" && "-translate-x-full",
            side === "top" && "translate-y-0",
            side === "bottom" && "translate-y-full",
            !open && side === "left" && "translate-x-0",
            !open && side === "right" && "-translate-x-full",
            !open && side === "top" && "translate-y-0",
            !open && side === "bottom" && "translate-y-full",
          )}
        >
          {children}
        </div>
      </div>
    </SheetContext.Provider>
  );
}

export function SheetContent({
  side = "right",
  className,
  children,
  ...props
}: { side?: "left" | "right" | "top" | "bottom"; className?: string; children: React.ReactNode }) {
  return (
    <Sheet side={side} {...props}>
      <div className={cn("flex h-full flex-col border-l border-white/10 p-4", className)}>
        {children}
      </div>
    </Sheet>
  );
}

export function SheetHeader({ children, className, ...props }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("flex flex-col space-y-1.5", className)} {...props}>{children}</div>;
}

export function SheetTitle({ children, className, ...props }: { children: React.ReactNode; className?: string }) {
  return (
    <h2 className={cn("text-base font-semibold text-white", className)} {...props}>
      {children}
    </h2>
  );
}

export function SheetDescription({ children, className, ...props }: { children: React.ReactNode; className?: string }) {
  return <p className={cn("text-sm text-white/70", className)} {...props}>{children}</p>;
}
