import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Clock,
  Loader2,
  Receipt,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import BottomSheet from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { legalPath } from "@/lib/legalUrls";
import {
  escalateRefundCase,
  loadRefundOptions,
  reasonByCode,
  reasonsForSource,
  statusLabel,
  statusTone,
  submitRefund,
  type RefundCaseView,
  type RefundChargeOption,
  type RefundOptions,
  type RefundPurchaseOption,
  type RefundSourceType,
} from "@/lib/refunds";

// ============================================================================
// PURCHASES & REFUNDS — the athlete's own transaction history and requests
// ----------------------------------------------------------------------------
// The screen used to be a dead link: /settings/purchases redirected to a route
// that no longer existed, and the refund edge functions were never deployed, so
// a request failed with "Failed to send request to the Edge function". This page
// is the missing customer half. It reads the server-assembled options (never
// decides eligibility itself), submits only a reason + words + a transaction id,
// and shows the server's decision verbatim.
//
// No amount, status, credit grant or refund outcome is chosen here. The button
// says "Request a refund"; what happens next is the server's answer.
// ============================================================================

type ChargeTarget = {
  kind: "charge";
  charge: RefundChargeOption;
};

type PurchaseTarget = {
  kind: "purchase";
  purchase: RefundPurchaseOption;
};

type SubscriptionTarget = {
  kind: "subscription";
};

type Target = ChargeTarget | PurchaseTarget | SubscriptionTarget;

const money = (cents: number | null | undefined, currency: string) => {
  if (cents == null) return "—";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 2,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency || "USD"}`;
  }
};

const when = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
};

const featureName = (feature: string | null) => {
  if (!feature) return "AI service";
  return feature
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
};

const newSubmissionKey = () => {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch {
    /* older WebView */
  }
  return `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

function StatusPill({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusTone(status)}`}>
      {statusLabel(status)}
    </span>
  );
}

function SectionHeading({ eyebrow, title, children }: { eyebrow: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-end justify-between gap-3 px-1">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{eyebrow}</p>
        <h2 className="font-display text-lg font-bold">{title}</h2>
      </div>
      {children}
    </div>
  );
}

export default function PurchasesRefunds() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [options, setOptions] = useState<RefundOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const [reasonCode, setReasonCode] = useState("");
  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<{ case: RefundCaseView; message?: string; balance?: number | null } | null>(null);
  const [escalating, setEscalating] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const next = await loadRefundOptions();
      setOptions(next);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not load your purchases.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openTarget = (next: Target) => {
    setTarget(next);
    setReasonCode("");
    setDetails("");
    setSubmitted(null);
  };

  // The transaction the request is about. The server decides which reasons are
  // offered per transaction (`reasons` on each option), so the dialog is built
  // from that list rather than from a copy of the policy held here.
  const selectedCharge = target?.kind === "charge" ? target.charge : null;
  const selectedPurchase = target?.kind === "purchase" ? target.purchase : null;
  const selectedSubscription = target?.kind === "subscription" ? options?.subscription ?? null : null;

  const reasons = useMemo(() => {
    if (selectedCharge) {
      const allowed = new Set(selectedCharge?.reasons ?? []);
      return reasonsForSource("ai_service").filter((r) => allowed.has(r.code));
    }
    if (selectedPurchase) {
      const allowed = new Set(selectedPurchase?.reasons ?? []);
      return reasonsForSource("credit_purchase").filter((r) => allowed.has(r.code));
    }
    if (selectedSubscription) {
      const allowed = new Set(selectedSubscription?.reasons ?? []);
      return reasonsForSource("subscription").filter((r) => allowed.has(r.code));
    }
    return [];
  }, [selectedCharge, selectedPurchase, selectedSubscription]);

  const activeReason = reasonByCode(reasonCode);

  // A declined automatic decision can be re-opened by the athlete, exactly
  // once the server marks it `canEscalate` (status declined + auto_rejected).
  // A decision a person made cannot be re-opened here, and the server says so.
  const askForHuman = async (ref: string) => {
    setEscalating(ref);
    try {
      const result = await escalateRefundCase(ref);
      setOptions((prev) =>
        prev
          ? { ...prev, cases: prev.cases.map((c) => (c.ref === ref ? result.case : c)) }
          : prev,
      );
      toast({
        title: "Sent for human review",
        description: result.message || "A person will look at this request.",
      });
    } catch (error) {
      toast({
        title: "Couldn't re-open the request",
        description: error instanceof Error ? error.message : "Try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setEscalating(null);
    }
  };

  const submit = async () => {
    if (!target || !activeReason) return;
    if (activeReason.requiresDetails && details.trim().length < 8) {
      toast({
        title: "A little more detail, please",
        description: "This request goes to a person, so tell them what happened.",
        variant: "destructive",
      });
      return;
    }
    setSubmitting(true);
    try {
      const result = await submitRefund({
        sourceType:
          target.kind === "charge"
            ? "ai_service"
            : target.kind === "purchase"
              ? "credit_purchase"
              : "subscription",
        reasonCode: activeReason.code,
        details: details.trim() || undefined,
        chargeId: target.kind === "charge" ? target.charge.id : undefined,
        purchaseId: target.kind === "purchase" ? target.purchase.id : undefined,
        submissionKey: newSubmissionKey(),
      });
      setSubmitted({
        case: result.case,
        message: result.message,
        balance: result.balance ?? null,
      });
      setTarget(null);
      await load();
      toast({
        title: result.case.status === "completed" ? "Credits returned" : "Refund request submitted",
        description: result.case.status === "completed"
          ? `${result.case.credits ?? "Your"} credits are back in your balance.`
          : `Reference ${result.case.ref}. We will email you when it is decided.`,
      });
    } catch (error) {
      toast({
        title: "Couldn't send the request",
        description: error instanceof Error ? error.message : "Try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const charges = options?.charges ?? [];
  const purchases = options?.purchases ?? [];
  const cases = options?.cases ?? [];
  const openCases = cases.filter((c) => c.status !== "declined" && c.status !== "completed");

  return (
    <div className="min-h-screen bg-background pb-28">
      <div className="px-5 pt-[var(--vaylo-screen-top)]">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Account</p>
        <h1 className="mt-1 font-display text-2xl font-bold">Purchases &amp; refunds</h1>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          Every charge, receipt and request on this account. Refund decisions are made on the server — this screen cannot choose an outcome.
        </p>
      </div>

      {loading && (
        <div className="mt-8 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 size={16} className="animate-spin" /> Loading your transactions…
        </div>
      )}

      {!loading && loadError && (
        <div className="mx-5 mt-5 rounded-2xl border border-destructive/30 bg-destructive/10 p-4">
          <div className="flex items-start gap-2 text-destructive">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold">Couldn't load purchases</p>
              <p className="mt-1 text-[12px] leading-relaxed">{loadError}</p>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <Button onClick={() => void load()} variant="outline" className="h-10 rounded-xl">
              <RefreshCw size={14} className="mr-1.5" /> Try again
            </Button>
            <Button onClick={() => navigate(legalPath("refunds"))} variant="outline" className="h-10 rounded-xl">
              Refund policy
            </Button>
          </div>
        </div>
      )}

      {!loading && options && (
        <div className="mt-5 space-y-6">
          {submitted && (
            <div className="mx-5 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4">
              <div className="flex items-start gap-2">
                <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-emerald-300" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-emerald-200">
                    {submitted.case.status === "completed" ? "Credits returned" : `Request ${submitted.case.ref} submitted`}
                  </p>
                  <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                    {submitted.message ||
                      (submitted.case.status === "completed"
                        ? "The credits are back in your balance."
                        : "You can follow the status here. We will email you when it is decided.")}
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <StatusPill status={submitted.case.status} />
                    <button
                      type="button"
                      onClick={() => setSubmitted(null)}
                      className="ml-auto text-muted-foreground hover:text-foreground"
                      aria-label="Dismiss"
                    >
                      <X size={16} />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="mx-5 grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-border bg-card p-4">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Credit balance</p>
              <p className="mt-1 font-display text-2xl font-bold">
                {options.balance.infinite ? "Unlimited" : options.balance.credits}
              </p>
            </div>
            <div className="rounded-2xl border border-border bg-card p-4">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Open requests</p>
              <p className="mt-1 font-display text-2xl font-bold">{openCases.length}</p>
            </div>
          </div>

          {cases.length > 0 && (
            <section className="px-5">
              <SectionHeading eyebrow="History" title="Your refund requests" />
              <div className="space-y-2">
                {cases.map((c) => (
                  <div key={c.ref} className="rounded-2xl border border-border bg-card p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold">{c.ref}</p>
                        <p className="mt-0.5 text-[12px] text-muted-foreground">
                          {reasonByCode(c.reasonCode)?.label ?? c.reasonCode}
                          {c.feature ? ` · ${featureName(c.feature)}` : ""}
                        </p>
                      </div>
                      <StatusPill status={c.status} />
                    </div>
                    <p className="mt-2 text-[12px] text-muted-foreground">
                      Opened {when(c.createdAt)}
                      {c.credits ? ` · ${c.credits} credits` : ""}
                      {c.amountCents != null ? ` · ${money(c.amountCents, c.currency)}` : ""}
                    </p>
                    {c.decisionNote && (
                      <p className="mt-2 rounded-xl border border-border bg-muted/30 px-3 py-2 text-[12px] leading-relaxed">
                        {c.decisionNote}
                      </p>
                    )}
                    {c.canEscalate && (
                      <button
                        type="button"
                        onClick={() => void askForHuman(c.ref)}
                        disabled={escalating === c.ref}
                        className="mt-3 flex min-h-[40px] w-full items-center justify-center gap-1.5 rounded-xl border border-border py-2 text-[13px] font-semibold hover:bg-muted/40 disabled:opacity-60"
                      >
                        {escalating === c.ref ? (
                          <><Loader2 size={14} className="animate-spin" /> Sending…</>
                        ) : (
                          <><Sparkles size={14} /> Ask for a human review</>
                        )}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="px-5">
            <SectionHeading eyebrow="Receipts" title="Purchases">
              {purchases.length > 0 && (
                <span className="text-[11px] text-muted-foreground">{purchases.length} on record</span>
              )}
            </SectionHeading>
            {purchases.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                No credit purchases yet. Your starting credits and any earned credits are not purchases.
              </div>
            ) : (
              <div className="space-y-2">
                {purchases.map((p) => {
                  const canAsk = p.reasons.length > 0 && !p.existingCase;
                  return (
                    <div key={p.id} className="rounded-2xl border border-border bg-card p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{p.productId.replace(/_/g, " ")}</p>
                          <p className="mt-0.5 text-[12px] text-muted-foreground">
                            {p.productType} · {when(p.purchasedAt)}
                          </p>
                          {p.creditsGranted != null && (
                            <p className="mt-1 text-[12px] text-muted-foreground">
                              {p.creditsGranted} credits granted
                              {p.creditsUnused != null ? ` · ${p.creditsUnused} unused` : ""}
                            </p>
                          )}
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="font-display text-lg font-bold">{money(p.priceCents, p.currency)}</p>
                          {p.existingCase && (
                            <p className="mt-1 text-[11px] text-muted-foreground">Case {p.existingCase.ref}</p>
                          )}
                        </div>
                      </div>
                      {canAsk ? (
                        <button
                          type="button"
                          onClick={() => openTarget({ kind: "purchase", purchase: p })}
                          className="mt-3 flex min-h-[40px] w-full items-center justify-center gap-1.5 rounded-xl border border-border py-2 text-[13px] font-semibold hover:bg-muted/40"
                        >
                          <RotateCcw size={14} /> Request a refund
                        </button>
                      ) : p.existingCase ? (
                        <p className="mt-2 flex items-center gap-1.5 text-[12px] text-muted-foreground">
                          <Clock size={13} /> Already being reviewed.
                        </p>
                      ) : (
                        <p className="mt-2 text-[12px] text-muted-foreground">
                          This purchase has no unused credits to return.
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="px-5">
            <SectionHeading eyebrow="AI usage" title="Credit charges">
              {charges.length > 0 && (
                <span className="text-[11px] text-muted-foreground">{charges.length} recent</span>
              )}
            </SectionHeading>
            {charges.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                No AI credit charges yet. When a feature charges credits, the charge appears here with its delivery status.
              </div>
            ) : (
              <div className="space-y-2">
                {charges.map((c) => {
                  const canAsk =
                    !c.alreadyRefunded &&
                    !c.existingCase &&
                    c.reasons.length > 0;
                  return (
                    <div key={c.id} className="rounded-2xl border border-border bg-card p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{featureName(c.feature)}</p>
                          <p className="mt-0.5 text-[12px] text-muted-foreground">{when(c.createdAt)}</p>
                          <p className="mt-1 text-[12px] text-muted-foreground">
                            {c.jobStatus === "failed"
                              ? "Delivery failed"
                              : c.jobStatus === "delivered"
                                ? "Delivered"
                                : c.jobStatus === "started"
                                  ? "Delivery not confirmed"
                                  : "Service record unavailable"}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="font-display text-lg font-bold">-{c.credits}</p>
                          <p className="text-[11px] text-muted-foreground">credits</p>
                        </div>
                      </div>
                      {canAsk ? (
                        <button
                          type="button"
                          onClick={() => openTarget({ kind: "charge", charge: c })}
                          className="mt-3 flex min-h-[40px] w-full items-center justify-center gap-1.5 rounded-xl border border-border py-2 text-[13px] font-semibold hover:bg-muted/40"
                        >
                          <RotateCcw size={14} /> Request a refund
                        </button>
                      ) : c.alreadyRefunded ? (
                        <p className="mt-2 flex items-center gap-1.5 text-[12px] text-emerald-300">
                          <CheckCircle2 size={13} /> Credits already returned for this charge.
                        </p>
                      ) : c.existingCase ? (
                        <p className="mt-2 flex items-center gap-1.5 text-[12px] text-muted-foreground">
                          <Clock size={13} /> Case {c.existingCase.ref} is being reviewed.
                        </p>
                      ) : (
                        <p className="mt-2 text-[12px] text-muted-foreground">
                          This charge is not eligible for a self-serve request.
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="px-5">
            {options.subscription ? (
              <button
                type="button"
                onClick={() => openTarget({ kind: "subscription" })}
                className="flex w-full items-center gap-3 rounded-2xl border border-border bg-card p-4 text-left"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-secondary">
                  <Sparkles size={16} className="text-primary" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">Subscription billing</span>
                  <span className="mt-0.5 block text-[12px] text-muted-foreground">
                    A person reviews subscription refunds; the store holds the money.
                  </span>
                </span>
                <ChevronRight size={16} className="text-muted-foreground" />
              </button>
            ) : (
              <div className="rounded-2xl border border-dashed border-border p-4 text-[12px] text-muted-foreground">
                No subscription on this account. Subscription refunds are handled by the store that billed you.
              </div>
            )}
          </section>

          <section className="px-5">
            <div className="rounded-2xl border border-border bg-muted/20 p-4">
              <p className="flex items-center gap-1.5 text-[12px] font-semibold">
                <ShieldCheck size={14} className="text-primary" /> The full policy
              </p>
              <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                {options.moneyExecutionEnabled
                  ? "Unused purchased credits and failed AI services are covered by the refund policy. Money refunds are paid by the store; nothing on this screen claims money has moved."
                  : "Unused purchased credits and failed AI services are covered by the refund policy. Credits can be returned immediately, but no money can move until a payment provider is connected — an approved money refund waits for that step."}
              </p>
              <button
                type="button"
                onClick={() => navigate(legalPath("refunds"))}
                className="mt-2 inline-flex items-center gap-1 text-[12px] font-semibold text-primary"
              >
                Read Refunds &amp; Cancellation <ChevronRight size={13} />
              </button>
            </div>
          </section>
        </div>
      )}

      {/*
        The refund form lives in the app's one bottom sheet, not a hand-rolled
        `fixed inset-0` dialog.

        The hand-rolled version was the reason "Submit request" could not be
        tapped on a phone. It was anchored to the bottom of the *viewport* with
        `max-h-[88vh]` and no safe-area padding, so the action row sat exactly
        in the strip Android reserves for the gesture bar: the OS takes those
        touches before the WebView sees them, and the athlete is left pressing
        a button that never fires. `88vh` is also the largest viewport height on
        Android, which is taller than the screen whenever the keyboard is up —
        the row could be pushed off the visible area entirely while the sheet
        still claimed to fit.

        BottomSheet fixes all three at once: it is portalled to <body>
        (no ancestor stacking context can take the taps), it is `90dvh` so it
        tracks the keyboard and the system bars, and its footer is a separate
        shrink-0 row with `--vaylo-inset-bottom` padding — the primary action is
        always on screen, always above the gesture bar, and never inside the
        scrolling body. It also owns Escape, focus restore and the Android back
        button, which the bespoke overlay never handled.
      */}
      <BottomSheet
        open={target !== null}
        onClose={() => setTarget(null)}
        z="z-[70]"
        title="Refund request"
        subtitle={
          target?.kind === "charge"
            ? `${featureName(target.charge.feature)} · ${target.charge.credits} credits · ${when(target.charge.createdAt)}`
            : target?.kind === "purchase"
              ? `${target.purchase.productId.replace(/_/g, " ")} · ${money(target.purchase.priceCents, target.purchase.currency)} · ${when(target.purchase.purchasedAt)}`
              : "Subscription billing"
        }
        leading={
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10">
            <Receipt size={16} className="text-primary" aria-hidden />
          </span>
        }
        footer={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setTarget(null)} className="h-11 rounded-xl px-4">
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void submit()}
              disabled={!activeReason || submitting}
              className="h-11 flex-1 rounded-xl bg-gradient-primary font-semibold text-primary-foreground"
            >
              {submitting ? (
                <><Loader2 size={14} className="mr-1.5 animate-spin" /> Sending…</>
              ) : (
                "Submit request"
              )}
            </Button>
          </div>
        }
      >
        {target && (
          <div className="space-y-4">
            <fieldset className="space-y-2">
              <legend className="mb-1 text-[12px] font-semibold text-muted-foreground">What happened?</legend>
              {reasons.map((reason) => (
                <label
                  key={reason.code}
                  className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-3 transition-colors ${
                    reasonCode === reason.code ? "border-primary bg-primary/10" : "border-border"
                  }`}
                >
                  <input
                    type="radio"
                    name="refund-reason"
                    value={reason.code}
                    checked={reasonCode === reason.code}
                    onChange={() => setReasonCode(reason.code)}
                    className="mt-1 accent-primary"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{reason.label}</span>
                    <span className="mt-0.5 block text-[12px] leading-relaxed text-muted-foreground">{reason.hint}</span>
                  </span>
                </label>
              ))}
            </fieldset>

            <div>
              <label htmlFor="refund-details" className="mb-1 block text-[12px] font-semibold text-muted-foreground">
                Anything else we should know?{activeReason?.requiresDetails ? " (required)" : " (optional)"}
              </label>
              <Textarea
                id="refund-details"
                value={details}
                onChange={(e) => setDetails(e.target.value.slice(0, 2000))}
                placeholder="What did you expect, and what happened instead?"
                className="min-h-[96px] resize-none"
              />
              <p className="mt-1 text-right text-[11px] text-muted-foreground">{details.length}/2000</p>
            </div>

            <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
              <Receipt size={13} className="mt-0.5 shrink-0" />
              The server checks the charge, the service record and any earlier refund before deciding. A failed AI job can restore credits immediately; anything uncertain goes to a person.
            </p>
          </div>
        )}
      </BottomSheet>
    </div>
  );
}
