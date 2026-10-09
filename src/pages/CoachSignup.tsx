// ============================================================================
// COACH SIGNUP — "Create a coach account", and the one payment Stripe takes
// ----------------------------------------------------------------------------
// The page the website's coach page links to, and the only place the $20 coach
// fee is started. Three rules are baked into it, and each one exists because the
// alternative is either a rules problem or a lie to a customer:
//
//   1. The payment is CARD, ON THE WEB, through Stripe. It is never started from
//      inside the Android app. A coach membership bought in the Android shell
//      would be a digital purchase that Google's rules say must go through Play
//      Billing — and Play cannot price a membership against a Stripe account.
//      Inside the app this page therefore says where to do it and opens the
//      website, rather than opening a payment sheet.
//
//   2. The redirect to Stripe comes from the SERVER. This page asks
//      `coach-signup` for a URL and follows it; it never builds a checkout URL,
//      so there is no query parameter here that could be turned into an open
//      redirect that collects a paying coach.
//
//   3. Nothing here decides that anybody is a coach. The page says "payment
//      received, we are confirming it" and re-reads the account; only the
//      signature-verified webhook flips `is_coach`. A paid coach waiting for a
//      webhook is a normal few seconds, and the screen tells them so instead of
//      showing an empty state.
// ============================================================================

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { BadgeCheck, Loader2, PoundSterling, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { readPurchaseError } from "@/lib/billing";
import { isNative } from "@/lib/platform";
import {
  COACH_COMMISSION_PERCENT,
  COACH_SIGNUP_FEE_CENTS,
  COACH_SIGNUP_FEE_CURRENCY,
  formatMinorUnits,
} from "@/config/coachMarketplace";
import { fetchMyCoachStatus, openCoachSignup, type MyCoachStatus } from "@/lib/coachMarketplace";

type Phase = "checking" | "not_signed_in" | "not_a_coach" | "starting" | "confirming" | "already_a_coach";

export default function CoachSignup() {
  const { user } = useAuth();
  const [phase, setPhase] = useState<Phase>("checking");
  const [status, setStatus] = useState<MyCoachStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [polls, setPolls] = useState(0);

  // Stripe sends the coach back with ?status=paid or ?status=cancelled.
  const returned = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("status");

  const check = useCallback(async () => {
    if (!user) {
      setPhase("not_signed_in");
      return;
    }
    const my = await fetchMyCoachStatus(user.id);
    setStatus(my);
    setPhase(my.isCoach ? "already_a_coach" : returned === "paid" ? "confirming" : "not_a_coach");
  }, [user, returned]);

  useEffect(() => {
    void check();
  }, [check]);

  /**
   * A paid coach waits for the webhook, and the webhook usually wins in under a
   * second. Polling a handful of times means the common case resolves on the page
   * rather than asking somebody who has just paid $20 to reload and hope.
   */
  useEffect(() => {
    if (phase !== "confirming" || polls >= 8) return;
    const timer = setTimeout(async () => {
      setPolls((n) => n + 1);
      const my = user ? await fetchMyCoachStatus(user.id) : null;
      if (my) {
        setStatus(my);
        if (my.isCoach) setPhase("already_a_coach");
      }
    }, 2000);
    return () => clearTimeout(timer);
  }, [phase, polls, user]);

  const startCheckout = async () => {
    setError(null);
    setPhase("starting");

    const { data, error: invokeError } = await supabase.functions.invoke("coach-signup", {
      body: { display_name: null, email: user?.email ?? null },
    });

    if (invokeError) {
      const { message, detail } = await readPurchaseError(invokeError, "The payment page could not be opened.");
      const code = typeof detail.code === "string" ? detail.code : undefined;
      if (code === "already_a_coach") {
        setPhase("already_a_coach");
        return;
      }
      setError(message);
      setPhase("not_a_coach");
      return;
    }

    const url = (data as { url?: string } | null)?.url;
    if (!url) {
      setError("The payment page could not be opened. Nothing has been charged.");
      setPhase("not_a_coach");
      return;
    }

    // Away to Stripe. This is a full navigation on purpose: an SPA route change
    // would leave the app running behind a page it does not control.
    window.location.assign(url);
  };

  const native = isNative();
  const fee = formatMinorUnits(COACH_SIGNUP_FEE_CENTS, COACH_SIGNUP_FEE_CURRENCY);

  return (
    <div className="mx-auto max-w-2xl px-5 pt-[var(--vaylo-screen-top)] pb-24">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-electric-purple to-energy">
          <PoundSterling className="h-7 w-7 text-white" />
        </div>
        <h1 className="font-display text-2xl font-bold">Create a coach account</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          One fee, once. After that you set your own prices and keep what you ask for.
        </p>

        <div className="mt-6 space-y-2 rounded-2xl border border-border bg-card p-4 text-sm">
          {[
            `${fee} one-off, paid by card. Not a subscription, and never renews.`,
            `You set the price. Buyers pay it plus Vaylo's ${COACH_COMMISSION_PERCENT}% fee — the fee is added on top, so you receive exactly what you asked for.`,
            "You publish your plans and deliver them inside the app.",
            "Your earnings are recorded against your account as you sell.",
          ].map((line) => (
            <div key={line} className="flex items-start gap-2">
              <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-energy" />
              <span className="text-muted-foreground">{line}</span>
            </div>
          ))}
        </div>

        <div className="mt-4 rounded-2xl border border-border bg-muted/20 p-4 text-[12px] text-muted-foreground">
          <p className="flex items-center gap-2 font-semibold text-foreground">
            <ShieldCheck size={14} /> Two things to know before you pay
          </p>
          <p className="mt-2">
            Payouts are not connected yet, so nothing is transferred to you automatically today.
            Every sale is recorded and owed to you; the balance is what will be paid when payouts are
            switched on. If that matters to you now, ask us first.
          </p>
          <p className="mt-2">
            Earning money as a coach can create tax and record-keeping obligations where you live, and
            we cannot advise you on them.
          </p>
        </div>

        <div className="mt-6">
          {phase === "checking" && <p className="text-sm text-muted-foreground">Checking your account…</p>}

          {phase === "not_signed_in" && (
            <div className="rounded-2xl border border-border bg-card p-4">
              <p className="text-sm">
                You need a Vaylo Sports account first — the coach account is attached to it.
              </p>
              <Link to="/auth">
                <Button className="mt-3 w-full">Create or sign in to your account</Button>
              </Link>
              <p className="mt-2 text-[12px] text-muted-foreground">
                Then come back here to pay the {fee} coach fee.
              </p>
            </div>
          )}

          {phase === "already_a_coach" && (
            <div className="rounded-2xl border border-border bg-card p-4">
              <p className="text-sm font-semibold">This account is already a coach account.</p>
              <p className="mt-1 text-sm text-muted-foreground">
                You can publish plans and set your prices now.
              </p>
              <Link to="/coach-studio">
                <Button className="mt-3 w-full">Open your coach studio</Button>
              </Link>
            </div>
          )}

          {phase === "confirming" && (
            <div className="rounded-2xl border border-border bg-card p-4">
              <p className="text-sm font-semibold">Payment received — confirming it with our records.</p>
              <p className="mt-1 text-sm text-muted-foreground">
                This usually takes a moment. You do not need to pay again, and nothing else is needed
                from you.
              </p>
              <p className="mt-3 flex items-center gap-2 text-[12px] text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Checking…
              </p>
            </div>
          )}

          {(phase === "not_a_coach" || phase === "starting") && (
            <>
              {returned === "cancelled" && !error && (
                <div className="mb-4 rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">
                  You closed the payment page, so nothing was charged. The button below starts a new
                  one.
                </div>
              )}

              {native ? (
                // Inside the Android shell this payment is not started here on
                // purpose. See the note at the top of this file: a membership sold
                // inside the app is a digital purchase Google requires to go
                // through Play Billing, and the website is where this belongs.
                <div className="rounded-2xl border border-border bg-card p-4">
                  <p className="text-sm">
                    The coach account is opened on the Vaylo Sports website, so the payment and your
                    business details are handled there rather than on your phone.
                  </p>
                  <Button className="mt-3 w-full" onClick={() => void openCoachSignup()}>
                    Open the website
                  </Button>
                </div>
              ) : (
                <>
                  <Button
                    className="h-12 w-full"
                    disabled={phase === "starting"}
                    onClick={() => void startCheckout()}
                  >
                    {phase === "starting" ? "Opening the payment page…" : `Pay ${fee} and open my coach account`}
                  </Button>
                  <p className="mt-2 text-center text-[12px] text-muted-foreground">
                    Payment is taken by Stripe. You will come back here afterwards, and you can close
                    the payment page without being charged.
                  </p>
                </>
              )}

              {error && (
                <div className="mt-4 rounded-2xl border border-border bg-card p-4 text-sm">
                  <p className="font-semibold">Nothing has been charged.</p>
                  <p className="mt-1 text-muted-foreground">{error}</p>
                </div>
              )}

              {status?.application?.status === "pending_payment" && !error && (
                <p className="mt-3 text-[12px] text-muted-foreground">
                  A payment was started a few minutes ago and has not been completed. If this button
                  refuses, wait half an hour and try again.
                </p>
              )}
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}
