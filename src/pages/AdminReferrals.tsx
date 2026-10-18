import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { ChevronLeft, Settings as SettingsIcon, ListChecks, Download, Ban, CheckCircle2, XCircle, Send } from "lucide-react";

// ============================================================================
// ADMIN — referral programme console
// ----------------------------------------------------------------------------
// Every action here calls an admin-gated backend RPC: the permission check
// (has_role, admin audit trail, before/after jsonb) lives in the database
// functions, not in this screen. Hiding or showing controls is presentation
// only — a non-admin who reaches this screen gets a hard refusal from the RPC.
// ============================================================================

type Commission = {
  id: string;
  referrer_id: string;
  referee_id: string;
  purchase_id: string;
  product_kind: string;
  currency: string;
  gross_minor: number;
  net_eligible_minor: number;
  commission_minor: number;
  commission_pct: string | number;
  status: string;
  holds_until: string | null;
  cancellation_reason: string | null;
  created_at: string;
};

type Payout = {
  id: string;
  referrer_id: string;
  amount_minor: number;
  currency: string;
  status: string;
  provider: string | null;
  provider_reference: string | null;
  requested_at: string;
};

type Config = {
  enabled: boolean;
  commission_pct: string | number;
  provider_fee_pct: string | number;
  tax_pct: string | number;
  hold_days: number;
  min_payout_minor: number;
  attribution_window_days: number;
  payout_currency: string;
};

type ConfigState = {
  enabled: boolean;
  commission_pct: string;
  provider_fee_pct: string;
  tax_pct: string;
  hold_days: string;
  min_payout_minor: string;
  attribution_window_days: string;
};

const money = (v: string | number | null | undefined) =>
  `£${(Number(v ?? 0) / 100).toFixed(2)}`;

type SoftResult = { data: unknown; error: unknown };

// The generated Database types don't know the recently migrated referral
// tables yet. Cast through a string-typed from() like api.ts rawFrom(): a
// chained builder with an `as never` literal name explodes TS's generics
// (TS2589), so the boundary is loosened once, here, and re-typed immediately
// after the call.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyFrom = (table: string) => (supabase as any).from(table) as { select: (cols: string) => { limit: (n: number) => { maybeSingle: () => Promise<SoftResult> } } };

export default function AdminReferrals() {
  const navigate = useNavigate();
  const [config, setConfig] = useState<ConfigState | null>(null);
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setDenied(false);
    // The generated types don't know the new referral tables/RPCs yet, so each
    // call is cast at the boundary — the same pattern Referrals, Goals and the
    // XP module use for recently migrated tables.
    const cfgPromise = anyFrom("referral_commission_config").select("*").limit(1).maybeSingle();
    const commPromise = supabase.rpc("referral_admin_commissions_list" as never) as unknown as Promise<SoftResult>;
    const payPromise = supabase.rpc("referral_admin_payouts_list" as never) as unknown as Promise<SoftResult>;
    const [cfgRes0, commRes0, payRes0] = await Promise.all([cfgPromise, commPromise, payPromise]);
    const cfgRes = cfgRes0 as unknown as { data: Config | null; error: { message: string } | null };
    const commRes = commRes0 as unknown as { data: Commission[] | null; error: { message: string } | null };
    const payRes = payRes0 as unknown as { data: Payout[] | null; error: { message: string } | null };
    if (cfgRes.error || commRes.error || payRes.error) {
      const msg = cfgRes.error?.message ?? commRes.error?.message ?? payRes.error?.message;
      // Postgres throws a plain 'Referral admin action denied' from the RPC —
      // show that as an explicit "no access" state, not as a listener crash.
      if (/denied/i.test(String(msg))) {
        setDenied(true);
      } else {
        toast.error(`Failed to load referral admin data: ${msg}`);
      }
      setLoading(false);
      return;
    }
    const c = cfgRes.data;
    if (c) {
      setConfig({
        enabled: c.enabled,
        commission_pct: String(c.commission_pct),
        provider_fee_pct: String(c.provider_fee_pct),
        tax_pct: String(c.tax_pct),
        hold_days: String(c.hold_days),
        min_payout_minor: String(c.min_payout_minor),
        attribution_window_days: String(c.attribution_window_days),
      });
    }
    setCommissions(commRes.data ?? []);
    setPayouts(payRes.data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saveConfig = async () => {
    if (!config) return;
    setBusy("config");
    const { data, error } = await supabase.rpc("referral_admin_configure" as never, {
      p_enabled: config.enabled,
      p_commission_pct: Number(config.commission_pct),
      p_provider_fee_pct: Number(config.provider_fee_pct),
      p_tax_pct: Number(config.tax_pct),
      p_hold_days: Number(config.hold_days),
      p_min_payout_minor: Number(config.min_payout_minor),
      p_attribution_window_days: Number(config.attribution_window_days),
    } as never);
    setBusy(null);
    const r = (data ?? {}) as { ok?: boolean };
    if (error || r.ok !== true) {
      toast.error(error?.message ?? "Save failed — check your admin role.");
      return;
    }
    toast.success("Referral settings saved (audited)");
    void load();
  };

  const decide = async (payoutId: string, action: "approve" | "mark_paid" | "reject") => {
    if (action === "mark_paid") {
      const provider = window.prompt("Provider (which actually moved the money), e.g. 'bank_transfer':");
      if (!provider?.trim()) return;
      const reference = window.prompt("The real transfer reference recorded with the provider:");
      if (!reference?.trim()) return;
      setBusy(payoutId);
      const { error } = await supabase.rpc("referral_admin_payout_decide" as never, {
        p_payout_id: payoutId,
        p_action: "mark_paid",
        p_provider: provider.trim(),
        p_provider_reference: reference.trim(),
      } as never);
      setBusy(null);
      if (error) { toast.error(error.message); return; }
      toast.success("Payout recorded as paid with the provider reference");
    } else if (action === "reject") {
      if (!rejectReason.trim()) { toast.error("A rejection must state a reason."); return; }
      setBusy(payoutId);
      const { error } = await supabase.rpc("referral_admin_payout_decide" as never, {
        p_payout_id: payoutId,
        p_action: "reject",
        p_reason: rejectReason.trim(),
      } as never);
      setBusy(null);
      if (error) { toast.error(error.message); return; }
      toast.success("Payout rejected (audited)");
      setRejectReason("");
    } else {
      setBusy(payoutId);
      const { error } = await supabase.rpc("referral_admin_payout_decide" as never, {
        p_payout_id: payoutId,
        p_action: "approve",
      } as never);
      setBusy(null);
      if (error) { toast.error(error.message); return; }
      toast.success("Payout approved — execution and the provider reference are recorded separately");
    }
    void load();
  };

  const cancelCommission = async (commissionId: string) => {
    const reason = window.prompt("Reason for cancelling this commission (refund, chargeback, fraud review, admin decision):");
    if (!reason?.trim()) return;
    setBusy(commissionId);
    const { error } = await supabase.rpc("referral_admin_cancel_commission" as never, {
      p_commission_id: commissionId,
      p_reason: reason.trim(),
    } as never);
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    toast.success("Commission cancelled (audited)");
    void load();
  };

  const exportCsv = async () => {
    setBusy("export");
    const { data, error } = await supabase.rpc("referral_admin_commissions_export" as never);
    setBusy(null);
    if (error || !data) { toast.error(error?.message ?? "Export failed"); return; }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `referral-reconciliation-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Reconciliation export downloaded");
  };

  const statusColor = (s: string) =>
    s === "paid" ? "text-energy" : s === "cancelled" || s === "rejected" ? "text-destructive" : "text-muted-foreground";

  if (loading) {
    return (
      <div className="px-5 pt-[var(--vaylo-screen-top)] pb-24 max-w-3xl mx-auto">
        <p className="text-sm text-muted-foreground">Loading referral admin…</p>
      </div>
    );
  }

  if (denied) {
    return (
      <div className="px-5 pt-[var(--vaylo-screen-top)] pb-24 max-w-3xl mx-auto">
        <h1 className="text-xl font-bold mb-2">Referral admin</h1>
        <p className="text-sm text-destructive">Your account does not have admin access. Nothing was loaded.</p>
      </div>
    );
  }

  return (
    <div className="px-5 pt-[var(--vaylo-screen-top)] pb-24 max-w-3xl mx-auto">
      <button onClick={() => navigate(-1)} className="mb-4 flex items-center gap-1 text-sm text-muted-foreground" aria-label="Back">
        <ChevronLeft size={16} /> Back
      </button>
      <h1 className="text-xl font-bold flex items-center gap-2 mb-4">
        <Send className="h-5 w-5 text-primary" /> Referral programme admin
      </h1>

      {/* Configuration — every value audited server-side on save */}
      <div className="rounded-2xl border border-border bg-card p-4 mb-6">
        <p className="font-semibold mb-3 flex items-center gap-2"><SettingsIcon size={15} /> Settings</p>
        {config && (
          <div className="grid grid-cols-2 gap-3 text-sm">
            <label className="flex flex-col gap-1 col-span-2">
              <span className="text-xs text-muted-foreground">Programme enabled</span>
              <Button
                variant={config.enabled ? "default" : "outline"}
                size="sm"
                className="w-full"
                onClick={() => setConfig({ ...config, enabled: !config.enabled })}
              >
                {config.enabled ? "Enabled" : "Disabled"}
              </Button>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Commission %</span>
              <Input value={config.commission_pct} onChange={(e) => setConfig({ ...config, commission_pct: e.target.value })} inputMode="decimal" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Hold days</span>
              <Input value={config.hold_days} onChange={(e) => setConfig({ ...config, hold_days: e.target.value })} inputMode="numeric" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Provider fee % (not kept)</span>
              <Input value={config.provider_fee_pct} onChange={(e) => setConfig({ ...config, provider_fee_pct: e.target.value })} inputMode="decimal" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Tax % (not kept)</span>
              <Input value={config.tax_pct} onChange={(e) => setConfig({ ...config, tax_pct: e.target.value })} inputMode="decimal" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Min payout (minor units)</span>
              <Input value={config.min_payout_minor} onChange={(e) => setConfig({ ...config, min_payout_minor: e.target.value })} inputMode="numeric" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Attribution window days</span>
              <Input value={config.attribution_window_days} onChange={(e) => setConfig({ ...config, attribution_window_days: e.target.value })} inputMode="numeric" />
            </label>
            <div className="col-span-2">
              <Button onClick={saveConfig} disabled={busy === "config"} className="w-full">Save settings</Button>
            </div>
          </div>
        )}
      </div>

      {/* Payout requests */}
      <div className="rounded-2xl border border-border bg-card p-4 mb-6">
        <p className="font-semibold mb-3 flex items-center gap-2"><ListChecks size={15} /> Payout requests ({payouts.length})</p>
        {payouts.length === 0 && <p className="text-sm text-muted-foreground">No payout requests yet.</p>}
        <ul className="space-y-2">
          {payouts.map((p) => (
            <li key={p.id} className="rounded-xl border border-border p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs">{p.referrer_id.slice(0, 8)}…</span>
                <span className={`font-bold ${statusColor(p.status)}`}>{p.status}</span>
              </div>
              <p className="mt-1">{money(p.amount_minor)} · {new Date(p.requested_at).toLocaleDateString()}</p>
              {p.provider_reference && (
                <p className="mt-1 text-xs text-muted-foreground font-mono break-all">
                  {p.provider}: {p.provider_reference}
                </p>
              )}
              {p.status === "pending_review" && (
                <>
                  <Input
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="Rejection reason (required for reject)"
                    className="mt-2 text-xs"
                  />
                  <div className="flex gap-2 mt-2">
                    <Button size="sm" onClick={() => decide(p.id, "approve")} disabled={busy === p.id}>
                      <CheckCircle2 size={13} /> Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="default"
                      onClick={() => decide(p.id, "mark_paid")}
                      disabled={busy === p.id}
                    >
                      <Send size={13} /> Record as paid
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => decide(p.id, "reject")} disabled={busy === p.id || !rejectReason.trim()}>
                      <XCircle size={13} /> Reject
                    </Button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      </div>

      {/* Commissions */}
      <div className="rounded-2xl border border-border bg-card p-4 mb-6">
        <div className="flex items-center justify-between mb-3">
          <p className="font-semibold flex items-center gap-2"><ListChecks size={15} /> Commissions ({commissions.length})</p>
          <Button size="sm" variant="outline" onClick={exportCsv} disabled={busy === "export"}>
            <Download size={13} /> Export
          </Button>
        </div>
        {commissions.length === 0 && <p className="text-sm text-muted-foreground">No commissions recorded yet.</p>}
        <ul className="space-y-2">
          {commissions.slice(0, 30).map((c) => (
            <li key={c.id} className="rounded-xl border border-border p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs">{c.referrer_id.slice(0, 8)}…→{c.referee_id.slice(0, 8)}…</span>
                <span className={`font-bold ${statusColor(c.status)}`}>{c.status}</span>
              </div>
              <p className="mt-1">
                gross {money(c.gross_minor)} → net {money(c.net_eligible_minor)} ·{" "}
                {Number(c.commission_pct)}% = <span className="font-bold">{money(c.commission_minor)}</span> {c.currency}
              </p>
              <p className="text-xs text-muted-foreground">
                {c.product_kind} · purchased {new Date(c.created_at).toLocaleDateString()}
                {c.holds_until && c.status === "pending" ? ` · hold ends ${new Date(c.holds_until).toLocaleDateString()}` : ""}
                {c.cancellation_reason ? ` · cancelled: ${c.cancellation_reason}` : ""}
              </p>
              {c.status !== "cancelled" && c.status !== "paid" && (
                <Button size="sm" variant="outline" className="mt-2" onClick={() => cancelCommission(c.id)} disabled={busy === c.id}>
                  <Ban size={13} /> Cancel (refunds / fraud)
                </Button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
