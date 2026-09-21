import { useEffect, useRef, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { overlayMotion, panelMotion } from "@/lib/motion";
import { useBackHandler } from "@/hooks/use-back-handler";

const SIZES = {
  sm: "sm:max-w-sm",
  md: "sm:max-w-md",
  lg: "sm:max-w-lg",
  xl: "sm:max-w-2xl",
} as const;

export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  /** Header text or node. Omit header entirely by leaving this undefined. */
  title?: ReactNode;
  subtitle?: ReactNode;
  /** Icon or avatar shown before the title. */
  leading?: ReactNode;
  /** Extra header content (balances, badges) shown before the close button. */
  headerRight?: ReactNode;
  /** Sticky strip under the header — tabs, filters. */
  toolbar?: ReactNode;
  /** Sticky bottom area — usually a primary action. */
  footer?: ReactNode;
  size?: keyof typeof SIZES;
  /** Overlay stacking class, e.g. "z-[60]". */
  z?: string;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}

/**
 * The app's one bottom sheet: mobile-first (rises from the bottom, grab handle,
 * safe-area padding) and centred on larger screens. Owns the backdrop, motion,
 * Escape handling and focus restore so screens don't each reinvent it.
 *
 * Honours `prefers-reduced-motion` — the panel then just fades in.
 */
export default function BottomSheet({
  open,
  onClose,
  title,
  subtitle,
  leading,
  headerRight,
  toolbar,
  footer,
  size = "md",
  z = "z-50",
  className,
  bodyClassName,
  children,
}: BottomSheetProps) {
  const reduced = useReducedMotion() ?? false;
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // The device back button closes the sheet rather than leaving the screen.
  useBackHandler(open, onClose);

  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);

    // Move focus into the sheet (unless the caller focused something itself).
    const focusTimer = window.setTimeout(() => {
      const panel = panelRef.current;
      if (!panel) return;
      if (panel.contains(document.activeElement)) return;
      panel.focus({ preventScroll: true });
    }, 0);

    return () => {
      document.removeEventListener("keydown", onKey);
      window.clearTimeout(focusTimer);
      previouslyFocused.current?.focus?.();
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          {...overlayMotion(reduced)}
          onClick={onClose}
          className={cn("fixed inset-0 flex items-end justify-center bg-black/60 sm:items-center", z)}
        >
          <motion.div
            ref={panelRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label={typeof title === "string" ? title : undefined}
            {...panelMotion(reduced)}
            onClick={(event) => event.stopPropagation()}
            className={cn(
              "flex max-h-[90vh] w-full flex-col overflow-hidden rounded-t-3xl border border-border bg-background shadow-elev-3 outline-none sm:rounded-3xl",
              SIZES[size],
              className
            )}
          >
            <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-border sm:hidden" aria-hidden />

            {(title || headerRight || leading) && (
              <div className="flex items-start gap-3 border-b border-border px-5 py-4">
                {leading}
                <div className="min-w-0 flex-1">
                  {title && <h3 className="font-display text-base font-bold text-foreground">{title}</h3>}
                  {subtitle && <p className="mt-0.5 text-[11px] text-muted-foreground">{subtitle}</p>}
                </div>
                {headerRight}
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:text-foreground"
                >
                  <X size={16} />
                </button>
              </div>
            )}

            {toolbar}

            <div
              className={cn(
                "min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4",
                !footer && "pb-[max(1.25rem,env(safe-area-inset-bottom))]",
                bodyClassName
              )}
            >
              {children}
            </div>

            {footer && (
              <div className="shrink-0 border-t border-border px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
                {footer}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
