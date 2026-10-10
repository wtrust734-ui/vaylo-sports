import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Zap, X, ShoppingBag } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { creditCost } from "@/lib/credits";
import { requestCreditTopUp } from "@/lib/topUpStore";

const CreditWarning = () => {
  const { profile } = useAuth();
  const [show, setShow] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (dismissed || !profile) return;
    if ((profile.credits || 0) <= 5 && (profile.credits || 0) > 0) {
      const timer = setTimeout(() => setShow(true), 3000);
      return () => clearTimeout(timer);
    }
  }, [profile?.credits, dismissed]);

  if (!show) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 50, scale: 0.9 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 50, scale: 0.9 }}
        // Lifted clear of the floating tab bar. `bottom-20` (80px) put this
        // card inside the bar's own band — the bar's card spans 34–99px above
        // the floor and the action button pokes to 107px — so at z-60 this
        // promo was painted straight over the tab bar and stole its taps.
        // Matches QuickActionSheet and the Coach composer.
        className="fixed bottom-[calc(var(--vaylo-inset-bottom)+5.25rem)] left-4 right-4 z-[60] bg-gradient-card border border-energy/30 rounded-2xl p-4 shadow-electric"
      >
        {/* Named, and 44px: it was a 16px glyph with no label, so the only
            control that dismisses this card was invisible to a screen reader
            and hard to hit on a phone. */}
        <button
          type="button"
          aria-label="Dismiss low-credit warning"
          onClick={() => { setShow(false); setDismissed(true); }}
          className="absolute end-2 top-2 flex h-11 w-11 items-center justify-center rounded-xl text-muted-foreground active:opacity-70"
        >
          <X size={16} aria-hidden />
        </button>
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 rounded-full bg-energy/20"><Zap size={20} className="text-energy" /></div>
          <div>
            <h4 className="font-display font-bold text-sm">Low on Credits!</h4>
            <p className="text-xs text-muted-foreground">Only {profile?.credits || 0} credits left</p>
          </div>
        </div>
        <div className="bg-energy/10 border border-energy/20 rounded-lg px-3 py-1.5 mb-3">
          <p className="text-xs font-semibold text-energy text-center">🎁 Use code LOW15 for 15% off!</p>
        </div>
        <motion.button
          onClick={() => {
            setShow(false); setDismissed(true);
            // Sell a concrete goal, not a currency: the shortfall to afford the
            // cheapest premium unlock (e.g. Form Analysis) opens the top-up
            // sheet with the pack that covers it.
            const balance = profile?.credits ?? 0;
            const goal = creditCost("form_analysis_unlock");
            void requestCreditTopUp({ shortfall: Math.max(1, goal - balance), reasonLabel: "Form Analysis" });
          }}
          whileTap={{ scale: 0.98 }}
          className="w-full flex items-center justify-center gap-2 bg-gradient-primary text-primary-foreground font-semibold py-2.5 rounded-xl shadow-glow text-sm"
        >
          <ShoppingBag size={16} /> Top up & unlock Form Analysis
        </motion.button>
      </motion.div>
    </AnimatePresence>
  );
};

export default CreditWarning;
