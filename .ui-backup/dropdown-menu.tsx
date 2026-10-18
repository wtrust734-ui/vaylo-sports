import * as React from "react";
import { cn } from "@/lib/utils";
import { Check, ChevronRight } from "lucide-react";

interface DropdownContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const DropdownContext = React.createContext<DropdownContextValue | undefined>(undefined);

export function useDropdown() {
  const context = React.useContext(DropdownContext);
  if (!context) {
    throw new Error("DropdownMenu components must be used within a DropdownMenu root");
  }
  return context;
}

export interface DropdownMenuProps {
  children: React.ReactNode;
  align?: "start" | "end";
  className?: string;
}

export function DropdownMenu({
  children,
  align = "end",
  className,
}: DropdownMenuProps) {
  const [open, setOpen] = React.useState(false);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const close = React.useCallback(() => setOpen(false), []);

  React.useEffect(() => {
    if (!open) return;
    const handleClick = (event: MouseEvent) => {
      if (
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <DropdownContext.Provider value={{ open, setOpen }}>
      <div className={cn("relative", className)}>
        <div className="flex">{children}</div>
        {open && (
          <div
            ref={menuRef}
            className={cn(
              "absolute z-50 mt-2 overflow-hidden rounded-lg border border-white/10 bg-[#0f1118] p-1 shadow-xl animate-in fade-in-0 zoom-in-95",
              align === "end" ? "right-0" : "left-0",
            )}
            role="menu"
          >
            {React.Children.map(children, (child) => {
              if (typeof child !== "object" || child === null) return child;
              if ((child as { type?: unknown }).type === DropdownMenuContent) {
                return React.cloneElement(child as React.ReactElement, {
                  ref: menuRef,
                });
              }
              return child;
            })}
          </div>
        )}
      </div>
    </DropdownContext.Provider>
  );
}

export function DropdownMenuTrigger({
  children,
  className,
  ...props
}: { children: React.ReactNode; className?: string }) {
  const { open, setOpen } = useDropdown();
  return (
    <button
      ref={React.useRef<HTMLButtonElement>(null) as React.RefObject<HTMLButtonElement>}
      onClick={() => setOpen((prev) => !prev)}
      className={cn(
        "inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function DropdownMenuContent({
  children,
  className,
  ...props
}: { children: React.ReactNode; className?: string }) {
  const { setOpen } = useDropdown();
  return (
    <div
      className={cn(
        "py-1 px-1 text-sm text-white",
        className,
      )}
      onClick={() => setOpen(false)}
      {...props}
    >
      {children}
    </div>
  );
}

export function DropdownMenuLabel({
  children,
  className,
  ...props
}: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn("px-2 py-1.5 text-xs font-semibold uppercase tracking-wider text-white/60", className)}
      {...props}
    >
      {children}
    </div>
  );
}

export function DropdownMenuItem({
  children,
  className,
  ...props
}: { children: React.ReactNode; className?: string }) {
  return (
    <button
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-white/80 transition-colors focus:bg-white/5 focus:text-white disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function DropdownMenuSeparator({ className, ...props }: { className?: string }) {
  return (
    <div
      className={cn("my-1 h-px bg-white/10", className)}
      {...props}
    />
  );
}
