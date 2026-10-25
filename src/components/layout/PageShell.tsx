// ============================================================================
// PAGE SHELL + PAGE HEADER — one frame for every full-width screen
// ----------------------------------------------------------------------------
// The app grew three different page frames. Some screens opened with
// `px-4`, some with `px-5`; the title was `text-2xl` on most, `text-3xl` on
// Challenges and absent (the subtitle carried the name) on others; eyebrows
// were `text-[12px]`, `text-xs` or `text-[11px]`; the trailing space under the
// header was `pb-4`, `pb-5` or `mb-5`. None of it was wrong on its own screen,
// and all of it was wrong when you moved between them — the column shifted
// sideways, the first line jumped up or down, and the same kind of heading read
// as a different rank depending on which tile you tapped.
//
// This is the frame every screen that owns its own scroll area should use:
//
//   <PageShell>
//     <PageHeader eyebrow="Trophy Room" icon={Sparkles} title="Achievements" subtitle="…" />
//     …content…
//   </PageShell>
//
// The values are the ones index.css documents (`--vaylo-screen-top`, the 20px
// gutter, `pb-28` to clear the floating tab bar) — this component does not
// introduce a fourth set, it makes the existing one the only one.
//
// Detail screens that carry a BackBar do NOT use this: the BackBar already
// draws the top row and applies the same gutter, and stacking both would double
// it. Hubs use <HubPage>, which is this frame with a hero and sections.
// ============================================================================

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export interface PageShellProps {
  children: ReactNode;
  /** Extra classes for the one screen that needs them. Gutters are not optional. */
  className?: string;
  /** Wider than the reading column? List screens stay at the default. */
  width?: "default" | "wide";
}

export function PageShell({ children, className, width = "default" }: PageShellProps) {
  return (
    <div
      className={cn(
        "min-h-screen bg-background px-5 pt-[var(--vaylo-screen-top)] pb-28",
        width === "wide" ? "max-w-5xl" : "max-w-2xl",
        "mx-auto",
        className,
      )}
    >
      {children}
    </div>
  );
}

export interface PageHeaderProps {
  /** Small uppercase line above the title. Same size and colour everywhere. */
  eyebrow?: string;
  icon?: LucideIcon;
  title: string;
  subtitle?: ReactNode;
  /** A control on the right of the title row (count, filter, icon button). */
  right?: ReactNode;
  className?: string;
}

export function PageHeader({ eyebrow, icon: Icon, title, subtitle, right, className }: PageHeaderProps) {
  return (
    <header className={cn("pb-5", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {eyebrow ? (
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-energy">
              {Icon ? <Icon size={12} aria-hidden /> : null}
              {eyebrow}
            </p>
          ) : null}
          <h1 className="mt-1 font-display text-2xl font-bold leading-tight">{title}</h1>
        </div>
        {right}
      </div>
      {subtitle ? (
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{subtitle}</p>
      ) : null}
    </header>
  );
}

export interface StatItem {
  value: ReactNode;
  label: string;
  /** Tailwind text colour for the number, e.g. "text-energy". */
  tone?: string;
}

/**
 * One filter pill, used wherever a screen narrows a list.
 *
 * Achievements and Challenges had two nearly-identical chips — same radius,
 * same gradient, different height and padding — so switching between the two
 * screens moved the row up 6px and shrank the touch target below the 40px
 * floor. Pills are pills; this is the only one.
 */
export function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "min-h-[40px] whitespace-nowrap rounded-full border px-4 text-xs font-semibold transition-colors",
        active
          ? "border-transparent bg-gradient-primary text-primary-foreground shadow-glow"
          : "border-border bg-card text-muted-foreground hover:border-primary/40",
      )}
    >
      {children}
    </button>
  );
}

/** A row of FilterChips. Scrolls sideways rather than wrapping or clipping. */
export function FilterRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      role="group"
      aria-label={label}
      className="no-scrollbar mb-4 flex gap-1.5 overflow-x-auto"
    >
      {children}
    </div>
  );
}

/**
 * Three-up counters under a page header — the same strip on Achievements,
 * Trophy Room and Challenges. Each screen used to draw its own: three
 * different paddings, two number sizes, one with a gradient panel and one
 * without. Counts are counts; they look the same everywhere.
 */
export function StatStrip({ items }: { items: StatItem[] }) {
  return (
    <div className="grid grid-cols-3 gap-2 rounded-2xl border border-border bg-card/60 p-3">
      {items.map((item, index) => (
        <div key={item.label} className={index > 0 ? "border-s border-border/70 ps-2" : undefined}>
          <p className={cn("font-display text-xl font-bold leading-none", item.tone ?? "text-foreground")}>
            {item.value}
          </p>
          <p className="mt-1 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            {item.label}
          </p>
        </div>
      ))}
    </div>
  );
}

export default PageShell;
