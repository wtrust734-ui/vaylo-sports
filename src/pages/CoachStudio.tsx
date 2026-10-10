// ============================================================================
// COACH STUDIO — the coach's own side of the marketplace
// ----------------------------------------------------------------------------
// Where a coach sets their prices, publishes a plan, sees what they are owed and
// writes the plan a buyer paid for. Reached only from the Coach marketplace,
// which is behind the `coachMarketplace` flag (off), and the route redirects to
// the Market when the flag is off — so this page cannot be opened by accident on
// a build that has not switched the marketplace on.
//
// Three things this screen refuses to do, and each is a sentence a coach reads
// rather than a rule buried in code:
//
//   * It never shows a single "earnings" number. What has accrued and what has
//     been transferred are different things, and until a payout rail is connected
//     the second one is zero. A coach who reads "£120 earned" and then finds £0
//     in their bank has been misled by a screen, which is the worst way to learn
//     how the payout system works.
//   * It never quotes the buyer's price from local arithmetic as though it were
//     final. A coach typing a price sees the split immediately (that is a
//     preview), and the plan is sold at the number the database computes.
//   * It does not promise payouts. `creator_profiles.payout_email` has been
//     stored without ever moving money since the economy migration, and that
//     stays true until Stripe Connect is connected deliberately.
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { ArrowLeft, BadgePoundSterling, PoundSterling, Send, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { formatDate } from "@/i18n/format";
import {
  COACH_COMMISSION_PERCENT,
  COACH_MIN_PLAN_CENTS,
  COACH_SIGNUP_FEE_CENTS,
  COACH_SIGNUP_FEE_CURRENCY,
  coachPlanError,
  formatMinorUnits,
  quoteCoachPrice,
} from "@/config/coachMarketplace";
import {
  deliverPlan,
  fetchCoachEarnings,
  fetchCoachOrders,
  fetchCoachPlans,
  fetchMyCoachStatus,
  fetchUndeliveredOrders,
  openCoachSignup,
  publishCoachPlan,
  setPlanActive,
  type CoachOrder,
  type CoachPlan,
  type MyCoachStatus,
} from "@/lib/coachMarketplace";

/** The coach's own asking price, in whole pence, from pounds typed in a field. */
const poundsToPence = (value: string): number => {
  const cleaned = value.replace(/[^0-9.]/g, "");
  if (!cleaned) return Number.NaN;
  const pounds = Number.parseFloat(cleaned);
  if (!Number.isFinite(pounds)) return Number.NaN;
  return Math.round(pounds * 100);
};

function SplitPreview({ netCents }: { netCents: number }) {
  const invalid = coachPlanError(netCents);
  if (invalid) {
    return <p className="text-[12px] text-muted-foreground">{invalid}</p>;
  }
  const quote = quoteCoachPrice(netCents);
  return (
    <div className="rounded-2xl border border-border bg-muted/20 p-3 text-[12px]">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">You receive</span>
        <span className="font-semibold">{formatMinorUnits(quote.netCents, "GBP")}</span>
      </div>
      <div className="mt-1 flex items-center justify-between">
        <span className="text-muted-foreground">Buyer pays</span>
        <span className="font-semibold">{formatMinorUnits(quote.grossCents, "GBP")}</span>
      </div>
      <div className="mt-1 flex items-center justify-between">
        <span className="text-muted-foreground">Vaylo's fee ({COACH_COMMISSION_PERCENT}%)</span>
        <span>{formatMinorUnits(quote.feeCents, "GBP")}</span>
      </div>
      <p className="mt-2 text-muted-foreground">
        You are paid the price you set. The fee is added on top and paid by the buyer — it is never
        taken out of your price.
      </p>
    </div>
  );
}

export default function CoachStudio() {
  const { user, profile } = useAuth();
  const [status, setStatus] = useState<MyCoachStatus | null>(null);
  const [plans, setPlans] = useState<CoachPlan[]>([]);
  const [orders, setOrders] = useState<CoachOrder[]>([]);
  const [undelivered, setUndelivered] = useState<CoachOrder[]>([]);
  const [earnings, setEarnings] = useState({ accrued_cents: 0, paid_cents: 0, currency: "GBP" });
  const [loading, setLoading] = useState(true);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [weeks, setWeeks] = useState("4");
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);

  const [draftFor, setDraftFor] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftBody, setDraftBody] = useState("");

  const netCents = useMemo(() => poundsToPence(price), [price]);

  // Reading the studio is one round of parallel queries, and it is re-run after
  // every publish, sale and delivery — so it is a useCallback keyed on the signed-in
  // athlete rather than a body inline in an effect with a suppressed dependency
  // array.
  const load = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    const myStatus = await fetchMyCoachStatus(user.id);
    setStatus(myStatus);
    if (myStatus.isCoach) {
      const [myPlans, myOrders, todo, money] = await Promise.all([
        fetchCoachPlans(user.id),
        fetchCoachOrders(user.id),
        fetchUndeliveredOrders(user.id),
        fetchCoachEarnings(user.id),
      ]);
      setPlans(myPlans);
      setOrders(myOrders);
      setUndelivered(todo);
      setEarnings(money);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const publish = async () => {
    if (!user || busy) return;
    const problem = coachPlanError(netCents);
    if (problem) {
      toast.error(problem);
      return;
    }
    if (title.trim().length < 3) {
      toast.error("Give the plan a title a buyer would understand.");
      return;
    }
    const weeksNumber = Number.parseInt(weeks, 10);
    if (!Number.isInteger(weeksNumber) || weeksNumber < 1 || weeksNumber > 104) {
      toast.error("How many weeks does this plan cover? Between 1 and 104.");
      return;
    }

    setBusy(true);
    const result = await publishCoachPlan({
      creatorId: user.id,
      title,
      description,
      weeks: weeksNumber,
      netCents,
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error ?? "The plan could not be published.");
      return;
    }
    toast.success(`Published — you receive ${formatMinorUnits(netCents, "GBP")} per buyer.`);
    setTitle("");
    setDescription("");
    setPrice("");
    void load();
  };

  const toggle = async (plan: CoachPlan) => {
    const result = await setPlanActive(plan.id, !plan.active);
    if (!result.ok) {
      toast.error(result.error ?? "That could not be changed.");
      return;
    }
    setPlans((prev) => prev.map((p) => (p.id === plan.id ? { ...p, active: !p.active } : p)));
  };

  const send = async (order: CoachOrder) => {
    if (!user) return;
    if (draftTitle.trim().length < 3 || draftBody.trim().length < 20) {
      toast.error("A delivery needs a title and the plan itself — a few sentences at least.");
      return;
    }
    const result = await deliverPlan({
      order,
      coachId: user.id,
      title: draftTitle,
      body: draftBody,
    });
    if (!result.ok) {
      toast.error(result.error ?? "The plan could not be sent.");
      return;
    }
    toast.success("Sent — the athlete can read it in their app now.");
    setDraftFor(null);
    setDraftTitle("");
    setDraftBody("");
    void load();
  };

  if (!user) {
    return (
      <div className="mx-auto max-w-3xl px-5 pt-[var(--vaylo-screen-top)] pb-24">
        <p className="text-sm text-muted-foreground">Sign in to open your coach studio.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-5 pt-[var(--vaylo-screen-top)] pb-24">
      <Link to="/market" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to the Market
      </Link>

      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold">Coach studio</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Set your prices, publish plans, and send what a buyer paid for.
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !status?.isCoach ? (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          <div className="rounded-2xl border border-border bg-card p-5">
            <h2 className="font-display font-bold">You are not a coach account yet</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              A coach account is created on the Vaylo Sports website, and costs a one-off{" "}
              {formatMinorUnits(COACH_SIGNUP_FEE_CENTS, COACH_SIGNUP_FEE_CURRENCY)} fee. The fee buys
              the account itself: after that you set your own prices and are paid what you ask for.
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Payment is taken on the website through Stripe, and the app is where you publish and
              deliver. Nothing is charged inside the app for a coach account.
            </p>

            {status?.application && (
              <div className="mt-4 rounded-2xl border border-border bg-muted/20 p-3 text-[12px] text-muted-foreground">
                {status.application.status === "pending_payment" && (
                  <>A payment was started and has not been completed yet — nothing has been charged.</>
                )}
                {status.application.status === "rejected" && (
                  <>That checkout expired without being paid, so nothing was charged. Start again below.</>
                )}
                {status.application.status === "refunded" && (
                  <>
                    That fee was refunded. Your coach account is on hold until a new payment is made
                    — a person will look at this if you get in touch.
                  </>
                )}
                {status.application.status === "paid" && (
                  <>Your payment is recorded as paid. This screen should already show your studio; if it does not, reload.</>
                )}
              </div>
            )}

            <Button className="mt-4 w-full" onClick={() => void openCoachSignup()}>
              Create a coach account
            </Button>
            <p className="mt-2 text-center text-[12px] text-muted-foreground">
              Opens the Vaylo Sports website in your browser.
            </p>
          </div>
        </motion.div>
      ) : (
        <div className="space-y-6">
          {/* ------------------------------------------------------- money -- */}
          <div className="rounded-2xl border border-border bg-gradient-card p-5">
            <h2 className="flex items-center gap-2 font-display text-sm font-bold">
              <Wallet size={16} className="text-primary" /> What you are owed
            </h2>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-border bg-card p-3">
                <p className="text-[12px] uppercase tracking-wider text-muted-foreground">Accrued</p>
                <p className="font-display text-xl font-bold">
                  {formatMinorUnits(earnings.accrued_cents, earnings.currency)}
                </p>
                <p className="text-[12px] text-muted-foreground">paid by buyers, not yet sent to you</p>
              </div>
              <div className="rounded-2xl border border-border bg-card p-3">
                <p className="text-[12px] uppercase tracking-wider text-muted-foreground">Paid out</p>
                <p className="font-display text-xl font-bold">
                  {formatMinorUnits(earnings.paid_cents, earnings.currency)}
                </p>
                <p className="text-[12px] text-muted-foreground">transferred to you so far</p>
              </div>
            </div>
            <p className="mt-3 text-[12px] text-muted-foreground">
              Payouts are not connected yet, so nothing has been transferred and the second number is
              zero. Everything you sell is recorded above — nothing is lost, and the balance is what
              will be paid when payouts are switched on. Your payout email is stored on your creator
              profile.
            </p>
          </div>

          {/* --------------------------------------------------- new plan -- */}
          <div className="rounded-2xl border border-border bg-card p-5">
            <h2 className="flex items-center gap-2 font-display text-sm font-bold">
              <PoundSterling size={16} className="text-primary" /> Publish a plan
            </h2>
            <p className="mt-1 text-[12px] text-muted-foreground">
              This is your price — what you want to be paid. Buyers pay this plus the platform fee.
            </p>

            <div className="mt-4 space-y-3">
              <Input
                placeholder="Title — e.g. Personalised 4-week return-to-running plan"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="h-12"
              />
              <Textarea
                placeholder="What the athlete gets, what you need from them, how you will be in touch."
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[12px] text-muted-foreground" htmlFor="plan-weeks">
                    Weeks covered
                  </label>
                  <Input
                    id="plan-weeks"
                    inputMode="numeric"
                    value={weeks}
                    onChange={(e) => setWeeks(e.target.value)}
                    className="mt-1 h-11"
                  />
                </div>
                <div>
                  <label className="text-[12px] text-muted-foreground" htmlFor="plan-price">
                    Your price (GBP)
                  </label>
                  <Input
                    id="plan-price"
                    inputMode="decimal"
                    placeholder={
                      coachPlanError(COACH_MIN_PLAN_CENTS) === null
                        ? formatMinorUnits(COACH_MIN_PLAN_CENTS, "GBP")
                        : "1.00"
                    }
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    className="mt-1 h-11"
                  />
                </div>
              </div>

              <SplitPreview netCents={netCents} />

              <Button className="w-full h-12" disabled={busy} onClick={() => void publish()}>
                {busy ? "Publishing…" : "Publish this plan"}
              </Button>
            </div>
          </div>

          {/* ----------------------------------------------------- plans -- */}
          <div className="rounded-2xl border border-border bg-card p-5">
            <h2 className="flex items-center gap-2 font-display text-sm font-bold">
              <BadgePoundSterling size={16} className="text-primary" /> Your plans
            </h2>
            {plans.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                Nothing published yet. You will appear on the coaches list as soon as you have a plan
                on sale.
              </p>
            ) : (
              <div className="mt-3 space-y-2">
                {plans.map((plan) => (
                  <div
                    key={plan.id}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-border p-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{plan.title}</p>
                      <p className="text-[12px] text-muted-foreground">
                        {formatMinorUnits(plan.price_cents, plan.currency)} ·{" "}
                        {plan.weeks ? `${plan.weeks} weeks` : "no duration"} · {plan.sales_count} sold
                      </p>
                    </div>
                    <Button size="sm" variant={plan.active ? "outline" : "default"} onClick={() => void toggle(plan)}>
                      {plan.active ? "Take off sale" : "Put on sale"}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ---------------------------------------------------- orders -- */}
          <div className="rounded-2xl border border-border bg-card p-5">
            <h2 className="flex items-center gap-2 font-display text-sm font-bold">
              <Send size={16} className="text-primary" /> To deliver
            </h2>
            {orders.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">No sales yet.</p>
            ) : undelivered.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                Every paid order has been delivered. Thank you.
              </p>
            ) : (
              <div className="mt-3 space-y-3">
                {undelivered.map((order) => (
                  <div key={order.id} className="rounded-2xl border border-border p-3">
                    <p className="text-sm font-semibold">
                      {formatMinorUnits(order.net_cents, order.currency)} to you · buyer pays{" "}
                      {formatMinorUnits(order.gross_cents, order.currency)}
                    </p>
                    <p className="text-[12px] text-muted-foreground">
                      Bought {formatDate(order.created_at)}
                    </p>

                    {draftFor === order.id ? (
                      <div className="mt-3 space-y-2">
                        <Input
                          placeholder="Title of the plan you are sending"
                          value={draftTitle}
                          onChange={(e) => setDraftTitle(e.target.value)}
                          className="h-11"
                        />
                        <Textarea
                          placeholder="The plan itself — sessions, targets, what to do this week."
                          rows={6}
                          value={draftBody}
                          onChange={(e) => setDraftBody(e.target.value)}
                        />
                        <div className="flex gap-2">
                          <Button size="sm" onClick={() => void send(order)}>
                            Send to the athlete
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setDraftFor(null)}>
                            Cancel
                          </Button>
                        </div>
                        <p className="text-[12px] text-muted-foreground">
                          It is delivered inside the app, to this order's buyer only. Nobody else can
                          read it.
                        </p>
                      </div>
                    ) : (
                      <Button size="sm" className="mt-2" onClick={() => setDraftFor(order.id)}>
                        Write the plan
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
