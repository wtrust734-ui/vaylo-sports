import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { BadgePoundSterling, UserRound } from "lucide-react";
import HumanCoaches from "@/components/coach/HumanCoaches";
import CoachDirectory from "@/components/coach/CoachDirectory";
import CoachPlanCard from "@/components/coach/CoachPlanCard";
import ProductFacts from "./ProductFacts";
import { Button } from "@/components/ui/button";
import { COACH_COMMISSION_PERCENT, COACH_MIN_PLAN_CENTS, formatMinorUnits } from "@/config/coachMarketplace";
import { fetchActiveCoachPlans, openCoachSignup, type CoachPlan } from "@/lib/coachMarketplace";

/** Shown until the roster and the plans have both answered. */
const EMPTY_MESSAGE =
  "No coach has published a plan yet. Coach accounts are created on the Vaylo Sports website, and a coach publishes their plans from the app.";

/**
 * The Market's Coaching tab, and the whole coach marketplace in one screen.
 *
 * Two things sit here, and they are different products on purpose:
 *
 *   1. Plans. A coach sets a price, publishes what they will deliver, and is paid
 *      it — with the platform's fee added on top for the buyer rather than taken
 *      out of the coach. That is what the directory and the plan cards below are.
 *   2. Live sessions. A person books a 30- or 60-minute video session with a
 *      coach. These are free to request today while checkout is being built, and
 *      the component that handles them says so on every card.
 *
 * The commission is stated once, in the header, in the buyer's own terms: the
 * price a coach sets is what the coach receives, and {COACH_COMMISSION_PERCENT}%
 * is added to what the buyer pays. It is printed rather than implied, because a
 * marketplace that hides its cut is asking to be trusted about everything else it
 * says.
 */
export default function CoachingSection() {
  const [plans, setPlans] = useState<CoachPlan[]>([]);
  const [coachFilter, setCoachFilter] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    (async () => {
      const rows = await fetchActiveCoachPlans();
      if (!live) return;
      setPlans(rows);
      setLoading(false);
    })();
    return () => {
      live = false;
    };
  }, []);

  const shown = useMemo(
    () => (coachFilter ? plans.filter((p) => p.creator_id === coachFilter) : plans),
    [plans, coachFilter],
  );

  return (
    <div className="space-y-4 px-5">
      <div className="rounded-2xl border border-border bg-gradient-card p-4">
        <div className="flex items-center gap-2">
          <UserRound size={16} className="text-primary" />
          <h4 className="font-display text-sm font-bold">Human Coaching</h4>
        </div>
        <p className="mt-1 text-[12px] text-muted-foreground">
          Real coaches, their own prices. A coach sets what they want to be paid, you pay that price
          plus Vaylo's {COACH_COMMISSION_PERCENT}% fee, and the fee is on top rather than taken out of
          the coach. Both numbers are shown on every plan before you buy.
        </p>
        <p className="mt-2 text-[12px] text-muted-foreground">
          Live one-to-one video sessions are booked separately, per session — credits are never used
          here.
        </p>
        <ProductFacts
          receive="The plan the coach writes for you, delivered inside the app"
          expires="Depends on the plan — each one says how many weeks it covers"
          renews="Never renews. A plan is bought once, by you"
          lifetime="No — coaching is bought plan by plan or session by session"
          designedFor="Athletes who want human feedback alongside the AI coach"
        />
      </div>

      <CoachDirectory onSelect={setCoachFilter} selectedId={coachFilter || undefined} />

      <div>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            <BadgePoundSterling size={14} /> Plans for sale
          </h3>
          {coachFilter && (
            <button
              type="button"
              onClick={() => setCoachFilter("")}
              className="text-[12px] text-muted-foreground underline"
            >
              Show every coach
            </button>
          )}
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading plans…</p>
        ) : shown.length === 0 ? (
          <div className="rounded-2xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
            <p>{EMPTY_MESSAGE}</p>
            <div className="mt-4 flex flex-col justify-center gap-2 sm:flex-row">
              <Button variant="outline" onClick={() => void openCoachSignup()}>
                Create a coach account
              </Button>
              <Link to="/coach-studio">
                <Button variant="ghost">Open coach studio</Button>
              </Link>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {shown.map((plan) => (
              <CoachPlanCard key={plan.id} plan={plan} />
            ))}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-border bg-card p-4">
        <p className="text-[12px] text-muted-foreground">
          Are you a coach? You set your prices in the coach studio, and buyers pay them through the
          app.{" "}
          <Link to="/coach-studio" className="underline">
            Open coach studio
          </Link>
          {" · "}
          <button type="button" className="underline" onClick={() => void openCoachSignup()}>
            Create a coach account
          </button>
        </p>
        <p className="mt-2 text-[12px] text-muted-foreground">
          The lowest plan price is {formatMinorUnits(COACH_MIN_PLAN_CENTS, "GBP")}. Payment for a coach
          account is taken on the website; a plan bought from a coach inside the app is paid through
          Google Play.
        </p>
      </div>

      <HumanCoaches />
    </div>
  );
}
