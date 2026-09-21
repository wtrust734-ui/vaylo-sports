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

const PromoPopup = () => {
  const { hasUnlimitedCredits, entitlements } = useSubscription();
  const isPremium = hasUnlimitedCredits;
  const navigate = useNavigate();
  const [show, setShow] = useState(false);
  const [canClose, setCanClose] = useState(false);
  const [countdown, setCountdown] = useState(5);
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
      setMode("promo");
      setPromoIndex(Math.floor(Math.random() * promos.length));
    }
    setShow(true);
    setCanClose(false);
    setCountdown(5);
  }, [isPremium, isLapsed]);

  useEffect(() => {
    if (isPremium) return;
    // Win-back fires sooner (45s) than standard promo (10 min)
    const delay = isLapsed ? 45 * 1000 : 10 * 60 * 1000;
    const timeout = setTimeout(showPromo, delay);
    return () => clearTimeout(timeout);
  }, [showPromo, isPremium, isLapsed]);

  useEffect(() => {
    if (!show || canClose) return;
    const timer = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) { setCanClose(true); clearInterval(timer); return 0; }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [show, canClose]);

  if (!show || isPremium) return null;

  const dismissWinback = () => {
    setShow(false);
    // Snooze win-back for 3 days
    localStorage.setItem(WINBACK_DISMISS_KEY, String(Date.now() + 3 * 86400_000));
  };

  if (mode === "winback") {
    return (
      <AnimatePresence>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-[70] bg-black/75 backdrop-blur-sm flex items-center justify-center px-6">
          <motion.div initial={{ scale: 0.85, y: 30 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.85, y: 30 }}
            className="bg-card border border-electric-purple/40 rounded-2xl p-6 max-w-sm w-full shadow-electric relative">
            {canClose ? (
              <button onClick={dismissWinback} className="absolute top-4 right-4 text-muted-foreground"><X size={18} /></button>
            ) : (
              <span className="absolute top-4 right-4 text-xs text-muted-foreground">{countdown}s</span>
            )}
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
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Limited-time code</p>
              <p className="text-lg font-display font-bold text-electric-purple tracking-widest">COMEBACK30</p>
              <p className="text-[11px] text-muted-foreground">30% off your first 3 months</p>
            </div>
            <motion.button onClick={() => { setShow(false); navigate("/subscription"); }} whileTap={{ scale: 0.98 }}
              className="w-full bg-gradient-to-r from-electric-purple to-primary text-primary-foreground font-semibold py-3 rounded-xl shadow-glow mb-2">
              Resume my plan
            </motion.button>
            {canClose && (
              <button onClick={dismissWinback} className="w-full text-sm text-muted-foreground text-center py-2">
                Maybe later
              </button>
            )}
          </motion.div>
        </motion.div>
      </AnimatePresence>
    );
  }

  const promo = promos[promoIndex];

  return (
    <AnimatePresence>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center px-6">
        <motion.div initial={{ scale: 0.85, y: 30 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.85, y: 30 }}
          className="bg-card border border-border rounded-2xl p-6 max-w-sm w-full shadow-electric relative">
          {canClose ? (
            <button onClick={() => setShow(false)} className="absolute top-4 right-4 text-muted-foreground"><X size={18} /></button>
          ) : (
            <span className="absolute top-4 right-4 text-xs text-muted-foreground">{countdown}s</span>
          )}
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
          {canClose && (
            <button onClick={() => setShow(false)} className="w-full text-sm text-muted-foreground text-center py-2">No thanks</button>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default PromoPopup;
