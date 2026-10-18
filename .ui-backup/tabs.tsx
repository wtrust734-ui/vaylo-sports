import * as React from "react";
import { cn } from "@/lib/utils";

export interface TabsContextValue {
  value: string;
  setValue: (value: string) => void;
}

const TabsContext = React.createContext<TabsContextValue | undefined>(undefined);

export function useTabs() {
  const context = React.useContext(TabsContext);
  if (!context) {
    throw new Error("Tabs components must be used within a Tabs provider");
  }
  return context;
}

export function Tabs({
  defaultValue,
  value,
  onValueChange,
  children,
  ...props
}: {
  defaultValue?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  children: React.ReactNode;
}) {
  const [internalValue, setInternalValue] = React.useState(defaultValue ?? "");

  const currentValue = value ?? internalValue;
  const setValue = onValueChange
    ? () => onValueChange(currentValue)
    : () => setInternalValue(currentValue);

  return (
    <TabsContext.Provider value={{ value: currentValue, setValue }}>
      <div {...props}>{children}</div>
    </TabsContext.Provider>
  );
}

export function TabsList({ children, className, ...props }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      role="tablist"
      className={cn(
        "inline-flex h-10 items-center justify-center rounded-lg bg-white/5 p-1 text-muted",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function TabsTrigger({
  value,
  children,
  className,
  ...props
}: { value: string; children: React.ReactNode; className?: string }) {
  const { value: selected, setValue } = useTabs();
  const isActive = selected === value;

  return (
    <button
      role="tab"
      aria-selected={isActive}
      onClick={() => setValue(value)}
      className={cn(
        "inline-flex h-9 w-full items-center justify-center rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-[#07090f] disabled:pointer-events-none disabled:opacity-50",
        isActive
          ? "bg-white/10 text-white shadow"
          : "text-white/60 hover:text-white hover:bg-white/5",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function TabsContent({
  value,
  children,
  className,
  ...props
}: { value: string; children: React.ReactNode; className?: string }) {
  const { value: selected } = useTabs();
  if (selected !== value) return null;

  return (
    <div
      role="tabpanel"
      className={cn("mt-4 text-sm text-white/80 focus-visible:outline-none", className)}
      {...props}
    >
      {children}
    </div>
  );
}
