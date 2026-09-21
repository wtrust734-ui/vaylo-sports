import { motion } from "framer-motion";
import { Check, Repeat, Infinity as InfinityIcon, ArrowRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import ProductFacts from "./ProductFacts";
import {
  SUBSCRIPTION_PLANS,
  formatPence,
  PERIOD_LABEL,
  FAIR_USAGE_POLICY,
  type PlanDefinition,
} from "@/config/subscriptionPlans";

const META: Record<string, { icon: typeof Repeat; recommended?: boolean; designedFor: string; receive: string }> = {
  credit: {
    icon: Repeat,
    designedFor: "Regular athletes with a steady weekly routine",
    receive: "100 credits added at the start of every billing cycle",
  },
  unlimited: {
    icon: InfinityIcon,
    recommended: true,
    designedFor: "Daily users who want every AI feature without counting credits",
    receive: "Unlimited credits — nothing is ever deducted",
  },
};

/** Subscriptions only. Lifetime options for these plans live in the Lifetime section. */
export default function SubscriptionsSection() {
  const navigate = useNavigate();

  const renderPlan = (plan: PlanDefinition, i: number) => {
    const meta = META[plan.plan_key];
    const Icon = meta?.icon ?? Repeat;
    const recurring = plan.options.filter((o) => o.period !== "lifetime");

    return (
      <motion.div
        key={plan.plan_key}
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.04 + i * 0.06, type: "spring", stiffness: 200, damping: 24 }}
        className={`relative overflow-hidden rounded-3xl ${
          meta?.recommended
            ? "p-[1.5px] bg-gradient-to-br from-electric-purple via-primary to-energy shadow-glow"
            : "p-[1px] bg-border"
        }`}
      >
        {meta?.recommended && (
          <span className="absolute right-4 top-4 z-10 rounded-full bg-gradient-to-r from-electric-purple to-primary px-2.5 py-1 text-[9px] font-bold text-primary-foreground">
            RECOMMENDED
          </span>
        )}
        <div className="rounded-[22px] bg-card p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-electric-purple/25 to-primary/15">
              <Icon size={22} className="text-electric-purple" />
            </div>
            <div className="min-w-0">
              <h3 className="font-display text-lg font-bold">{plan.name}</h3>
              <p className="text-[11px] text-muted-foreground">{plan.tagline}</p>
            </div>
          </div>

          {/* Billing options */}
          <div className="mt-4 grid grid-cols-2 gap-2">
            {recurring.map((opt) => (
              <div
                key={opt.product_id}
                className={`rounded-2xl border p-3 text-center ${
                  opt.best_value ? "border-primary/50 bg-primary/5" : "border-border bg-muted/20"
                }`}
              >
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {PERIOD_LABEL[opt.period]}
                </p>
                <p className="font-display text-xl font-bold text-gradient-electric">{formatPence(opt.price_pence)}</p>
                <p className="text-[10px] text-muted-foreground">
                  {opt.period === "month" ? "billed monthly" : "billed yearly"}
                </p>
                {opt.best_value && <p className="mt-1 text-[9px] font-bold text-primary">BEST VALUE</p>}
              </div>
            ))}
          </div>

          {/* Benefits */}
          <ul className="mt-4 space-y-1.5">
            {plan.benefits.map((b) => (
              <li key={b} className="flex items-start gap-2 text-xs text-foreground/85">
                <Check size={12} className="mt-[3px] shrink-0 text-energy" />
                {b}
              </li>
            ))}
          </ul>

          <ProductFacts
            receive={meta?.receive ?? plan.tagline}
            expires="Access ends at the end of the paid period if you cancel"
            renews={`Renews automatically every ${plan.plan_key === "credit" ? "month or year" : "month or year"} until cancelled`}
            lifetime="A one-payment lifetime version is available in the Lifetime section"
            designedFor={meta?.designedFor ?? "All athletes"}
          />

          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={() => navigate("/subscription")}
            className={`mt-3 flex w-full items-center justify-center gap-2 rounded-2xl py-3 font-bold ${
              meta?.recommended
                ? "bg-gradient-primary text-primary-foreground shadow-glow"
                : "border border-border bg-muted/30 text-foreground"
            }`}
          >
            Choose {plan.name} <ArrowRight size={15} />
          </motion.button>
        </div>
      </motion.div>
    );
  };

  return (
    <div className="px-5 space-y-3">
      {/* Difference explainer */}
      <div className="rounded-2xl border border-border bg-gradient-card p-4">
        <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Which one is right?</h4>
        <div className="mt-2 space-y-1.5 text-[11px] leading-relaxed text-foreground/85">
          <p>
            <span className="font-semibold text-primary">Credit Plan</span> gives you a fixed 100 credits each cycle.
            You still spend credits per feature, and unused credits roll over up to your limit.
          </p>
          <p>
            <span className="font-semibold text-electric-purple">Unlimited Plan</span> removes credits entirely — no
            deductions, no counting, plus priority AI processing.
          </p>
        </div>
      </div>

      {SUBSCRIPTION_PLANS.map(renderPlan)}

      <p className="pt-1 text-[10px] leading-relaxed text-muted-foreground">
        Fair usage: {FAIR_USAGE_POLICY.message}
      </p>
    </div>
  );
}
