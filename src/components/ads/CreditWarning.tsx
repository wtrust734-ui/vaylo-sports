import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Zap, X, ShoppingBag, Sparkles } from "lucide-react";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { creditCost } from "@/lib/credits";
import { requestCreditTopUp } from "@/lib/topUpStore";
import { localDateKey } from "@/lib/dates";

const DISMISS_KEY = "vaylow_credit_warning_dismissed_date";

/**
 * Low-credit card — fires once per day, at most.
 *
 * Frequency discipline first: this used to re-arm every session whenever the
 * balance was low, so an athlete sitting at 3 credits saw the card on every
 * single open — the exact "nag" pattern that trains people to close a card
 * without reading it. It now dismisses for the local day (same contract
 * PromoPopup's 7-day snooze sets), and never while the Market — the screen
 * where the athlete is *already* shopping — is on top.
 *
 * Honesty rules it follows (this is the card athletes read when money is on
 * their mind):
 *  - No invented promo codes: the old "use code LOW15 for 15% off!" banner
 *    advertised a discount with no redemption mechanism anywhere in the app.
 *    A fake offer is the one thing guarantees a complaint worse than the
 *    warning it rode in on.
 *  - The CTA names a real, purchasable thing and its real shortfall
 *    ("Video Form Analysis", the video form analysis price). The top-up
 *    sheet plans the smallest pack that covers the gap — the athlete is
 *    never sold more than they need.
 *  - The dismissal is as easy to find as the action. No disguised close.
 */
const CreditWarning = () => {
  const { profile } = useAuth();
  const location = useLocation();
  const [show, setShow] = useState(false);

  const balance = profile?.credits || 0;

  useEffect(() => {
    if (!profile) return;
    if (balance > 5 || balance <= 0) return; // 0-balance handling stays on the top-up paths
    if (localStorage.getItem(DISMISS_KEY) === localDateKey()) return;
    if (location.pathname.startsWith("/market")) return;
    const timer = setTimeout(() => setShow(true), 3000);
    return () => clearTimeout(timer);
  }, [profile, balance, location.pathname]);

  if (!show) return null;

  // A named, real purchase goal — not "credits for the sake of credits".
  // The video form analysis is the prestige feature, and its price is real.
  const goalCost = creditCost("video_form_analysis");

  const dismiss = () => {
    setShow(false);
    localStorage.setItem(DISMISS_KEY, localDateKey());
  };

  return (
    <AnimatePresence>
      <motion.div
        role="status"
        aria-live="polite"
        initial={{ opacity: 0, y: 24, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 16, scale: 0.98 }}
        transition={{ type: "spring", stiffness: 260, damping: 26 }}
        className={`fixed bottom-[calc(var(--vaylo-inset-bottom)+7rem)] left-4 right-4 z-[60] bg-card/95 border rounded-2xl p-4 ${
          balance <= 3 ? "border-energy/30" : "border-border"
        }`}
      >
        <button
          type="button"
          onClick={dismiss}
          className="absolute top-3 right-3 min-h-11 min-w-11 flex items-center justify-center text-muted-foreground"
          aria-label="Dismiss"
        >
          <X size={16} />
        </button>
        <div className="flex items-center gap-3 mb-3">
          <div className="p-2 rounded-xl bg-energy/15 flex items-center justify-center">
            <Zap size={20} className="text-energy" />
          </div>
          <div className="min-w-0">
            <h4 className="font-display font-bold text-sm leading-snug">
              {balance === 1 ? "1 credit left" : `${balance} credits left`}
            </h4>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {balance <= 3
                ? "Tightish — you're still fine for a coach message, but not much more."
                : "Plenty for a quick check-in; keep the video analysis in mind."}
            </p>
          </div>
        </div>
        <motion.button
          onClick={() => {
            dismiss();
            void requestCreditTopUp({
              shortfall: Math.max(1, goalCost - balance),
              reasonLabel: "Video Form Analysis",
              balance,
            });
          }}
          whileTap={{ scale: 0.98 }}
          className="w-full flex items-center justify-center gap-2 bg-gradient-primary text-primary-foreground font-semibold py-2.5 rounded-xl text-sm"
        >
          <ShoppingBag size={16} /> Top up to unlock Video Form Analysis
        </motion.button>
        <button
          type="button"
          onClick={dismiss}
          className="mt-2 inline-flex items-center justify-center gap-1.5 w-full text-[12px] text-muted-foreground py-1.5"
        >
          <Sparkles size={12} /> Not today
        </button>
      </motion.div>
    </AnimatePresence>
  );
};

export default CreditWarning;
