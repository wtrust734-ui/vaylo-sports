import { type CSSProperties, forwardRef } from "react";
import { ChevronRight, type LucideIcon, type LucideProps } from "lucide-react";

/**
 * SectionHeader — the one header used at the top of dashboard sections.
 *
 * One header, one cadence. Before this there were at least three different
 * "section header" shapes in the app: a bold label with a trailing action in
 * Index, a bare uppercase label in HubPage, and inline headings inside cards.
 * Consolidating to one keeps the dashboard from reading as a collage.
 */
export const SectionHeader = forwardRef<
  HTMLDivElement,
  {
    title: string;
    icon?: LucideIcon;
    /** A primary action placed to the right of the title, on the same line. */
    onAction?: () => void;
    actionLabel?: string;
    size?: "default" | "small";
  }
>(({ title, icon: Icon, onAction, actionLabel, size = "default" }, ref) => {
  const pad = size === "small" ? "py-2.5" : "py-4";
  const gap = size === "small" ? "gap-2" : "gap-2.5";
  const titleSize = size === "small" ? "text-[15px]" : "text-[17px]";

  return (
    <div
      ref={ref}
      className={`flex items-baseline justify-between ${pad} ${gap}`}
    >
      <div>
        <h2
          className={`font-display font-semibold tracking-tight leading-snug ${titleSize}`}
        >
          {Icon ? (
            <span className="inline-flex items-center gap-2">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                <Icon size={14} className="text-primary" aria-hidden />
              </span>
              <span>{title}</span>
            </span>
          ) : (
            title
          )}
        </h2>
      </div>
      {onAction && actionLabel ? (
        <button
          type="button"
          onClick={onAction}
          aria-label={actionLabel}
          className="inline-flex items-center gap-1 rounded-lg border border-primary/20 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/15"
        >
          {actionLabel}
          <ChevronRight size={12} aria-hidden />
        </button>
      ) : null}
    </div>
  );
});
SectionHeader.displayName = "SectionHeader";

/**
 * Metric — a meaningful number with a label and an optional change hint.
 *
 * The app already shows numbers everywhere; the problem was inconsistent
 * formatting. Metrics use tabular treatment so athletes can scan values, and
 * the delta is shown in words or as a signed number, never as a bare float.
 */
export const Metric = forwardRef<
  HTMLDivElement,
  {
    label: string | React.ReactNode;
    value: number | string;
    unit?: string;
    hint?: React.ReactNode;
    size?: "default" | "small";
  }
>(({ label, value, unit, hint, size = "default" }, ref) => {
  const valueSize = size === "small" ? "text-[22px]" : "text-[28px]";
  const labelSmall = size === "small" ? "text-[12px]" : "text-sm";

  return (
    <div ref={ref} className={`flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1`}>
      <div>
        <p className={`text-foreground/70 font-medium leading-snug ${labelSmall}`}>
          {label}
        </p>
        <p
          className={`mt-0.5 font-display font-semibold tracking-tight tabular-nums ${valueSize} leading-none`}
          style={{ color: "hsl(var(--foreground))" }}
        >
          {typeof value === "number" ? value.toLocaleString() : value}
          {unit ? (
            <span className="ml-1.5 font-normal text-foreground/60">
              {unit}
            </span>
          ) : null}
        </p>
      </div>
      {hint ? <div className={`flex-shrink-0 text-right ${labelSmall} text-muted-foreground`}>{hint}</div> : null}
    </div>
  );
});
Metric.displayName = "Metric";

/**
 * Delta — a small signed change next to a metric.
 *
 * It is deliberately not a chart. A single number changing by a few points does
 * not need a sparkline; it needs a word and a sign.
 */
export const Delta = ({
  value,
  unit,
  color,
  className,
}: {
  value: number;
  unit?: string;
  color?: string;
  /** Appended to the pill, e.g. a text size override. */
  className?: string;
}) => {
  const sign = value > 0 ? "+" : value < 0 ? "" : "";
  const positive = value > 0;
  const negative = value < 0;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-medium tabular-nums ${
        className ?? ""
      } ${
        positive
          ? "bg-success/10 text-success"
          : negative
            ? "bg-destructive/10 text-destructive"
            : "bg-muted/40 text-muted-foreground"
      }`}
    >
      {sign}
      {Math.abs(value)}
      {unit ? <span className="text-foreground/70">{unit}</span> : null}
    </span>
  );
};

/**
 * Chip — a compact status/label pill that never communicates essential info by
 * colour alone: every chip has a label, and success/warning/error flavours only
 * accent the label.
 */
export const Chip = forwardRef<
  HTMLSpanElement,
  {
    children: React.ReactNode;
    tone?: "neutral" | "success" | "warning" | "error" | "primary";
    size?: "sm" | "md";
  }
>(({ children, tone = "neutral", size = "sm" }, ref) => {
  const map = {
    neutral: "bg-muted/40 text-muted-foreground",
    success: "bg-success/10 text-success",
    warning: "bg-warning/10 text-warning",
    error: "bg-destructive/10 text-destructive",
    primary: "bg-primary/10 text-primary",
  } as const;
  const pad = size === "sm" ? "px-2 py-0.5" : "px-2.5 py-1";
  return (
    <span
      ref={ref}
      className={`inline-flex items-center rounded-full border border-white/10 font-medium ${pad} ${map[tone]}`}
    >
      {children}
    </span>
  );
});
Chip.displayName = "Chip";

/**
 * IconBadge — a consistent icon tile used by hub rows, quick actions, and
 * section headers. The app already had several, all slightly different; this is
 * the shared one.
 */
export const IconBadge = forwardRef<
  HTMLSpanElement,
  {
    icon: LucideIcon;
    tone?: "primary" | "muted" | "brand";
    size?: "sm" | "md";
    ariaLabel?: string;
  }
>(({ icon: Icon, tone = "primary", size = "md", ariaLabel }, ref) => {
  const sizeClass = size === "sm" ? "h-8 w-8" : "h-10 w-10";
  const iconSize = size === "sm" ? 15 : 18;
  const styles = {
    primary: "bg-primary/10 border-primary/20 text-primary",
    muted: "bg-muted/40 border-white/10 text-muted-foreground",
    brand: "bg-gradient-to-br from-primary/25 to-electric-purple/20 border-primary/20 text-primary",
  } as const;
  return (
    <span
      ref={ref}
      className={`flex ${sizeClass} items-center justify-center rounded-xl border ${styles[tone]}`}
      aria-label={ariaLabel}
    >
      <Icon size={iconSize} aria-hidden />
    </span>
  );
});
IconBadge.displayName = "IconBadge";

/**
 * SlideAction — a compact inline "label →" action used under insights and
 * section prompts. Not a full button; a chip with an affordance.
 */
export const SlideAction = ({
  children,
  path,
  onClick,
}: {
  children: React.ReactNode;
  path?: string;
  onClick?: () => void;
}) => {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-full border border-primary/15 bg-primary/10 px-2.5 py-1 text-[12px] font-bold text-primary transition-colors hover:bg-primary/15"
    >
      {children}
      <ChevronRight size={12} aria-hidden />
    </button>
  );
};
