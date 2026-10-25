import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
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
  // z-[59], not z-50: the floating tab bar is a later sibling of <main> and
  // wins at equal z-index, so on z-50 every sheet opened with the tab bar
  // painted over it — and over its own footer buttons. See the ladder in
  // BottomNav. Callers that need to sit above this can still pass `z`.
  z = "z-[59]",
  className,
  bodyClassName,
  children,
}: BottomSheetProps) {
  const reduced = useReducedMotion() ?? false;
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // The latest onClose, read through a ref. Callers pass an inline arrow
  // (`onClose={() => setTarget(null)}`), so its identity changes on every
  // render of the caller — including the render caused by a single keystroke in
  // a field inside the sheet. The setup/teardown effect below must therefore
  // key on `open` only: keying it on `onClose` ran the cleanup on every
  // keystroke, and that cleanup restored focus to whatever was focused before
  // the sheet opened, pulling the caret out of the textarea after every letter.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // The device back button closes the sheet rather than leaving the screen.
  useBackHandler(open, onClose);

  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    // Captured now, at open, rather than read in the cleanup: by the time the
    // effect tears down the panel may already be detached, and `!panel` is one
    // of the cases in which focus should be handed back.
    const panel = panelRef.current;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
    };
    document.addEventListener("keydown", onKey);

    // Move focus into the sheet (unless the caller focused something itself).
    const focusTimer = window.setTimeout(() => {
      if (!panel) return;
      if (panel.contains(document.activeElement)) return;
      panel.focus({ preventScroll: true });
    }, 0);

    return () => {
      document.removeEventListener("keydown", onKey);
      window.clearTimeout(focusTimer);
      // Restore focus only when the sheet is actually going away and focus is
      // still inside it (or its node is gone). If focus has already moved
      // somewhere else — a native picker, a toast — leaving it alone is the
      // correct behaviour; stealing it back is how the caret got yanked out of
      // the refund form.
      if (!panel || !panel.isConnected || panel.contains(document.activeElement)) {
        previouslyFocused.current?.focus?.();
      }
      previouslyFocused.current = null;
    };
  }, [open]);

  const sheet = (
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
              // `dvh` rather than `vh`: on Android the dynamic viewport height
              // tracks the keyboard and the system bars, so a sheet containing a
              // form shrinks with the space available instead of overflowing
              // past the top of the screen. `vh` on Android WebView resolves
              // against the *largest* viewport, which is the full screen height
              // and therefore too tall exactly when a keyboard is open.
              "flex max-h-[90dvh] w-full flex-col overflow-hidden rounded-t-3xl border border-border bg-background shadow-elev-3 outline-none sm:rounded-3xl",
              SIZES[size],
              className
            )}
          >
            <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-border sm:hidden" aria-hidden />

            {(title || headerRight || leading) && (
              <div className="flex items-start gap-3 border-b border-border px-5 py-4">
                {leading}
                <div className="min-w-0 flex-1">
                  {title && <h3 className="break-words font-display text-base font-bold text-foreground">{title}</h3>}
                  {subtitle && <p className="mt-0.5 break-words text-[12px] text-muted-foreground">{subtitle}</p>}
                </div>
                {headerRight}
                {/* The one way out of every sheet in the app, so it has to be
                    hittable with a thumb.

                    It used to be a 16px icon in a `p-1.5` box: 28px wide. The
                    44px touch floor in index.css only sets `min-height`, so
                    this control passed the floor while being barely half a
                    thumb wide — and on the Health Connect sheet, where the
                    header X is the *only* permanent exit (the footer's primary
                    action is "Sync now"), an athlete who missed it read the
                    sheet as an unclosable pop-up. `-me-2 -mt-1` keeps the icon
                    where it was drawn while the hit area grows around it. */}
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  className="-me-2 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:text-foreground"
                >
                  <X size={16} />
                </button>
              </div>
            )}

            {toolbar}

            <div
              className={cn(
                "min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4",
                !footer && "pb-[max(1.25rem,var(--vaylo-inset-bottom))]",
                bodyClassName
              )}
            >
              {children}
            </div>

            {footer && (
              <div className="shrink-0 border-t border-border px-5 pb-[max(1rem,var(--vaylo-inset-bottom))] pt-3">
                {footer}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  /* Portalled into <body>. Not a style preference — it is the fix for a real
     stacking fault.

     The ladder documented in BottomNav puts in-page sheets at z-[59] and the
     floating bar at z-50, so a sheet should always win. It does not win when
     the sheet is rendered inside a page's *stacking context*: a z-index is only
     compared against its siblings inside one context, and the caller's panel
     then paints at its own (auto) level, under the bar's 50. The app has such a
     panel: TabShell gives every bottom-navigation root (Home, Train, Perform,
     Profile) a `.nav-fade` opacity animation with `animation-fill-mode: both`
     while it is the shown tab. An element with a running or filled animation is
     composited, and a composited element is a stacking context — so the
     Wearables sheet opened from Profile, and every other in-page sheet on a tab
     root, was clamped to that panel and painted under the tab bar, which then
     covered the sheet's own footer and stole its taps.

     Portalling to <body> puts the overlay back at the root of the stack, where
     the ladder in BottomNav actually applies, and it fixes every caller at once
     instead of asking each screen to remember where it renders. It keeps the
     panel out of any ancestor's `overflow` and out of that page's paint order
     too. Focus restore and the Escape listener are document-level already, so
     they are unaffected. */
  if (typeof document === "undefined") return sheet;
  return createPortal(sheet, document.body);
}
