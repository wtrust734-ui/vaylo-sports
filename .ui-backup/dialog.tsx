import * as React from "react";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";

interface DialogContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const DialogContext = React.createContext<DialogContextValue | undefined>(undefined);

export function useDialog() {
  const context = React.useContext(DialogContext);
  if (!context) {
    throw new Error("Dialog components must be used within a Dialog provider");
  }
  return context;
}

export function Dialog({
  open,
  onOpenChange,
  children,
  ...props
}: { open: boolean; onOpenChange: (open: boolean) => void; children: React.ReactNode }) {
  return (
    <DialogContext.Provider value={{ open, setOpen: onOpenChange }}>
      <div
        className={cn(
          "fixed inset-0 z-50 flex items-center justify-center",
          open ? "visible" : "invisible",
        )}
        {...props}
      >
        {open && <div className="fixed inset-0 bg-black/60" onClick={() => onOpenChange(false)} />}
        <div className="relative z-50 m-4 max-h-[90vh] overflow-auto rounded-xl border border-white/10 bg-[#0f1118] p-6 shadow-xl">
          {children}
        </div>
      </div>
    </DialogContext.Provider>
  );
}

export function DialogContent({ children, className, ...props }: { children: React.ReactNode; className?: string }) {
  const { setOpen } = useDialog();
  return (
    <div className={cn("space-y-4", className)} {...props}>
      {children}
      <button
        type="button"
        className="absolute right-3 top-3 rounded-sm opacity-70 hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-primary"
        onClick={() => setOpen(false)}
      >
        <X className="h-4 w-4 text-white/80" />
      </button>
    </div>
  );
}

export function DialogHeader({ children, className, ...props }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("space-y-1.5", className)} {...props}>{children}</div>;
}

export function DialogTitle({ children, className, ...props }: { children: React.ReactNode; className?: string }) {
  return (
    <h3
      className={cn(
        "text-lg font-semibold text-white leading-none tracking-tight",
        className,
      )}
      {...props}
    >
      {children}
    </h3>
  );
}

export function DialogDescription({ children, className, ...props }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={cn("text-sm text-white/70", className)} {...props}>
      {children}
    </p>
  );
}
