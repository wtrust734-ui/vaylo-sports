import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { claimCreditReward, creditCost } from "@/lib/credits";
import { useAuth } from "@/contexts/AuthContext";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { X, Crown, Brain, ScanLine, Star, Heart } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { UNLIMITED_PLAN, formatPence } from "@/config/subscriptionPlans";

// Prices come from the source of truth, not literals: subscriptionPlans.ts is
// the single catalogue (the DB row wins at runtime, this config is the
// fallback), and every credit-feature price is creditCost(). The old literals
// ("$12.99/mo", "$3.99", dollars and all) were invented and drifted from both
// currencies the app actually charges — the market page read £ and these
// cards read $. One catalogue, zero drift.
const proMonthly = UNLIMITED_PLAN.options.find((o) => o.period === "month");
const promos = [
  {
    id: "pro",
    icon: Crown,
    title: "Unlimited credits",
    desc: "Every feature, no balance to watch. Best value when you train daily.",
    price: proMonthly ? `${formatPence(proMonthly.price_pence)}/month` : "see the Market",
    color: "text-energy",
    bg: "bg-energy/10",
  },
  {
    id: "mental",
    icon: Brain,
    title: "Mental Gym",
    desc: "Breathing, visualisation, cognitive tools — a permanent unlock.",
    price: `${creditCost("mental_gym_unlock")} credits, once`,
    color: "text-electric-purple",
    bg: "bg-electric-purple/10",
  },
  {
    id: "form",
    icon: ScanLine,
    title: "AI Video Form Analysis",
    desc: "Send a clip, get expert technique feedback with coaching cues.",
    price: `${creditCost("video_form_analysis")} credits`,
    color: "text-primary",
    bg: "bg-primary/10",
  },
  {
    id: "coach",
    icon: Star,
    title: "Your AI coach",
    desc: "Message Vaylo's coach whenever you need direction between reviews.",
    price: `from ${creditCost("vaylo_coach_message")} credits`,
    color: "text-energy",
    bg: "bg-energy/10",
  },
];

const WINBACK_DISMISS_KEY = "vaylo_winback_dismissed_until";
/**
 * Snooze for the standard promo. `legal/advertising.html` tells people "if you
 * dismiss one, the app remembers that on your device so it does not ask again
 * for a while" — this is the storage that makes that true. Dismissing never
 * opts anyone out permanently, it just backs off for the window below.
 */
const PROMO_DISMISS_KEY = "vaylo_promo_dismissed_until";
const PROMO_SNOOZE_MS = 7 * 86400_000;

/**
 * True while a consent/legal surface (the cookie notice, or the terms
 * re-acceptance banner) is on screen. A sales card must never share the screen
 * with one: it draws over the same bottom band, and interrupting a consent or
 * legal notice with a sales offer is exactly the pressure the advertising
 * policy disclaims. The promo waits until the notice is gone instead.
 */
const consentNoticeVisible = (): boolean => {
  if (typeof document === "undefined") return false;
  const notice = document.querySelector('[role="region"][aria-label="Cookies and stored preferences"]');
  if (notice && !(notice as HTMLElement).hidden) return true;
  // The terms banner publishes its height as --vaylo-notice-lift and removes
  // the property when it leaves, so its presence is readable without reaching
  // into its component.
  const lift = getComputedStyle(document.documentElement).getPropertyValue("--vaylo-notice-lift").trim();
  return lift !== "" && lift !== "0px";
};

const PromoPopup = () => {
  const { hasUnlimitedCredits, entitlements } = useSubscription();
  const { user } = useAuth();
  const [claimingWinback, setClaimingWinback] = useState(false);
  // Respect the OS "reduce motion" setting: the card slides up only when the
  // athlete has not asked for calmer interfaces. A sales surface is where
  // restraint matters most.
  const reducedMotion = useReducedMotion();
  const isPremium = hasUnlimitedCredits;
  const navigate = useNavigate();
  const [show, setShow] = useState(false);
  const [promoIndex, setPromoIndex] = useState(0);
  const [mode, setMode] = useState<"promo" | "winback">("promo");

  const isLapsed = !isPremium && (entitlements.status === "expired" || entitlements.status === "cancelled");

  const showPromo = useCallback(() => {
    if (isPremium) return;
    if (isLapsed) {
      const until = Number(localStorage.getItem(WINBACK_DISMISS_KEY) || 0);
      if (Date.now() < until) return;
      setMode("winback");
    } else {
      const until = Number(localStorage.getItem(PROMO_DISMISS_KEY) || 0);
      if (Date.now() < until) return;
      setMode("promo");
      setPromoIndex(Math.floor(Math.random() * promos.length));
    }
    setShow(true);
  }, [isPremium, isLapsed]);

  useEffect(() => {
    if (isPremium) return;
    // Win-back fires sooner (45s) than standard promo (10 min)
    const delay = isLapsed ? 45 * 1000 : 10 * 60 * 1000;
    let cancelled = false;
    let retry: number | undefined;
    const timeout = window.setTimeout(() => {
      if (cancelled) return;
      if (consentNoticeVisible()) {
        // A consent or legal notice is up. Retry quietly every 30s rather than
        // stacking a sales card on top of it.
        retry = window.setInterval(() => {
          if (consentNoticeVisible()) return;
          window.clearInterval(retry);
          retry = undefined;
          if (!cancelled) showPromo();
        }, 30_000);
        return;
      }
      showPromo();
    }, delay);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      if (retry !== undefined) window.clearInterval(retry);
    };
  }, [showPromo, isPremium, isLapsed]);

  const dismiss = useCallback(() => {
    setShow(false);
    const key = mode === "winback" ? WINBACK_DISMISS_KEY : PROMO_DISMISS_KEY;
    const snooze = mode === "winback" ? 3 * 86400_000 : PROMO_SNOOZE_MS;
    localStorage.setItem(key, String(Date.now() + snooze));
  }, [mode]);

  // Escape closes it. The overlay is modal-ish (it dims the app) so keyboard
  // users must not be trapped in it.
  useEffect(() => {
    if (!show) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [show, dismiss]);

  if (!show || isPremium) return null;

  // Non-blocking by design: no overlay, no dimming, no full-screen tap
  // catcher. The card floats above the tab bar in a slot the app's content
  // already reserves (main's bottom padding) and the page underneath stays
  // usable the whole time. Dismiss paths: the X, the ghost button, Escape.
  const slideY = reducedMotion ? 0 : 24;

  if (mode === "winback") {
    return (
      <AnimatePresence>
        <motion.div
          key="winback-card"
          initial={{ opacity: 0, y: slideY }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: slideY }}
          transition={{ duration: reducedMotion ? 0.12 : 0.25, ease: "easeOut" }}
          role="dialog"
          aria-label="Comeback offer"
          className="fixed inset-x-4 bottom-[calc(var(--vaylo-inset-bottom)+5.5rem)] z-[44] mx-auto max-w-sm"
        >
          <div className="relative rounded-2xl border border-electric-purple/40 bg-card/95 p-4 shadow-electric backdrop-blur">
            <button
              type="button"
              onClick={dismiss}
              aria-label="Close"
              className="press absolute top-3 right-3 -m-3.5 p-3.5 text-muted-foreground hover:text-foreground transition-colors"
            >
              <X size={18} aria-hidden />
            </button>
            <div className="flex items-start gap-3 pr-7">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-electric-purple/30 bg-electric-purple/15">
                <Heart size={20} className="text-electric-purple" aria-hidden />
              </span>
              <div className="min-w-0">
                <h3 className="font-display font-bold text-base leading-tight">We miss you</h3>
                <p className="mt-0.5 text-xs text-muted-foreground leading-snug">
                  Your <span className="font-semibold capitalize text-foreground">{entitlements.plan_label}</span> plan ended. Resume it and keep your training moving.
                </p>
              </div>
            </div>
            <div className="mt-2.5 rounded-xl border border-electric-purple/30 bg-electric-purple/[0.07] px-3 py-2">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Comeback offer</p>
              <p className="text-xs text-muted-foreground">Credits added when you claim below.</p>
            </div>
            <div className="mt-3 flex gap-2">
              <motion.button onClick={async () => {
                if (!user || claimingWinback) return;
                setClaimingWinback(true);
                const result = await claimCreditReward("winback", { idempotencyKey: `winback:${user.id}` });
                setClaimingWinback(false);
                if (!result.success) { toast.error(result.error || "The comeback reward is unavailable right now."); return; }
                toast.success(result.granted > 0 ? `${result.granted} comeback credits added` : "Welcome back");
                setShow(false);
              }} disabled={!user || claimingWinback} whileTap={{ scale: 0.98 }}
                className="flex-1 bg-gradient-to-r from-electric-purple to-primary text-primary-foreground font-semibold py-2.5 rounded-xl text-sm">
                {claimingWinback ? "Applying…" : "Claim reward"}
              </motion.button>
              <button onClick={dismiss} className="rounded-xl py-2.5 text-sm text-muted-foreground">
                Maybe later
              </button>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    );
  }

  const promo = promos[promoIndex];

  return (
    <AnimatePresence>
      <motion.div
        key="promo-card"
        initial={{ opacity: 0, y: slideY }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: slideY }}
        transition={{ duration: reducedMotion ? 0.12 : 0.25, ease: "easeOut" }}
        role="dialog"
        aria-label={`${promo.title} — offer`}
        className="fixed inset-x-4 bottom-[calc(var(--vaylo-inset-bottom)+5.5rem)] z-[44] mx-auto max-w-sm"
      >
        <div className="relative rounded-2xl border border-border bg-card/95 p-4 shadow-lg backdrop-blur">
          <button
            type="button"
            onClick={dismiss}
            aria-label="Close"
            className="press absolute top-3 right-3 -m-3.5 p-3.5 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X size={18} aria-hidden />
          </button>
          <div className="flex items-start gap-3 pr-7">
            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${promo.bg}`}>
              <promo.icon size={20} className={promo.color} aria-hidden />
            </span>
            <div className="min-w-0">
              <h3 className="font-display font-bold text-base leading-tight">{promo.title}</h3>
              <p className="mt-0.5 text-xs text-muted-foreground leading-snug">{promo.desc}</p>
            </div>
          </div>
          <p className="mt-2.5 text-sm font-display font-bold text-primary">{promo.price}</p>
          <div className="mt-3 flex gap-2">
            <motion.button onClick={() => { setShow(false); navigate("/market"); }} whileTap={{ scale: 0.98 }}
              className="flex-1 bg-gradient-primary text-primary-foreground font-semibold py-2.5 rounded-xl text-sm">
              View in Market
            </motion.button>
            <button onClick={dismiss} className="rounded-xl py-2.5 text-sm text-muted-foreground">
              No thanks
            </button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

export default PromoPopup;
