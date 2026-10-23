import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ClipboardList,
  Clock,
  Loader2,
  MailCheck,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  decideAdminRefund,
  getAdminRefund,
  listAdminRefunds,
  retryAdminRefundNotification,
  statusLabel,
  statusTone,
  type AdminRefundDetail,
} from "@/lib/refunds";

// ============================================================================
// ADMIN — refund review desk
// ----------------------------------------------------------------------------
// The screen that the emailed secure link opens (`/admin/refunds?case=RF-...`).
// It is wrapped in RequireAdmin and every action calls refund-admin, which
// re-checks has_role() server-side and writes through SECURITY DEFINER RPCs that
// lock the case row. This component decides nothing: it presents the facts the
// server assembled and offers two explicit verbs.
//
// The two confirmations exist because both operations are financial records. A
// single stray tap must not approve money, and a rejection must carry a reason
// the customer can read.
// ============================================================================

type Filter = "open" | "awaiting_provider" | "completed" | "declined" | "all";

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: "open", label: "Needs review" },
  { key: "awaiting_provider", label: "Awaiting provider" },
  { key: "completed", label: "Completed" },
  { key: "declined", label: "Declined" },
  { key: "all", label: "All" },
];

const money = (cents: number | null | undefined, currency: string) => {
  if (cents == null) return "—";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "USD" }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
};

const when = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
};

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words text-sm">{children}</dd>
    </div>
  );
}

export default function AdminRefunds() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const ref = params.get("case");

  const [filter, setFilter] = useState<Filter>("open");
  const [cases, setCases] = useState<AdminRefundDetail["case"][]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [detail, setDetail] = useState<AdminRefundDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [confirmApprove, setConfirmApprove] = useState(false);
  const [confirmReject, setConfirmReject] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"approve" | "reject" | "notify" | null>(null);

  const loadList = useCallback(async () => {
    setListLoading(true);
    setListError(null);
    try {
      const res = await listAdminRefunds(filter);
      setCases(res.cases);
    } catch (error) {
      setListError(error instanceof Error ? error.message : "Could not read refund cases.");
    } finally {
      setListLoading(false);
    }
  }, [filter]);

  const loadDetail = useCallback(async (caseRef: string) => {
    setDetailLoading(true);
    setDetailError(null);
    try {
      const res = await getAdminRefund(caseRef);
      setDetail(res);
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : "That case could not be loaded.");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    setConfirmApprove(false);
    setConfirmReject(false);
    setRejectReason("");
    setNote("");
    if (!ref) {
      setDetail(null);
      return;
    }
    void loadDetail(ref);
  }, [loadDetail, ref]);

  const openCase = (caseRef: string) => {
    const next = new URLSearchParams(params);
    next.set("case", caseRef);
    setParams(next, { replace: false });
  };

  const closeCase = () => {
    const next = new URLSearchParams(params);
    next.delete("case");
    setParams(next, { replace: false });
  };

  const refresh = async (caseRef: string) => {
    await Promise.all([loadDetail(caseRef), loadList()]);
  };

  const approve = async () => {
    if (!detail) return;
    setBusy("approve");
    try {
      const res = await decideAdminRefund(detail.case.public_ref, "approve", note.trim() || undefined);
      toast.success(res.message);
      if (res.moneyMoved === false) {
        toast.info("No money has moved — the case is recorded as awaiting the payment provider.");
      }
      setConfirmApprove(false);
      await refresh(detail.case.public_ref);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The approval could not be recorded.");
      await refresh(detail.case.public_ref);
    } finally {
      setBusy(null);
    }
  };

  const reject = async () => {
    if (!detail) return;
    if (rejectReason.trim().length < 3) {
      toast.error("A reason is required to reject a request.");
      return;
    }
    setBusy("reject");
    try {
      const res = await decideAdminRefund(detail.case.public_ref, "reject", rejectReason.trim());
      toast.success(res.message);
      setConfirmReject(false);
      setRejectReason("");
      await refresh(detail.case.public_ref);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The rejection could not be recorded.");
      await refresh(detail.case.public_ref);
    } finally {
      setBusy(null);
    }
  };

  const retryNotifications = async () => {
    if (!detail) return;
    setBusy("notify");
    try {
      const res = await retryAdminRefundNotification(detail.case.public_ref);
      if (res.attempted === 0) toast.info("No email was waiting to be sent.");
      else if (res.failed > 0) toast.error(`Sent ${res.sent}, still failing ${res.failed}. The case is unchanged.`);
      else toast.success(`Sent ${res.sent} email${res.sent === 1 ? "" : "s"}.`);
      await refresh(detail.case.public_ref);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The email could not be retried.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="px-5 pt-[var(--vaylo-screen-top)] pb-24 max-w-4xl mx-auto">
      <button
        onClick={() => navigate("/")}
        className="mb-4 flex items-center gap-1 text-sm text-muted-foreground"
        aria-label="Back to the app"
      >
        <ChevronLeft size={16} /> Back
      </button>

      <h1 className="text-xl font-bold flex items-center gap-2">
        <ClipboardList className="h-5 w-5 text-primary" aria-hidden /> Refund review
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Decisions here are recorded with your administrator identity. Monetary refunds only move
        when a verified payment provider executes them; until then an approval is recorded as
        awaiting the provider.
      </p>

      {!ref ? (
        <>
          <div className="mt-4 flex flex-wrap gap-2" role="tablist" aria-label="Filter cases">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                role="tab"
                aria-selected={filter === f.key}
                onClick={() => setFilter(f.key)}
                className={`rounded-xl border px-3 py-2 text-xs font-semibold ${
                  filter === f.key
                    ? "border-primary/40 bg-primary/15 text-primary"
                    : "border-border bg-card text-muted-foreground"
                }`}
              >
                {f.label}
              </button>
            ))}
            <Button size="sm" variant="outline" onClick={() => void loadList()} disabled={listLoading}>
              <RefreshCw size={13} className={listLoading ? "animate-spin" : ""} /> Refresh
            </Button>
          </div>

          {listError && (
            <p className="mt-4 rounded-2xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {listError}
            </p>
          )}

          <ul className="mt-4 space-y-2">
            {listLoading && cases.length === 0 && (
              <li className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 size={14} className="animate-spin" /> Loading cases…
              </li>
            )}
            {!listLoading && cases.length === 0 && !listError && (
              <li className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">
                No cases in this filter.
              </li>
            )}
            {cases.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => openCase(c.public_ref)}
                  className="w-full rounded-2xl border border-border bg-card p-4 text-left hover:border-primary/30"
                >
                  <span className="flex flex-wrap items-start justify-between gap-2">
                    <span className="min-w-0">
                      <span className="block font-mono text-xs text-muted-foreground">{c.public_ref}</span>
                      <span className="mt-1 block text-sm font-semibold">
                        {c.kind === "credits"
                          ? `${c.credits_requested ?? 0} credits · ${c.feature?.replace(/_/g, " ") ?? "AI service"}`
                          : `${money(c.amount_cents, c.currency)} · ${c.kind}`}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {c.reason_code} · opened {when(c.created_at)}
                      </span>
                    </span>
                    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusTone(c.status)}`}>
                      {statusLabel(c.status)}
                    </span>
                  </span>
                  {c.escalation_rules?.length > 0 && (
                    <span className="mt-2 block text-[11px] text-amber-300">
                      Escalated by: {c.escalation_rules.join(", ")}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <div className="mt-4 flex items-center justify-between gap-2">
            <button type="button" onClick={closeCase} className="text-xs font-semibold text-primary hover:underline">
              ← All cases
            </button>
            <Button size="sm" variant="outline" onClick={() => void refresh(ref)} disabled={detailLoading}>
              <RefreshCw size={13} className={detailLoading ? "animate-spin" : ""} /> Refresh
            </Button>
          </div>

          {detailError && (
            <p className="mt-4 rounded-2xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {detailError}
            </p>
          )}

          {detailLoading && !detail && (
            <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 size={14} className="animate-spin" /> Loading case…
            </p>
          )}

          {detail && (
            <div className="mt-4 space-y-4">
              {/* Headline */}
              <section className="rounded-2xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-mono text-xs text-muted-foreground">{detail.case.public_ref}</p>
                    <h2 className="mt-1 text-lg font-bold">
                      {detail.case.kind === "credits"
                        ? `Return ${detail.case.credits_requested ?? 0} credits`
                        : detail.case.kind === "money"
                          ? `Monetary refund ${money(detail.case.amount_cents, detail.case.currency)}`
                          : "Subscription refund"}
                    </h2>
                  </div>
                  <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${statusTone(detail.case.status)}`}>
                    {statusLabel(detail.case.status)}
                  </span>
                </div>

                <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Fact label="Case ID">{detail.case.public_ref}</Fact>
                  <Fact label="User ID">
                    <span className="font-mono text-xs">{detail.case.user_id}</span>
                  </Fact>
                  <Fact label="Transaction reference">
                    <span className="font-mono text-xs">
                      {detail.charge?.idempotency_key ??
                        detail.purchase?.provider_reference ??
                        detail.purchase?.id ??
                        detail.case.id}
                    </span>
                  </Fact>
                  <Fact label="Transaction type">{detail.case.source_type.replace(/_/g, " ")}</Fact>
                  <Fact label="Requested">
                    {detail.case.kind === "credits"
                      ? `${detail.case.credits_requested ?? 0} credits`
                      : money(detail.case.amount_cents, detail.case.currency)}
                  </Fact>
                  <Fact label="Reason">{detail.case.reason_code.replace(/_/g, " ")}</Fact>
                  <Fact label="Opened">{when(detail.case.created_at)}</Fact>
                  <Fact label="Decided / completed">
                    {when(detail.case.decided_at)} / {when(detail.case.completed_at)}
                  </Fact>
                </dl>

                {detail.case.details && (
                  <p className="mt-3 rounded-xl border border-border bg-background/60 p-3 text-sm">
                    <span className="font-semibold">Athlete's words: </span>
                    {detail.case.details}
                  </p>
                )}

                <div className="mt-3 rounded-xl border border-amber-500/25 bg-amber-500/10 p-3">
                  <p className="flex items-center gap-2 text-xs font-semibold text-amber-200">
                    <AlertTriangle size={14} aria-hidden /> Why this needs a person
                  </p>
                  <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-amber-200/90">
                    {(detail.case.escalation_rules ?? []).map((rule) => (
                      <li key={rule}>{rule}</li>
                    ))}
                    {detail.case.escalation_rules?.length === 0 && <li>no rule recorded</li>}
                  </ul>
                </div>
              </section>

              {/* Delivery + ledger facts */}
              <section className="rounded-2xl border border-border bg-card p-4">
                <h3 className="text-sm font-bold mb-3">What the system knows</h3>
                <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Fact label="Service delivery">
                    {detail.serviceJob
                      ? `${detail.serviceJob.feature} · ${detail.serviceJob.status}${
                          detail.serviceJob.error_code ? ` (${detail.serviceJob.error_code})` : ""
                        }`
                      : detail.case.kind === "credits"
                        ? "No service job recorded (charge predates the job ledger)"
                        : "Not an AI service"}
                  </Fact>
                  <Fact label="Charge">
                    {detail.charge
                      ? `${detail.charge.amount} credits · ${detail.charge.source} · ${when(detail.charge.created_at)}`
                      : "—"}
                  </Fact>
                  <Fact label="Credits already restored">
                    {detail.refundGrants.length === 0
                      ? "None"
                      : detail.refundGrants
                          .map((g) => `${g.amount} on ${when(g.created_at)} (${g.source})`)
                          .join("; ")}
                  </Fact>
                  <Fact label="Purchase">
                    {detail.purchase
                      ? `${detail.purchase.product_id} · ${money(detail.purchase.price_cents, detail.purchase.currency)} · ${detail.purchase.platform ?? "unknown platform"}`
                      : "—"}
                  </Fact>
                  <Fact label="Payment provider">
                    {detail.provider.configured
                      ? `${detail.provider.id} (${detail.provider.canInitiateRefund ? "can refund" : "cannot refund"})`
                      : "Not connected — money cannot move"}
                  </Fact>
                  <Fact label="Previous refunds">
                    {detail.history.length === 0
                      ? "None"
                      : detail.history
                          .slice(0, 5)
                          .map((h) => `${h.public_ref} ${h.status}`)
                          .join("; ")}
                  </Fact>
                </dl>
              </section>

              {/* Timeline */}
              <section className="rounded-2xl border border-border bg-card p-4">
                <h3 className="text-sm font-bold mb-2">Audit timeline</h3>
                <ol className="space-y-1.5">
                  {detail.events.map((event, i) => (
                    <li key={`${event.event}-${i}`} className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
                      <span>
                        <span className="font-semibold">{event.event.replace(/_/g, " ")}</span>{" "}
                        <span className="text-muted-foreground">
                          · {event.actor_type}
                          {event.actor_id ? ` (${event.actor_id.slice(0, 8)}…)` : ""}
                        </span>
                      </span>
                      <span className="text-muted-foreground">{when(event.created_at)}</span>
                    </li>
                  ))}
                </ol>
              </section>

              {/* Decision */}
              <section className="rounded-2xl border border-border bg-card p-4">
                <h3 className="flex items-center gap-2 text-sm font-bold">
                  <ShieldCheck size={15} className="text-primary" aria-hidden /> Decision
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">{detail.actions.approveOperation}</p>

                {detail.actions.canApprove || detail.actions.canReject ? (
                  <>
                    <label htmlFor="admin-note" className="mt-3 block text-xs font-semibold text-muted-foreground">
                      Note (optional; shown to the customer on a rejection)
                    </label>
                    <Textarea
                      id="admin-note"
                      value={note}
                      onChange={(e) => setNote(e.target.value.slice(0, 2000))}
                      rows={3}
                      maxLength={2000}
                      className="mt-1"
                      placeholder="What you checked, and what you decided."
                    />

                    <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {!confirmApprove ? (
                        <Button
                          onClick={() => setConfirmApprove(true)}
                          disabled={!detail.actions.canApprove || busy !== null}
                        >
                          <CheckCircle2 size={15} /> APPROVE
                        </Button>
                      ) : (
                        <Button onClick={() => void approve()} disabled={busy !== null} variant="default">
                          {busy === "approve" ? (
                            <Loader2 size={15} className="animate-spin" />
                          ) : (
                            <CheckCircle2 size={15} />
                          )}
                          Confirm approve
                        </Button>
                      )}

                      {!confirmReject ? (
                        <Button
                          variant="outline"
                          onClick={() => setConfirmReject(true)}
                          disabled={!detail.actions.canReject || busy !== null}
                        >
                          <XCircle size={15} /> REJECT
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          onClick={() => void reject()}
                          disabled={busy !== null || rejectReason.trim().length < 3}
                        >
                          {busy === "reject" ? <Loader2 size={15} className="animate-spin" /> : <XCircle size={15} />}
                          Confirm reject
                        </Button>
                      )}
                    </div>

                    {confirmApprove && (
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        This will {detail.case.kind === "credits" ? "restore credits to the athlete's ledger now" : "record an approval; no money moves until a provider executes it"}.
                        {confirmReject && " Cancel by choosing Reject or refreshing."}
                      </p>
                    )}

                    {confirmReject && (
                      <div className="mt-2">
                        <label htmlFor="reject-reason" className="block text-xs font-semibold text-muted-foreground">
                          Reason for rejection (required, sent to the customer)
                        </label>
                        <Textarea
                          id="reject-reason"
                          value={rejectReason}
                          onChange={(e) => setRejectReason(e.target.value.slice(0, 2000))}
                          rows={2}
                          maxLength={2000}
                          className="mt-1"
                        />
                      </div>
                    )}
                  </>
                ) : (
                  <p className="mt-2 rounded-xl border border-border bg-background/60 p-3 text-xs text-muted-foreground">
                    This case is closed. No further decision can be recorded; the audit history above is final.
                  </p>
                )}

                <div className="mt-4 border-t border-white/[0.06] pt-3">
                  <Button size="sm" variant="outline" onClick={() => void retryNotifications()} disabled={busy !== null}>
                    {busy === "notify" ? <Loader2 size={13} className="animate-spin" /> : <MailCheck size={13} />}
                    Retry unsent email
                  </Button>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Only notifications still pending or failed are retried. The case itself is
                    stored before any email is attempted, so a mail failure never loses it.
                  </p>
                </div>
              </section>

              <p className="flex items-start gap-2 text-[11px] text-muted-foreground">
                <Clock size={12} className="mt-0.5 shrink-0" />
                Approving or rejecting is recorded with your administrator ID, the decision and its
                timestamp. Repeating the same action does not repeat the financial operation.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
