import { type ReactNode } from "react";
import { motion } from "framer-motion";
import { TrendingUp, TrendingDown, Minus, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function SectionHeader({ title, icon: Icon, action, actionLabel, onAction }: {
  title: string;
  icon?: LucideIcon;
  actionLabel?: string;
  onAction?: () => void;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h2 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
        {Icon && <Icon size={12} aria-hidden />}
        {title}
      </h2>
      {action ?? (actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="inline-flex items-center gap-1 rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[11px] font-bold text-primary hover:bg-white/[0.07] transition-colors"
        >
          {actionLabel} →
        </button>
      ))}
    </div>
  );
}

export function Section({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn("px-5", className)}>{children}</section>;
}

export function Delta({ value, suffix = "", className, unit }: {
  value: number | null;
  suffix?: string;
  className?: string;
  unit?: string;
}) {
  if (value == null) {
    return unit ? (
      <span className={cn("text-[11px] text-muted-foreground", className)}>{unit}</span>
    ) : null;
  }
  const up = value > 0;
  const down = value < 0;
  const Icon = up ? TrendingUp : down ? TrendingDown : Minus;
  const color = up ? "text-success" : down ? "text-destructive" : "text-muted-foreground";
  const sign = up ? "+" : "";
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border border-white/[0.06] bg-white/[0.03] px-2 py-0.5 text-[11px] font-bold tabular-nums", color, className)}>
      <Icon size={11} aria-hidden />
      {sign}{value}{suffix}
    </span>
  );
}

export function Metric({ label, value, hint, className }: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <p className="text-xl font-display font-bold tabular-nums leading-none tracking-tight">{value}</p>
      <p className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      {hint && <div className="mt-1">{hint}</div>}
    </div>
  );
}

export function VprFactorBar({ label, value, weight, animated = true }: {
  label: string;
  value: number;
  weight?: number;
  animated?: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-24 shrink-0 text-xs font-medium text-muted-foreground">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06] border border-white/[0.04]">
        <motion.div
          initial={animated ? { width: 0 } : false}
          animate={{ width: `${Math.max(0, Math.min(100, value))}%` }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
          className={cn("h-full rounded-full", value >= 70 ? "bg-gradient-primary" : value >= 45 ? "bg-energy" : "bg-destructive")}
        />
      </div>
      <span className="w-16 shrink-0 text-right text-xs font-bold tabular-nums">
        {value}
        {weight != null && <span className="ml-1 text-[10px] font-semibold text-muted-foreground">×{weight.toFixed(2)}</span>}
      </span>
    </div>
  );
}
