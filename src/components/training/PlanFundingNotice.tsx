import { motion } from "framer-motion";
import { Zap } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { creditCost } from "@/lib/credits";
import { requestCreditTopUp } from "@/lib/topUpStore";
import { ageBand } from "@/lib/age";
import { formatNumber } from "@/i18n/format";

/** Below this many weeks of cover, the notice offers a top-up. */
const LOW_COVER_WEEKS = 4;

/**
 * The week-8 cliff, made visible in advance. A plan is paid for one week at a
 * time, so an athlete with an active plan should see how many more weeks their
 * balance will pay for before the next refusal arrives as a surprise.
 *
 * The per-week cost is the training_plan_week price from the shared config, the
 * same number the server charges, so the count cannot disagree with the bill.
 * Only the top-up button is adult-gated: showing the balance is information for
 * everyone, while a purchase prompt stays with adults like the other promotions.
 */
const PlanFundingNotice = () => {
  const { profile } = useAuth();
  const isAdult = ageBand(profile?.date_of_birth) === "adult";

  const balance = profile?.credits ?? 0;
  const weekCost = creditCost("training_plan_week");
  if (weekCost <= 0) return null;

  const weeksCovered = Math.floor(balance / weekCost);
  const lowCover = weeksCovered < LOW_COVER_WEEKS;
  const weekWord = weeksCovered === 1 ? "week" : "weeks";

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      role="status"
      className="mx-5 mb-5 rounded-2xl border border-border bg-card p-4"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-energy/15">
          <Zap size={15} className="text-energy" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            Your balance covers {weeksCovered} more {weekWord}
          </p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
            Each training week costs {formatNumber(weekCost)} credits and is paid when it is generated.
            You have {formatNumber(balance)} credits.
          </p>
        </div>
      </div>
      {lowCover && isAdult && (
        <button
          type="button"
          onClick={() =>
            void requestCreditTopUp({
              shortfall: Math.max(1, weekCost * LOW_COVER_WEEKS - balance),
              reasonLabel: "Training plan",
              balance,
            })
          }
          className="mt-3 w-full rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground"
        >
          Top up for {LOW_COVER_WEEKS} weeks of training
        </button>
      )}
    </motion.div>
  );
};

export default PlanFundingNotice;
