import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { appHref } from "@/lib/routerBase";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { motion } from "framer-motion";
import { Gift, Copy, Check, Users, Crown, Trophy } from "lucide-react";
import { isPreviewHost, publicAppUrl } from "@/lib/share";
import { isNativeShell } from "@/lib/platform";
import { promoBonus } from "@/lib/credits";
import { toast } from "sonner";

export default function Referrals() {
  const { user } = useAuth();
  const [code, setCode] = useState<string>("");
  type ReferralRow = { id?: string; status: string; [key: string]: unknown };
  const [referrals, setReferrals] = useState<ReferralRow[]>([]);
  type CommissionSummary = {
    enabled?: boolean;
    commission_pct?: number;
    hold_days?: number;
    min_payout_minor?: number;
    payout_currency?: string;
    pending_minor?: number;
    approved_minor?: number;
    paid_minor?: number;
    cancelled_minor?: number;
    paying_customers?: number;
    withdrawable_minor?: number;
    is_adult?: boolean;
  };
  const [cash, setCash] = useState<CommissionSummary | null>(null);
  const [cashLoading, setCashLoading] = useState(true);
  const [cashError, setCashError] = useState<string | null>(null);
  const [redeem, setRedeem] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [qualificationLoading, setQualificationLoading] = useState(true);
  const [qualificationError, setQualificationError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    (async () => {
      // Codes are issued server-side (referral_code_issue): crypto-random,
      // collision-safe, idempotent per account. The old Math.random client
      // generation was guessable and a collision meant a dead-end toast.
      const { data: issuedCode, error: codeError } = await supabase.rpc("referral_code_issue" as never);
      if (codeError) { toast.error(`Couldn't load your referral code: ${codeError.message}`); return; }
      const issued = (issuedCode ?? "") as string;
      if (!issued) { toast.error("Couldn't load your referral code: empty response"); return; }
      setCode(issued);
      const { data: refs, error: refsError } = await supabase.from("referrals").select("*").eq("referrer_id", user.id);
      if (refsError) { toast.error(`Couldn't load your referrals: ${refsError.message}`); return; }
      setReferrals(refs || []);
    })();
  }, [user]);

  // Native and preview builds have no honest public app URL yet: show/copy the
  // referral code by itself rather than leaking localhost or a preview origin.
  const canShareLink = !isNativeShell() && !isPreviewHost(window.location.hostname) && !!publicAppUrl();
  const link = canShareLink ? publicAppUrl(`/auth?ref=${code}`) : "";
  const shareValue = link || (code ? `Referral code: ${code}` : "");
  const sharePlaceholder = link ? "Invite link" : "Share this code with friends";


  const money = (minor?: number) =>
    `£${((Number(minor ?? 0)) / 100).toFixed(2)}`;

  // Cash commissions (the programme the business rules define): loaded from
  // the server's aggregate summary. Pending is NOT withdrawable money — the
  // statuses here are labelled so nobody mistakes one for the other.
  const loadCash = useCallback(async (uid: string) => {
    setCashLoading(true);
    setCashError(null);
    const { data, error } = await supabase.rpc("referral_dashboard_summary" as never);
    if (error) {
      setCashError("Couldn't load your commission summary. Try again shortly.");
    } else {
      setCash((data ?? {}) as CommissionSummary);
    }
    setCashLoading(false);
  }, []);

  useEffect(() => {
    if (!user) return;
    void loadCash(user.id);
  }, [user, loadCash]);

  const requestPayout = async () => {
    if (!user) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("referral_payout_request" as never);
      const r = (data ?? {}) as { ok?: boolean; error?: string; amount_minor?: number; status?: string };
      if (error || r.ok !== true) {
        const why = r.error ?? error?.message ?? "unknown";
        toast.error(
          why === "below_threshold"
            ? `You need ${money(cash?.min_payout_minor ?? 2500)} in approved commission to request a payout.`
            : why === "under_18_not_eligible"
              ? "Cash payouts are only available to 18+ referrers."
              : why === "programme_disabled"
                ? "The cash referral programme is paused right now."
                : `Payout request failed: ${why}`,
        );
      } else {
        toast.success("Payout requested", {
          description: "An admin will review and execute the transfer, then record its reference here.",
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const doRedeem = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("redeem_referral", { p_code: redeem.trim().toUpperCase() });
      if (error) throw error;
      // The old copy promised "14 days of Pro" — no plan or Pro days were ever
      // granted. The reward is the configured credit bonus, paid server-side.
      const result = (data ?? {}) as { referee_credits?: number | string | null };
      const granted = Number(result.referee_credits ?? 0);
      toast.success(granted > 0 ? `Code applied — ${granted} credits added!` : "Code applied!");
      setRedeem("");
      // Referrals are self-visible on either side. Refresh the sent-invitation
      // list only when the current user is the referrer; a redeemed code is a
      // referee attribution and must not expose that friend in this list.
      const { data: refs, error: refsError } = await supabase.from("referrals").select("*").eq("referrer_id", user?.id);
      if (!refsError) setReferrals(refs || []);
    } catch (e) { toast.error(e.message || "Invalid code"); }
    finally { setBusy(false); }
  };

  const copy = async () => {
    if (!shareValue) return;
    try {
      await navigator.clipboard.writeText(shareValue);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      toast.success(link ? "Invite link copied" : "Referral code copied");
    } catch {
      toast.error("Could not copy to clipboard");
    }
  };

  // This RPC returns only the caller's aggregate, never qualification rows or
  // transaction references. Keep failure distinct from a real zero count.
  const [qualifying, setQualifying] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setQualificationLoading(true);
    setQualificationError(null);
    if (!user) {
      setQualificationLoading(false);
      setQualifying(0);
      return;
    }
    void (async () => {
      const { data, error } = await supabase.rpc("referral_qualification_count" as never, { p_referrer: user.id } as never);
      if (cancelled) return;
      if (error) {
        setQualificationError("Couldn’t load your qualifying referrals. Try again shortly.");
      } else {
        setQualifying(Number(data ?? 0));
      }
      setQualificationLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user]);

  // Rates mirror economy_config.promo_bonuses, which is what the server pays.
  const refereeCredits = promoBonus("referral_referee");
  const referrerCredits = promoBonus("referral_referrer");
  // Relay tier list: qualifying friends needed for each milestone bonus.
  const tier3 = promoBonus("referral_tier_3");
  const tier5 = promoBonus("referral_tier_5");
  const tier10 = promoBonus("referral_tier_10");
  const TIERS = [
    { at: 3, bonus: tier3 },
    { at: 5, bonus: tier5 },
    { at: 10, bonus: tier10 },
  ];
  // The ladder counts qualifying friends (purchase-confirmed, the number the
  // server pays on), not raw claims or granted statuses.
  const nextTier = TIERS.find((t) => qualifying < t.at);
  const totalPotential = referrerCredits * 10 + tier3 + tier5 + tier10;

  return (
    <div className="px-5 pt-[var(--vaylo-screen-top)] pb-24 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold flex items-center gap-2 mb-1"><Gift className="h-6 w-6 text-energy" /> Refer & earn</h1>
      <p className="text-sm text-muted-foreground mb-4">
        Invite a friend: they get {refereeCredits} credits right away. When they make their first real purchase, you
        get {referrerCredits} — and the tier bonuses below as more of your friends join with real accounts.
      </p>
      {/* Relay tier list — progress ladder, same shape as Robinhood's 1/3/10:
          each milestone pays once, the next goal is always visible, and "real
          account" is honest about the purchase gate rather than implying
          signups alone count.Per-qualifying-friend basis is the
          (granted / qualifying) count the server pays on, so the numbers shown
          cannot drift from what the database awards. */}
      <div className="mb-6 rounded-3xl border border-border bg-card p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Tier rewards — qualifying friends</p>
        <ol className="space-y-2">
          {TIERS.map((t) => {
            const reached = !qualificationLoading && !qualificationError && qualifying >= t.at;
            const isNext = nextTier?.at === t.at;
            return (
              <li key={t.at} className="flex items-center gap-3">
                <span className={`flex h-8 min-w-8 items-center justify-center rounded-full px-2 text-[12px] font-bold ${
                  reached ? "bg-energy/20 text-energy" : "bg-muted text-muted-foreground"}
                }`}>
                  {t.at}
                </span>
                <span className={`flex-1 text-sm ${reached ? "text-foreground font-semibold" : "text-muted-foreground"}`}>
                  {t.at} qualifying friends
                </span>
                <span className={`text-sm font-bold ${reached ? "text-energy" : "text-foreground"}`}>
                  +{t.bonus}
                </span>
                {reached && <Check size={16} className="text-energy" aria-hidden />}
                {isNext && <span className="text-[11px] text-muted-foreground">{qualifying}/{t.at}</span>}
              </li>
            );
          })}
        </ol>
        {!qualificationLoading && !qualificationError && nextTier && (
          <p className="mt-3 text-xs text-muted-foreground">
            {nextTier.at - qualifying} more qualifying friend{nextTier.at - qualifying === 1 ? "" : "s"} to the next tier — up to {totalPotential} credits in total.
          </p>
        )}
      </div>
      <a
        href={appHref("/referral-leaderboard")}
        className="mb-6 flex items-center justify-between rounded-2xl border border-energy/40 bg-energy/10 px-4 py-3 text-sm font-semibold text-energy"
      >
        <span className="flex items-center gap-2"><Trophy size={16} /> Monthly recruiter leaderboard</span>
        <span>→</span>
      </a>

      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        className="rounded-3xl p-6 bg-gradient-to-br from-electric-purple/30 via-card to-energy/10 border border-electric-purple/40 mb-6">
        <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Your code</p>
        <div className="flex items-center gap-2 mb-3">
          <p className="text-3xl font-bold font-mono">{code}</p>
        </div>
        <div className="flex gap-2">
          <Input value={shareValue} placeholder={sharePlaceholder} readOnly className="font-mono text-xs" />
          <Button onClick={copy} disabled={!shareValue} variant="outline" className="shrink-0" aria-label="Copy referral link or code">
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          </Button>
        </div>
      </motion.div>

      {qualificationError && <p role="alert" className="mb-3 text-sm text-destructive">{qualificationError}</p>}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="p-4 rounded-2xl bg-card border border-border">
          <Users className="h-4 w-4 text-electric-purple mb-2" />
          <p className="text-2xl font-bold">{referrals.length}</p>
          <p className="text-xs text-muted-foreground">Friends invited</p>
        </div>
        <div className="p-4 rounded-2xl bg-card border border-border">
          <Check className="h-4 w-4 text-primary mb-2" />
          <p className="text-2xl font-bold">{qualificationLoading ? "—" : qualifying}</p>
          <p className="text-xs text-muted-foreground">Qualifying</p>
        </div>
        <div className="p-4 rounded-2xl bg-card border border-border">
          <Crown className="h-4 w-4 text-energy mb-2" />
          <p className="text-2xl font-bold">{qualificationLoading ? "—" : qualifying * referrerCredits}</p>
          <p className="text-xs text-muted-foreground">Credits earned</p>
        </div>
      </div>

      <div className="p-5 rounded-2xl border border-border bg-card">
        <p className="font-semibold mb-1">Got a code?</p>
        <p className="text-xs text-muted-foreground mb-3">Enter a friend's code to claim {refereeCredits} credits.</p>
        <div className="flex gap-2">
          <Input value={redeem} onChange={(e) => setRedeem(e.target.value)} placeholder="ABC123" className="font-mono uppercase" />
          <Button onClick={doRedeem} disabled={!redeem || busy}>Redeem</Button>
        </div>
      </div>

      {/* ── Cash commissions (18+): the honest money section ──────────────
          Every status is labelled so that "pending" can never read as
          "withdrawable": pending sits inside the hold period, approved has
          cleared it, and payout requests are executed by the operator and
          recorded with the provider reference. Registering or starting a
          trial earns nothing; ONLY a verified first purchase accrues. */}
      <div className="mt-6 p-5 rounded-2xl border border-electric-purple/40 bg-card">
        <p className="font-semibold mb-1 flex items-center gap-2"><Crown size={16} className="text-electric-purple" /> Cash commissions (18+)</p>
        {cashError && <p role="alert" className="mt-2 text-sm text-destructive">{cashError}</p>}
        {cashLoading && !cashError && <p className="text-sm text-muted-foreground">Loading cash summary…</p>}
        {cash && cash.enabled === false && (
          <p className="mt-2 text-sm text-muted-foreground">The cash programme is paused right now — commission recording is switched off.</p>
        )}
        {cash && (
          <>
            <p className="text-xs text-muted-foreground mt-2">
              {cash.commission_pct ?? 15}% of your referred friend's first qualifying payment, calculated on the revenue Vaylo keeps
              (excluding refunds, taxes and processing fees). Held {cash.hold_days ?? 30} days after payment for refunds and fraud checks.
            </p>
            <div className="mt-3 space-y-1.5 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Paying customers</span><span className="font-semibold">{cash.paying_customers ?? 0}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Pending (in hold)</span><span className="font-semibold">{money(cash.pending_minor)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Approved (past hold)</span><span className="font-semibold">{money(cash.approved_minor)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Paid out</span><span className="font-semibold">{money(cash.paid_minor)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Cancelled / reversed</span><span className="font-semibold">{money(cash.cancelled_minor)}</span></div>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Minimum payout {money(cash.min_payout_minor ?? 2500)}. Approved and no payout requested so far: {money(cash.withdrawable_minor)}.
              {cash.is_adult === false ? " Cash payouts are only available from age 18." : ""}
            </p>
            <Button
              onClick={requestPayout}
              disabled={busy || cashLoading || !!cashError || (cash.withdrawable_minor ?? 0) < (cash.min_payout_minor ?? 2500)}
              className="mt-3 w-full"
            >
              Request payout
            </Button>
            <p className="mt-2 text-[11px] text-muted-foreground">
              A request is a review, not a transfer: the team approves it and executes the payout manually, then the reference is
              recorded here. Registration, trials and failed or refunded payments never accrue cash. One commission per referred
              customer; duplicate webhook replays cannot create a second one. Self-referrals and underage referrers are excluded.
            </p>
          </>
        )}
      </div>

      <p className="text-[12px] text-muted-foreground mt-4 text-center">One redemption per account. A friend qualifies after their first verified purchase. Transaction references prevent duplicate purchase processing; they do not identify a shared payment method. Self-referrals do not earn rewards.</p>
    </div>
  );
}
