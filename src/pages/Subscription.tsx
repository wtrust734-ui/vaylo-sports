import { motion } from "framer-motion";
import { Infinity as InfinityIcon, Coins, Check, ShieldAlert, Crown, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { useSubscription } from "@/contexts/SubscriptionContext";
import {
  SUBSCRIPTION_PLANS,
  PlanDefinition,
  PERIOD_LABEL,
  PERIOD_SUFFIX,
  formatPence,
  FAIR_USAGE_POLICY,
} from "@/config/subscriptionPlans";
import { useToast } from "@/hooks/use-toast";
import AccountSubscriptionCard from "@/components/subscription/AccountSubscriptionCard";

const PLAN_ICON = { credit: Coins, unlimited: InfinityIcon } as const;

function PlanCard({ plan, index }: { plan: PlanDefinition; index: number }) {
  const { entitlements, isActive } = useSubscription();
  const { toast } = useToast();
  const Icon = PLAN_ICON[plan.plan_key as "credit" | "unlimited"] ?? Coins;
  const isCurrent = isActive && entitlements.plan_key === plan.plan_key;

  return (
    <motion.section
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.08 }}
      className={`rounded-3xl border p-5 bg-card ${
        isCurrent ? "border-energy" : "border-border"
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="h-11 w-11 shrink-0 rounded-2xl bg-gradient-to-br from-electric-purple to-energy flex items-center justify-center">
          <Icon className="h-5 w-5 text-primary-foreground" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold">{plan.name}</h2>
            {isCurrent && (
              <span className="text-[10px] font-semibold uppercase tracking-wide bg-energy/15 text-energy px-2 py-0.5 rounded-full">
                Current
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground">{plan.tagline}</p>
        </div>
      </div>

      <ul className="mt-4 space-y-2">
        {plan.benefits.map((b) => (
          <li key={b} className="flex gap-2 text-sm">
            <Check className="h-4 w-4 text-energy shrink-0 mt-0.5" />
            <span className="text-muted-foreground">{b}</span>
          </li>
        ))}
      </ul>

      <div className="mt-5 grid gap-2">
        {plan.options.map((o) => (
          <button
            key={o.product_id}
            onClick={() =>
              toast({
                title: "Checkout coming soon",
                description: `${plan.name} · ${PERIOD_LABEL[o.period]} (${formatPence(o.price_pence)}) will be purchasable once billing is connected.`,
              })
            }
            className={`w-full text-start rounded-2xl border px-4 py-3 flex items-center justify-between transition-colors ${
              o.best_value
                ? "border-energy/60 bg-energy/5 hover:bg-energy/10"
                : "border-border hover:bg-muted/40"
            }`}
          >
            <span className="flex items-center gap-2">
              <span className="text-sm font-semibold">{PERIOD_LABEL[o.period]}</span>
              {o.best_value && (
                <span className="text-[10px] font-semibold uppercase tracking-wide bg-energy text-primary-foreground px-2 py-0.5 rounded-full">
                  Best value
                </span>
              )}
              {o.period === "lifetime" && (
                <Crown className="h-3.5 w-3.5 text-electric-purple" />
              )}
            </span>
            <span className="text-right">
              <span className="text-base font-bold block leading-tight">
                {formatPence(o.price_pence)}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {PERIOD_SUFFIX[o.period]}
              </span>
            </span>
          </button>
        ))}
      </div>

      {plan.fair_usage_daily_ai_calls !== null && (
        <p className="mt-3 text-[11px] text-muted-foreground flex gap-1.5">
          <ShieldAlert className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          Fair usage applies: up to {plan.fair_usage_daily_ai_calls} AI requests per day.
        </p>
      )}
      {plan.entitlements.monthly_credit_allowance > 0 && (
        <p className="mt-3 text-[11px] text-muted-foreground">
          Rollover limit: {plan.credit_rollover_limit} credits (configurable).
        </p>
      )}
    </motion.section>
  );
}

export default function Subscription() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background pb-28">
      <header className="px-5 pt-12 pb-6">
        <button
          onClick={() => navigate(-1)}
          className="mb-4 h-9 w-9 rounded-full border border-border flex items-center justify-center"
          aria-label="Go back"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="text-3xl font-bold">Plans</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Two simple plans. Credits for everything, or unlimited for everything.
        </p>
      </header>

      <div className="px-5">
        <AccountSubscriptionCard />
      </div>

      <div className="px-5 mt-5 grid gap-4 md:grid-cols-2 md:max-w-4xl md:mx-auto">
        {SUBSCRIPTION_PLANS.map((plan, i) => (
          <PlanCard key={plan.plan_key} plan={plan} index={i} />
        ))}
      </div>

      <div className="px-5 mt-6 max-w-md mx-auto">
        <Button variant="outline" onClick={() => navigate("/market")} className="w-full h-11">
          Or buy one-off credits
        </Button>
        <p className="text-center text-[11px] text-muted-foreground mt-4">
          {FAIR_USAGE_POLICY.message}
        </p>
      </div>
    </div>
  );
}
