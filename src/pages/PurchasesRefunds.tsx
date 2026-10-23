import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  AlertTriangle,
  ChevronDown,
  ChevronLeft,
  Clock,
  CreditCard,
  Loader2,
  ReceiptText,
  ShieldCheck,
  Sparkles,
  UserCheck,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { FEATURE_LABELS } from "@/config/credits";
import {
  escalateRefundCase,
  loadRefundCase,
  loadRefundOptions,
  reasonByCode,
  submitRefund,
  type RefundCaseView,
  type RefundChargeOption,
  type RefundOptions,
  type RefundPurchaseOption,
  type RefundSourceType,
} from "@/lib/refunds";
import { statusLabel, statusTone } from "@/lib/refunds";

// ============================================================================
// PURCHASES & REFUNDS — the in-app half of the refund system
// ----------------------------------------------------------------------------
// This screen never decides anything. It lists what the server says the athlete
// may ask about, offers exactly the reasons the server accepts for that
// transaction, and shows the case the server created. Eligibility, amounts and
// duplicate checks are computed in supabase/functions/refund-request from rows
// the browser cannot write; a malformed or optimistic request here can only
// produce an error, never a credit.
//
// Two statuses need saying out loud in the UI, because they are the honest ones:
//   * "Awaiting payment provider" — approved, but no money has moved.
//   * "Declined" with a human-review route — policy refusal, not a legal bar.
// ============================================================================

type Target =
  | { kind: "charge"; id: string }
  | { kind: "purchase"; id: string }
  | { kind: "subscription" };

const money = (cents: number | null | undefined, currency: string) => {
  if (cents == null) return "—";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "USD",
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
};

const date = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString();
};

const featureLabel = (feature: string | null) =>
  (feature && (FEATURE_LABELS as Record<string, string>)[feature]) ||
  (feature ? feature.replace(/_/g, " ") : "AI request");

function newSubmissionKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `rf-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

function StatusPill({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusTone(status)}`}>
      {statusLabel(status)}
    </span>
  );
}

/** One case, its current status, and — on demand — its customer-safe timeline. */
function CaseCard({ initial }: { initial: RefundCaseView }) {
  const [caseView, setCaseView] = useState(initial);
  const [open, setOpen] = useState(false);
  const [timeline, setTimeline] = useState<Array<{ label: string; at: string }> | null>(null);
  const [busy, setBusy] = useState(false);
  const [escalated, setEscalated] = useState(false);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && !timeline) {
      try {
        const res = await loadRefundCase(caseView.ref);
        setCaseView(res.case);
        setTimeline(res.timeline);
      } catch {
        setTimeline([]);
      }
    }
  };

  const escalate = async () => {
    setBusy(true);
    try {
      const res = await escalateRefundCase(caseView.ref);
      setCaseView(res.case);
      setEscalated(true);
      toast.success(res.message ?? "A person will look at this request.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not ask for a review.");
    } finally {
      setBusy(false);
    }
  };

  const awaitingProvider = caseView.status === "awaiting_provider";

  return (
    <li className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-xs text-muted-foreground">{caseView.ref}</p>
          <p className="mt-1 text-sm font-semibold">
            {caseView.feature ? featureLabel(caseView.feature) : caseView.sourceType.replace(/_/g, " ")}
            {caseView.credits ? ` · ${caseView.credits} credits` : ""}
            {caseView.amountCents ? ` · ${money(caseView.amountCents, caseView.currency)}` : ""}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Opened {date(caseView.createdAt)}
            {caseView.reasonCode ? ` · ${reasonByCode(caseView.reasonCode)?.label ?? caseView.reasonCode}` : ""}
          </p>
        </div>
        <StatusPill status={caseView.status} />
      </div>

      {caseView.decisionNote && caseView.status === "declined" && (
        <p className="mt-3 rounded-xl border border-border bg-background/60 px-3 py-2 text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">Reason: </span>
          {caseView.decisionNote}
        </p>
      )}

      {awaitingProvider && (
        <p className="mt-3 flex items-start gap-2 rounded-xl border border-sky-500/25 bg-sky-500/10 px-3 py-2 text-xs text-sky-200">
          <Clock size={14} className="mt-0.5 shrink-0" aria-hidden />
          Approved, but no money has moved yet. The refund is issued once a verified
          payment provider is connected.
        </p>
      )}

      {caseView.status === "processing_failed" && (
        <p className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
          The provider could not complete this. The team has been alerted and nothing
          further will be charged.
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className="press inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs font-semibold text-foreground"
        >
          {open ? "Hide updates" : "View updates"}
          <ChevronDown size={13} className={open ? "rotate-180 transition-transform" : "transition-transform"} aria-hidden />
        </button>
        {caseView.canEscalate && !escalated && (
          <Button size="sm" variant="outline" onClick={escalate} disabled={busy}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : <UserCheck size={13} />} Ask for a human review
          </Button>
        )}
      </div>

      {open && (
        <div className="mt-3 border-t border-white/[0.06] pt-3" aria-live="polite">
          {timeline === null ? (
            <p className="text-xs text-muted-foreground">Loading updates…</p>
          ) : timeline.length === 0 ? (
            <p className="text-xs text-muted-foreground">No updates recorded yet.</p>
          ) : (
            <ol className="space-y-1.5">
              {timeline.map((entry, i) => (
                <li key={`${entry.label}-${i}`} className="flex items-baseline justify-between gap-3 text-xs">
                  <span className="text-foreground">{entry.label}</span>
                  <span className="shrink-0 text-muted-foreground">{date(entry.at)}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </li>
  );
}

export default function PurchasesRefunds() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [options, setOptions] = useState<RefundOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<"charges" | "purchases">("charges");
  const [target, setTarget] = useState<Target | null>(null);
  const [reasonCode, setReasonCode] = useState<string>("");
  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ message: string; case: RefundCaseView } | null>(null);
  const submissionKey = useRef(newSubmissionKey());

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await loadRefundOptions();
      setOptions(data);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not load your purchases.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setLoading(false);
      return;
    }
    void load();
  }, [authLoading, load, user]);

  const charges = options?.charges ?? [];
  const purchases = options?.purchases ?? [];
  const subscription = options?.subscription ?? null;
  const cases = options?.cases ?? [];
  const openCases = cases.filter((c) => c.status !== "completed" && c.status !== "declined");

  const selectedCharge: RefundChargeOption | null =
    target?.kind === "charge" ? charges.find((c) => c.id === target.id) ?? null : null;
  const selectedPurchase: RefundPurchaseOption | null =
    target?.kind === "purchase" ? purchases.find((p) => p.id === target.id) ?? null : null;

  const availableReasons = useMemo(() => {
    if (!options) return [];
    if (target?.kind === "charge") {
      return (selectedCharge?.reasons ?? []).map((code) => reasonByCode(code)).filter((r): r is NonNullable<typeof r> => !!r);
    }
    if (target?.kind === "purchase") {
      return (selectedPurchase?.reasons ?? []).map((code) => reasonByCode(code)).filter((r): r is NonNullable<typeof r> => !!r);
    }
    if (target?.kind === "subscription") {
      return (subscription?.reasons ?? []).map((code) => reasonByCode(code)).filter((r): r is NonNullable<typeof r> => !!r);
    }
    return [];
  }, [options, selectedCharge, selectedPurchase, subscription, target]);

  const reason = reasonByCode(reasonCode);
  const sourceType: RefundSourceType =
    target?.kind === "charge"
      ? reasonCode === "ai_duplicate_charge"
        ? "duplicate_charge"
        : "ai_service"
      : target?.kind === "purchase"
        ? reasonCode === "purchase_unauthorised"
          ? "unauthorized"
          : "credit_purchase"
        : target?.kind === "subscription"
          ? "subscription"
          : "other";

  const detailsNeeded = !!reason?.requiresDetails;
  const canSubmit =
    !!target &&
    !!reasonCode &&
    !submitting &&
    (!detailsNeeded || details.trim().length >= 10) &&
    !(selectedCharge?.alreadyRefunded ?? false) &&
    !(selectedPurchase?.existingCase ?? false);

  const chooseTarget = (next: Target) => {
    setTarget(next);
    setReasonCode("");
    setDetails("");
    setResult(null);
    // A new transaction is a new request: a fresh key, so an earlier submit
    // cannot be mistaken for this one if the button is double-tapped.
    submissionKey.current = newSubmissionKey();
  };

  const submit = async () => {
    if (!target || !canSubmit) return;
    setSubmitting(true);
    try {
      const res = await submitRefund({
        sourceType,
        reasonCode,
        details: details.trim() || undefined,
        chargeId: target.kind === "charge" ? target.id : undefined,
        purchaseId: target.kind === "purchase" ? target.id : undefined,
        submissionKey: submissionKey.current,
      });
      setResult({ message: res.message ?? "Your request has been recorded.", case: res.case });
      setTarget(null);
      setReasonCode("");
      setDetails("");
      submissionKey.current = newSubmissionKey();
      await load();
      toast.success(res.message ?? "Request recorded.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The request could not be sent.");
    } finally {
      setSubmitting(false);
    }
  };

  if (authLoading) {
    return (
      <div className="px-5 pt-[var(--vaylo-screen-top)] pb-24 max-w-2xl mx-auto">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="px-5 pt-[var(--vaylo-screen-top)] pb-24 max-w-2xl mx-auto">
        <h1 className="text-2xl font-display font-bold mb-2">Purchases &amp; refunds</h1>
        <p className="text-sm text-muted-foreground mb-4">Sign in to see your purchases and any refund requests.</p>
        <Button onClick={() => navigate("/auth")}>Sign in</Button>
      </div>
    );
  }

  return (
    <div className="px-5 pt-[var(--vaylo-screen-top)] pb-24 max-w-2xl mx-auto">
      <button
        onClick={() => navigate(-1)}
        className="mb-4 flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        aria-label="Back"
      >
        <ChevronLeft size={18} /> Back
      </button>

      <motion.h1
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-2xl font-display font-bold flex items-center gap-2"
      >
        <ReceiptText className="h-6 w-6 text-primary" aria-hidden /> Purchases &amp; refunds
      </motion.h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Everything you have bought, every AI request that took credits, and the status of any
        refund you have asked for.
      </p>

      {loading ? (
        <p className="mt-6 text-sm text-muted-foreground">Loading your purchases…</p>
      ) : loadError ? (
        <div className="mt-6 rounded-2xl border border-destructive/30 bg-destructive/10 p-4">
          <p className="text-sm text-destructive">{loadError}</p>
          <Button size="sm" variant="outline" className="mt-3" onClick={() => void load()}>
            Try again
          </Button>
        </div>
      ) : (
        <>
          {/* Balance + the honest money statement */}
          <div className="mt-5 grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-primary/30 bg-primary/10 p-4">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Credit balance</p>
              <p className="mt-1 text-2xl font-bold tabular-nums">
                {options?.balance.infinite ? "Unlimited" : (options?.balance.credits ?? 0).toLocaleString()}
              </p>
            </div>
            <div className="rounded-2xl border border-border bg-card p-4">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Open requests</p>
              <p className="mt-1 text-2xl font-bold tabular-nums">{openCases.length}</p>
            </div>
          </div>

          <div className="mt-3 flex items-start gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-xs text-muted-foreground">
            <ShieldCheck size={15} className="mt-0.5 shrink-0 text-primary" aria-hidden />
            <p>
              Credits for an AI request that failed are returned automatically once the failure is
              verified. Money refunds are reviewed and recorded here, but{" "}
              <strong className="text-foreground">
                {options?.moneyExecutionEnabled
                  ? "are issued through the connected payment provider"
                  : "no money can move until a payment provider is connected"}
              </strong>
              . Nothing in this screen can change your ledger.
            </p>
          </div>

          {result && (
            <div
              className="mt-4 rounded-2xl border border-primary/30 bg-primary/10 p-4"
              role="status"
              aria-live="polite"
            >
              <p className="text-sm font-semibold">Request {result.case.ref}</p>
              <p className="mt-1 text-xs text-muted-foreground">{result.message}</p>
              <StatusPill status={result.case.status} />
            </div>
          )}

          {/* Existing cases */}
          {cases.length > 0 && (
            <section className="mt-6" aria-labelledby="refund-cases-heading">
              <h2 id="refund-cases-heading" className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-2">
                Your requests
              </h2>
              <ul className="space-y-2">
                {cases.map((c) => (
                  <CaseCard key={c.ref} initial={c} />
                ))}
              </ul>
            </section>
          )}

          {/* Pick a transaction */}
          <section className="mt-6" aria-labelledby="pick-heading">
            <h2 id="pick-heading" className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-2">
              Ask about a transaction
            </h2>

            <div className="mb-3 flex gap-2" role="tablist" aria-label="Transaction type">
              {(
                [
                  ["charges", "AI requests", charges.length],
                  ["purchases", "Purchases", purchases.length],
                ] as const
              ).map(([key, label, count]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={tab === key}
                  onClick={() => {
                    setTab(key);
                    setTarget(null);
                    setReasonCode("");
                    setDetails("");
                  }}
                  className={`press rounded-xl border px-3 py-2 text-xs font-semibold ${
                    tab === key
                      ? "border-primary/40 bg-primary/15 text-primary"
                      : "border-border bg-card text-muted-foreground"
                  }`}
                >
                  {label} <span className="tabular-nums opacity-70">({count})</span>
                </button>
              ))}
            </div>

            <div className="space-y-2">
              {tab === "charges" &&
                (charges.length === 0 ? (
                  <p className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">
                    No AI request has taken credits from this account yet.
                  </p>
                ) : (
                  charges.map((charge) => {
                    const chosen = target?.kind === "charge" && target.id === charge.id;
                    const disabled = charge.alreadyRefunded || !!charge.existingCase;
                    return (
                      <div key={charge.id}>
                        <button
                          type="button"
                          aria-pressed={chosen}
                          disabled={disabled}
                          onClick={() => chooseTarget({ kind: "charge", id: charge.id })}
                          className={`w-full rounded-2xl border p-3 text-left transition-colors ${
                            chosen
                              ? "border-primary/50 bg-primary/10"
                              : disabled
                                ? "border-border bg-card/50 opacity-70"
                                : "border-border bg-card hover:border-primary/30"
                          }`}
                        >
                          <span className="flex items-center justify-between gap-3">
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-semibold">
                                {featureLabel(charge.feature)}
                              </span>
                              <span className="mt-0.5 block text-xs text-muted-foreground">
                                {date(charge.createdAt)} · {charge.credits} credits
                                {charge.jobStatus === "failed"
                                  ? " · service failed"
                                  : charge.jobStatus === "delivered"
                                    ? " · delivered"
                                    : charge.jobStatus === "started"
                                      ? " · no outcome recorded"
                                      : ""}
                              </span>
                            </span>
                            {charge.alreadyRefunded ? (
                              <span className="shrink-0 text-[11px] font-semibold text-energy">Credits returned</span>
                            ) : charge.existingCase ? (
                              <span className="shrink-0 text-[11px] font-semibold text-muted-foreground">
                                {charge.existingCase.ref}
                              </span>
                            ) : (
                              <span className="shrink-0 text-[11px] font-semibold text-primary">Select</span>
                            )}
                          </span>
                        </button>
                      </div>
                    );
                  })
                ))}

              {tab === "purchases" && (
                <>
                  {purchases.length === 0 && (
                    <p className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">
                      No purchases on this account.
                    </p>
                  )}
                  {purchases.map((purchase) => {
                    const chosen = target?.kind === "purchase" && target.id === purchase.id;
                    return (
                      <button
                        key={purchase.id}
                        type="button"
                        aria-pressed={chosen}
                        onClick={() => chooseTarget({ kind: "purchase", id: purchase.id })}
                        className={`w-full rounded-2xl border p-3 text-left transition-colors ${
                          chosen ? "border-primary/50 bg-primary/10" : "border-border bg-card hover:border-primary/30"
                        }`}
                      >
                        <span className="flex items-center justify-between gap-3">
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold">
                              {purchase.productId.replace(/_/g, " ")}
                            </span>
                            <span className="mt-0.5 block text-xs text-muted-foreground">
                              {date(purchase.purchasedAt)} · {money(purchase.priceCents, purchase.currency)}
                              {purchase.creditsUnused != null
                                ? ` · ${purchase.creditsUnused} of ${purchase.creditsGranted ?? 0} credits unused`
                                : ""}
                            </span>
                          </span>
                          {purchase.existingCase ? (
                            <span className="shrink-0 text-[11px] font-semibold text-muted-foreground">
                              {purchase.existingCase.ref}
                            </span>
                          ) : (
                            <span className="shrink-0 text-[11px] font-semibold text-primary">Select</span>
                          )}
                        </span>
                      </button>
                    );
                  })}

                  {subscription && (
                    <button
                      type="button"
                      aria-pressed={target?.kind === "subscription"}
                      onClick={() => chooseTarget({ kind: "subscription" })}
                      className={`w-full rounded-2xl border p-3 text-left transition-colors ${
                        target?.kind === "subscription"
                          ? "border-primary/50 bg-primary/10"
                          : "border-border bg-card hover:border-primary/30"
                      }`}
                    >
                      <span className="flex items-center justify-between gap-3">
                        <span>
                          <span className="block text-sm font-semibold">
                            {subscription.planType.replace(/_/g, " ")} subscription
                          </span>
                          <span className="mt-0.5 block text-xs text-muted-foreground">
                            {subscription.status}
                            {subscription.expiresAt ? ` · renews or ends ${date(subscription.expiresAt)}` : ""}
                          </span>
                        </span>
                        <CreditCard size={16} className="shrink-0 text-muted-foreground" aria-hidden />
                      </span>
                    </button>
                  )}
                </>
              )}
            </div>
          </section>

          {/* Reason + details + submit */}
          {target && (
            <section className="mt-6 rounded-2xl border border-border bg-card p-4" aria-labelledby="reason-heading">
              <h2 id="reason-heading" className="text-sm font-bold mb-1">
                Why are you asking?
              </h2>
              <p className="mb-3 text-xs text-muted-foreground">
                Only reasons that apply to this transaction are shown. The server checks the rest.
              </p>

              <fieldset className="space-y-2">
                <legend className="sr-only">Refund reason</legend>
                {availableReasons.map((option) => (
                  <label
                    key={option.code}
                    className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${
                      reasonCode === option.code ? "border-primary/50 bg-primary/10" : "border-border"
                    }`}
                  >
                    <input
                      type="radio"
                      name="refund-reason"
                      value={option.code}
                      checked={reasonCode === option.code}
                      onChange={() => setReasonCode(option.code)}
                      className="mt-1 h-4 w-4 accent-[hsl(var(--primary))]"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{option.label}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">{option.hint}</span>
                    </span>
                  </label>
                ))}
              </fieldset>

              <label htmlFor="refund-details" className="mt-4 block text-xs font-semibold text-muted-foreground">
                What happened? {detailsNeeded ? "(required)" : "(optional)"}
              </label>
              <Textarea
                id="refund-details"
                value={details}
                onChange={(e) => setDetails(e.target.value.slice(0, 2000))}
                maxLength={2000}
                rows={4}
                placeholder="A sentence or two is enough — dates, what you expected and what you got."
                className="mt-1"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                {details.length}/2000. Do not include card numbers or passwords.
              </p>

              <Button className="mt-3 w-full" onClick={() => void submit()} disabled={!canSubmit}>
                {submitting ? (
                  <>
                    <Loader2 size={15} className="animate-spin" /> Sending…
                  </>
                ) : (
                  <>
                    <Sparkles size={15} /> Submit request
                  </>
                )}
              </Button>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Submitting does not change your balance or charge you again. A failed AI request
                that the server can verify returns its credits immediately.
              </p>
            </section>
          )}

          {/* Policy, plainly */}
          <section className="mt-6 rounded-2xl border border-border bg-card p-4" aria-labelledby="policy-heading">
            <h2 id="policy-heading" className="text-sm font-bold flex items-center gap-2 mb-2">
              <ShieldCheck size={16} className="text-primary" aria-hidden /> What we refund
            </h2>
            <ul className="space-y-1.5 text-sm text-muted-foreground">
              <li>• Credits taken for an AI request that failed are returned in full, automatically when verified.</li>
              <li>• A delivered AI result is not ordinarily refundable — you can still ask for a human review.</li>
              <li>• Unused purchased credits can be put forward for a money refund; a person reviews it.</li>
              <li>• A duplicate or unauthorised charge is never rejected automatically.</li>
              <li>• Cancelling a subscription is done in Google Play; a refund is a separate request.</li>
              <li>
                • A previous refund is not held against you. The only hard limit is a duplicate
                restoration for the same charge.
              </li>
            </ul>
            <p className="mt-3 text-xs text-muted-foreground">
              None of this overrides your statutory consumer rights. If you believe a decision was
              wrong, ask for a human review on the case.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
