import { motion } from "framer-motion";
import { Crown, Infinity as InfinityIcon, Ticket, ArrowRight, Check } from "lucide-react";
import { useNavigate } from "react-router-dom";
import ProductFacts from "./ProductFacts";
import { SUBSCRIPTION_PLANS, formatPence } from "@/config/subscriptionPlans";

/**
 * Permanent purchases only: lifetime versions of the two plans plus Event Packs.
 * Event Pack contents are untouched — this only links to the existing tab.
 */
export default function LifetimeSection() {
  const navigate = useNavigate();

  const lifetimePlans = SUBSCRIPTION_PLANS.map((plan) => ({
    plan,
    option: plan.options.find((o) => o.period === "lifetime"),
  })).filter((x) => !!x.option);

  return (
    <div className="px-5 space-y-3">
      <div className="rounded-2xl border border-electric-purple/30 bg-gradient-to-r from-electric-purple/10 to-primary/10 p-4">
        <div className="flex items-center gap-2">
          <Crown size={16} className="text-electric-purple" />
          <h4 className="font-display text-sm font-bold">Lifetime Access</h4>
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">One payment. No renewal. Never billed again.</p>
      </div>

      {lifetimePlans.map(({ plan, option }, i) => (
        <motion.div
          key={plan.plan_key}
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.04 + i * 0.06, type: "spring", stiffness: 200, damping: 24 }}
          className={`overflow-hidden rounded-3xl ${
            plan.plan_key === "unlimited"
              ? "p-[1.5px] bg-gradient-to-br from-electric-purple via-primary to-energy shadow-glow"
              : "p-[1px] bg-border"
          }`}
        >
          <div className="rounded-[22px] bg-card p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-display text-lg font-bold">Lifetime {plan.name}</h3>
                <p className="text-[11px] text-muted-foreground">{plan.tagline}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-display text-2xl font-bold text-gradient-electric">
                  {formatPence(option!.price_pence)}
                </p>
                <p className="text-[10px] text-muted-foreground">one payment</p>
              </div>
            </div>

            <ul className="mt-3 space-y-1.5">
              {plan.benefits.slice(0, 3).map((b) => (
                <li key={b} className="flex items-start gap-2 text-xs text-foreground/85">
                  <Check size={12} className="mt-[3px] shrink-0 text-energy" />
                  {b}
                </li>
              ))}
            </ul>

            <ProductFacts
              receive={
                plan.plan_key === "unlimited"
                  ? "Unlimited credits across every feature, forever"
                  : "100 credits added every month, forever"
              }
              expires="Never expires"
              renews="Never renews — you are never billed again"
              lifetime="Yes — permanent lifetime access"
              designedFor={
                plan.plan_key === "unlimited"
                  ? "Committed athletes who want everything unlocked permanently"
                  : "Long-term athletes who want a permanent monthly credit supply"
              }
            />

            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={() => navigate("/subscription")}
              className={`mt-3 flex w-full items-center justify-center gap-2 rounded-2xl py-3 font-bold ${
                plan.plan_key === "unlimited"
                  ? "bg-gradient-primary text-primary-foreground shadow-glow"
                  : "border border-border bg-muted/30 text-foreground"
              }`}
            >
              <InfinityIcon size={15} /> Get lifetime access <ArrowRight size={15} />
            </motion.button>
          </div>
        </motion.div>
      ))}

      {/* Event Packs — contents unchanged, opens the existing tab */}
      <motion.button
        whileTap={{ scale: 0.98 }}
        onClick={() => navigate("/event-packs")}
        className="w-full rounded-3xl border border-border bg-card p-5 text-start"
      >
        <div className="flex items-start gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-energy/25 to-primary/15">
            <Ticket size={22} className="text-energy" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-display text-base font-bold">Event Packs</h3>
            <p className="text-[11px] text-muted-foreground">
              Race and competition preparation packs for your sport. Buy once, keep forever.
            </p>
          </div>
          <ArrowRight size={16} className="mt-1 shrink-0 text-muted-foreground" />
        </div>
        <ProductFacts
          receive="Full event preparation pack for the event you choose"
          expires="Never expires"
          renews="One-off purchase — nothing renews"
          lifetime="Yes — permanent access to every pack you buy"
          designedFor="Athletes preparing for a specific race, match or competition (18+)"
        />
        <span className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-border bg-muted/30 py-3 text-sm font-bold">
          Browse Event Packs <ArrowRight size={15} />
        </span>
      </motion.button>
    </div>
  );
}
