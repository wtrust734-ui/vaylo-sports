import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Crown, Brain, ScanLine, Star, Heart } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useSubscription } from "@/contexts/SubscriptionContext";

const promos = [
  { id: "pro", icon: Crown, title: "Unlock Pro", desc: "Unlimited credits, all features, priority support.", price: "$12.99/mo", color: "text-energy", bg: "bg-energy/10" },
  { id: "mental", icon: Brain, title: "Mental Gym", desc: "Breathing, visualization, cognitive tools.", price: "$4.99", color: "text-electric-purple", bg: "bg-electric-purple/10" },
  { id: "form", icon: ScanLine, title: "AI Form Analysis", desc: "Upload a photo, get expert technique feedback.", price: "$3.99", color: "text-primary", bg: "bg-primary/10" },
  { id: "coach", icon: Star, title: "Coach Pro", desc: "Advanced AI coaching personas.", price: "$2.99", color: "text-energy", bg: "bg-energy/10" },
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

const PromoPopup = () => {
  const { hasUnlimitedCredits, entitlements } = useSubscription();
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
    const timeout = setTimeout(showPromo, delay);
    return () => clearTimeout(timeout);
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

  if (mode === "winback") {
    return (
      <AnimatePresence>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={dismiss}
          className="fixed inset-0 z-[70] bg-black/75 backdrop-blur-sm flex items-center justify-center px-6">
          <motion.div initial={{ scale: 0.85, y: 30 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.85, y: 30 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-card border border-electric-purple/40 rounded-2xl p-6 max-w-sm w-full shadow-electric relative">
            <button
              type="button"
              onClick={dismiss}
              aria-label="Close"
              className="absolute top-4 right-4 -m-3.5 p-3.5 text-muted-foreground hover:text-foreground transition-colors"
            >
              <X size={18} aria-hidden />
            </button>
            <motion.div animate={{ scale: [1, 1.1, 1] }} transition={{ duration: 1.6, repeat: Infinity }}
              className="w-16 h-16 rounded-2xl bg-electric-purple/15 border border-electric-purple/30 flex items-center justify-center mx-auto mb-4">
              <Heart size={30} className="text-electric-purple" />
            </motion.div>
            <h3 className="font-display font-bold text-xl text-center mb-1">We miss you</h3>
            <p className="text-sm text-muted-foreground text-center mb-4">
              Your <span className="text-foreground font-semibold capitalize">{entitlements.plan_label}</span> plan ended.
              Come back and pick up right where you left off.
            </p>
            <div className="bg-gradient-to-r from-electric-purple/15 to-primary/15 border border-electric-purple/30 rounded-xl px-3 py-2.5 mb-4 text-center">
              <p className="text-[12px] uppercase tracking-wider text-muted-foreground">Limited-time code</p>
              <p className="text-lg font-display font-bold text-electric-purple tracking-widest">COMEBACK30</p>
              <p className="text-[12px] text-muted-foreground">30% off your first 3 months</p>
            </div>
            <motion.button onClick={() => { setShow(false); navigate("/subscription"); }} whileTap={{ scale: 0.98 }}
              className="w-full bg-gradient-to-r from-electric-purple to-primary text-primary-foreground font-semibold py-3 rounded-xl shadow-glow mb-2">
              Resume my plan
            </motion.button>
            <button onClick={dismiss} className="w-full text-sm text-muted-foreground text-center py-2">
              Maybe later
            </button>
          </motion.div>
        </motion.div>
      </AnimatePresence>
    );
  }

  const promo = promos[promoIndex];

  return (
    <AnimatePresence>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={dismiss}
        className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center px-6">
        <motion.div initial={{ scale: 0.85, y: 30 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.85, y: 30 }}
          onClick={(e) => e.stopPropagation()}
          className="bg-card border border-border rounded-2xl p-6 max-w-sm w-full shadow-electric relative">
          <button
            type="button"
            onClick={dismiss}
            aria-label="Close"
            className="absolute top-4 right-4 -m-3.5 p-3.5 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X size={18} aria-hidden />
          </button>
          <div className={`w-14 h-14 rounded-2xl ${promo.bg} flex items-center justify-center mx-auto mb-4`}>
            <promo.icon size={28} className={promo.color} />
          </div>
          <h3 className="font-display font-bold text-xl text-center mb-1">{promo.title}</h3>
          <p className="text-sm text-muted-foreground text-center mb-4">{promo.desc}</p>
          <p className="text-center font-display font-bold text-lg text-primary mb-4">{promo.price}</p>
          <motion.button onClick={() => { setShow(false); navigate("/market"); }} whileTap={{ scale: 0.98 }}
            className="w-full bg-gradient-primary text-primary-foreground font-semibold py-3 rounded-xl shadow-glow mb-2">
            View in Market
          </motion.button>
          <button onClick={dismiss} className="w-full text-sm text-muted-foreground text-center py-2">No thanks</button>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default PromoPopup;
