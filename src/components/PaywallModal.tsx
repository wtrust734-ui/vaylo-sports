import { motion, AnimatePresence } from "framer-motion";
import { Zap, X, Coins, Repeat, Infinity as InfinityIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { create } from "zustand";
import { SUBSCRIPTION_PLANS, formatPence, PERIOD_LABEL } from "@/config/subscriptionPlans";

// PHASE 2: the paywall offers the two real plans (Credit / Unlimited) plus
// one-off credits. No tier names (Pro / Elite / Minimum / Premium) anywhere.
interface PaywallState {
  open: boolean;
  feature: string;
  show: (feature: string) => void;
  hide: () => void;
}

export const usePaywall = create<PaywallState>((set) => ({
  open: false,
  feature: "",
  show: (feature) => set({ open: true, feature }),
  hide: () => set({ open: false }),
}));

const ICONS = { credit: Repeat, unlimited: InfinityIcon } as const;

export default function PaywallModal() {
  const { open, feature, hide } = usePaywall();
  const navigate = useNavigate();

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[100] bg-background/80 backdrop-blur-md flex items-center justify-center p-4"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={hide}
        >
          <motion.div
            initial={{ scale: 0.9, y: 20, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
            className="relative max-w-md w-full bg-gradient-to-br from-card via-card to-electric-purple/20 border border-electric-purple/40 rounded-3xl p-8 shadow-2xl"
          >
            <button onClick={hide} className="absolute top-4 right-4 text-muted-foreground hover:text-foreground">
              <X className="h-5 w-5" />
            </button>
            <div className="flex justify-center mb-4">
              <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-electric-purple to-energy flex items-center justify-center">
                <Zap className="h-8 w-8 text-white" />
              </div>
            </div>
            <h2 className="text-2xl font-bold text-center mb-2">Unlock {feature}</h2>
            <p className="text-sm text-muted-foreground text-center mb-6">
              This feature is unlocked with credits. Choose how you want to get them.
            </p>
            <div className="space-y-2 mb-6">
              {SUBSCRIPTION_PLANS.map((plan) => {
                const Icon = ICONS[plan.plan_key as "credit" | "unlimited"];
                const monthly = plan.options.find((o) => o.period === "month")!;
                return (
                  <button
                    key={plan.plan_key}
                    onClick={() => { hide(); navigate("/subscription"); }}
                    className="w-full text-left flex items-start gap-3 rounded-2xl border border-border p-3 hover:bg-muted/40 transition-colors"
                  >
                    <Icon className="h-4 w-4 text-energy mt-0.5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">{plan.name}</p>
                      <p className="text-xs text-muted-foreground">{plan.tagline}</p>
                    </div>
                    <span className="text-xs font-semibold shrink-0">
                      {formatPence(monthly.price_pence)}
                      <span className="text-muted-foreground font-normal">/{PERIOD_LABEL.month.toLowerCase().slice(0, 2)}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            <Button
              onClick={() => { hide(); navigate("/market"); }}
              className="w-full h-12 bg-gradient-to-r from-electric-purple to-energy hover:opacity-90 text-white font-semibold"
            >
              <Coins className="h-4 w-4 mr-2" /> Open Market
            </Button>
            <button onClick={hide} className="w-full text-xs text-muted-foreground mt-3 hover:text-foreground">
              Maybe later
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
