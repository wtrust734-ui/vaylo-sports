import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ShieldAlert, AlertTriangle, CheckCircle2, Loader2, Plus, Sparkles, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { analyzeLoads, type LoadRow } from "@/lib/performance";
import { creditCost } from "@/lib/credits";
import { edgeErrorMessage } from "@/lib/edgeErrors";
import { shortfallFromEdgeError } from "@/lib/shortfall";
import { requestCreditTopUp } from "@/lib/topUpStore";
import { getAiLocale } from "@/i18n";
import { getLocalPBs } from "@/lib/athleteDossier";
import {
  buildInjuryBriefing,
  freeInjuryProtocol,
  MEDICAL_REFERRAL_MARKER,
  PERSONALISED_PLAN_MARKER,
  hasSeriousSymptomSignals,
  MAX_SITE_LENGTH,
  parseInjuryPlan,
  planHeadline,
  renderInjuryProtocol,
  resolveInjurySite,
  splitStoredProtocol,
  SERIOUS_SEVERITY,
} from "@/lib/injuryPlan";
import { useUnlockFeature } from "@/hooks/useUnlockFeature";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, ReferenceLine } from "recharts";

const BODY_PARTS = ["Knee", "Hamstring", "Calf", "Achilles", "Foot/Ankle", "Hip", "Lower Back", "Shoulder", "Elbow", "Wrist", "Other"];

// The free, conservative, visible scaffold moved into `@/lib/injuryPlan`: genericScaffoldFor/freeInjuryProtocol.
// The old in-page scaffolds were fixed week-by-week timelines with built-in
// return-to-sport progressions ("Week 3+: build to sprints, add 10% per
// session") written identically for every severity — a prescription the app
// had no basis for. What the app can honestly hand out free is the general
// pattern of care per body area, pain-rule-gated progression and red flags;
// that is what freeInjuryProtocol now writes, with a medical referral text in
// place of any scaffold when the report carries serious signals.

const Injury = () => {
  const { user, profile, refreshProfile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [loads, setLoads] = useState<LoadRow[]>([]);
  type RecoveryRow = { fatigue?: number | null; soreness?: number | null; sleep_quality?: number | null; [key: string]: unknown };
  type InjuryRow = { id: string; status: string; body_part: string; severity: number; notes?: string | null; recovery_protocol?: string | null; [key: string]: unknown };
  const [recovery, setRecovery] = useState<RecoveryRow[]>([]);
  const [injuries, setInjuries] = useState<InjuryRow[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ body_part: "Knee", severity: 3, notes: "" });
  // The athlete's own words for a site the list cannot name. The list is a set of
  // shortcuts, not the set of injuries that exist: everything else used to be
  // collapsed to "Other" on save, which threw away the one detail that makes a
  // plan specific — a rehabilitation scaffold written for "Other, severity 4" is
  // a plan for nobody.
  const [otherSite, setOtherSite] = useState("");
  const [planningId, setPlanningId] = useState<string | null>(null);
  // The injury whose personalised plan is being written right now. One at a
  // time: a double tap used to be two paid calls.
  const [submitting, setSubmitting] = useState(false);
  // One in-flight destructive mutation at a time — a status change and a plan
  // generation are the two writes on this tab, and a double-tap on either
  // used to fire two of both.
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  const unlock = useUnlockFeature();
  const { hasFeature, loading: entitlementsLoading, refresh: refreshEntitlements } = useSubscription();

  // Access comes from the shared entitlement check, not a query of this page's
  // own. hasFeature() is true for a bought unlock AND for Unlimited, and it is
  // the same fact the Market and every other locked screen read — so a
  // purchase stays visible on every visit, on every device, not just once.
  const unlocked = hasFeature("injury_management");

  // Everything on this tab is computed on the device (load ratios from your
  // own logs, static recovery scaffolds): no AI call, no provider cost, and
  // therefore no per-use charge. If an AI-backed assessment is ever added, it
  // must carry its own per-use credit price like every other AI feature.

  useEffect(() => { if (user) load(); }, [user]);
  const load = async () => {
    if (!user) return;
    const [l, r, i] = await Promise.all([
      supabase.from("training_loads").select("*").eq("user_id", user.id).order("log_date").limit(60),
      supabase.from("recovery_logs").select("*").eq("user_id", user.id).order("log_date", { ascending: false }).limit(14),
      supabase.from("injury_logs").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
    ]);
    setLoads(l.data || []);
    setRecovery(r.data || []);
    setInjuries(i.data || []);
    setLoading(false);
  };

  const unlockInjury = async () => {
    if (!user || !profile) return;
    setUnlocking(true);
    try {
      // Entitlements are granted SERVER-side, through the same checkout every
      // other purchase uses. This previously spent the credits and then inserted
      // the `user_purchases` row from the browser *ignoring the result*, so the
      // page reported "unlocked" even when nothing was recorded. Because
      // `user_purchases` also accepted client inserts for any product id, the
      // entitlement itself was forgeable without paying. process-purchase reads
      // the price from the database, spends the credits and records the unlock.
      //
      // The hook rather than a bare purchaseItems call: this was the only
      // feature that could actually be bought, and it was also the only one
      // that dead-ended at "not enough credits". useUnlockFeature turns the
      // shortfall into a top-up for the exact gap and retries, which is what
      // the other two locked features now do too.
      const res = await unlock("injury_management");
      if (res.status === "failed") { toast.error(res.error || "Could not unlock Injury Management"); return; }
      // Entitlements and the credit balance are two separate reads: refresh
      // both so the tab stays open and the balance drops together. Reading
      // access back through hasFeature() (above) is what keeps the purchase
      // visible on every later visit instead of just this one.
      await Promise.all([refreshEntitlements(), refreshProfile()]);
      toast.success("Injury Management unlocked!");
    } catch (e) {
      toast.error(e.message || "Failed to unlock");
    } finally { setUnlocking(false); }
  };

  const analysis = analyzeLoads(loads);
  const avgFatigue = recovery.length ? recovery.reduce((a, b) => a + (b.fatigue || 5), 0) / recovery.length : 5;
  const avgSoreness = recovery.length ? recovery.reduce((a, b) => a + (b.soreness || 5), 0) / recovery.length : 5;
  const avgSleep = recovery.length ? recovery.reduce((a, b) => a + (b.sleep_quality || 5), 0) / recovery.length : 5;

  // Training-strain score 0-100.
  //
  // The arithmetic is unchanged and the screen still shows a number: what
  // changed in Phase 7 is what the number CLAIMS to be. Nothing here has been
  // validated against an injury outcome, so printing "Current Risk: HIGH RISK"
  // would be a medical finding invented from a load ratio. It is a strain
  // reading built from the athlete's own log, labelled as one, with the same
  // "training measure, not a medical assessment" line /metrics uses.
  let risk = 0;
  if (analysis.ratio > 1.5) risk += 35; else if (analysis.ratio > 1.3) risk += 20;
  if (analysis.sprintShare > 0.5) risk += 15;
  if (avgFatigue > 7) risk += 15;
  if (avgSoreness > 7) risk += 15;
  if (avgSleep < 4) risk += 10;
  if (injuries.filter((i) => isRestrictingStatus(i.status)).length > 0) risk += 20;
  risk = Math.min(100, risk);

  const riskTier = risk >= 65 ? { label: "HEAVY LOAD", color: "destructive", action: "Reduce load 30% for 5 days. Add 2 mobility sessions." }
    : risk >= 40 ? { label: "BUILDING", color: "energy", action: "Cap intensity below 80%. Prioritize sleep & soft-tissue work." }
    : { label: "STEADY", color: "primary", action: "Keep current load. Maintain mobility routine." };

  const submitInjury = async () => {
    if (!user || submitting) return;
    // Mirror the injury_logs DB checks: severity 1–10, closed status set,
    // body part from the product list, bounded note length. A malicious or
    // broken client cannot store a fabricated status/severity combination.
    const severity = Math.max(1, Math.min(10, Math.round(Number(form.severity) || 1)));
    // How the injury is described IS the briefing the paid plan is written from,
    // so the athlete's own words are kept when they gave them (see
    // resolveInjurySite, which is where that rule is tested).
    const bodyPart = resolveInjurySite({ listed: form.body_part, typed: otherSite, known: BODY_PARTS });
    const notes = (form.notes || "").replace(/\p{C}/gu, " ").slice(0, 1000) || null;
    // The safety gate, BEFORE anything is written with the athlete's own
    // words: a severity at the top of the scale, or a note carrying one of
    // the serious-symptom signals, stores the medical-referral text instead
    // of a scaffold — the app declines to be the clinician here.
    const protocol = freeInjuryProtocol({ bodyPart, severity, reported: notes });
    const status = "active";
    setSubmitting(true);
    const { error } = await supabase.from("injury_logs").insert({
      user_id: user.id,
      body_part: bodyPart,
      severity,
      status,
      notes,
      recovery_protocol: protocol.lines.join("\n"),
    });
    setSubmitting(false);
    if (error) { toast.error(error.message); return; }
    if (protocol.referral) {
      toast.error("Injury logged — please get this assessed by a physiotherapist or doctor before any training plan.");
    } else {
      toast.success("Injury logged — a free conservative scaffold is below. A personalised plan costs credits.");
    }
    setShowForm(false); setForm({ body_part: "Knee", severity: 3, notes: "" }); setOtherSite(""); load();
  };

  // The status vocabulary the whole app supports. Four states, four honest
  // readings: active (this restricts training), improving (getting better —
  // still restricts, with a reduced dose), reassess (something changed
  // and a professional should look again — still restricts), resolved (no
  // restriction). "Resolved" is only ever set deliberately by the athlete:
  // nothing here auto-resolves after a fixed period, and a feel-better report
  // is not a resolution, it is a status the athlete records deliberately.
  const INJURY_STATUSES = [
    { value: "active", label: "Active" },
    { value: "improving", label: "Improving" },
    { value: "reassess", label: "Needs reassessment" },
    { value: "resolved", label: "Resolved" },
  ] as const;
  const isRestrictingStatus = (status: string): boolean => status !== "resolved";

  /**
   * Status + reassessment update, one write per tap.
   *
   * Resolving a high-severity injury (severity at or above the serious
   * threshold, or one where the report carried serious signals) asks for a
   * deliberate confirm: "feeling better" is not what clears a potentially
   * serious injury — a professional's assessment is. The confirm says that,
   * and requires a second tap, so the single most consequential write on the
   * tab cannot happen by accident.
   */
  const [confirmResolveId, setConfirmResolveId] = useState<string | null>(null);
  const updateInjuryStatus = async (injury: InjuryRow, status: string, severity?: number) => {
    if (!user || updatingId) return;
    if (status === "resolved" && severity != null && severity >= SERIOUS_SEVERITY) {
      // Set the confirm flow: a second tap on the Update button executes it.
      if (confirmResolveId !== injury.id) {
        setConfirmResolveId(injury.id);
        toast.message("Resolving a severity-" + severity + " injury", {
          description: "If this is resolved, it should be after a professional assessment — not just because it feels better. Tap Update again if you are sure.",
        });
        return;
      }
      setConfirmResolveId(null);
    }
    setUpdatingId(injury.id);
    const patch: { status: string; severity?: number } = { status };
    if (typeof severity === "number" && severity >= 1 && severity <= 10) patch.severity = Math.round(severity);
    const { error } = await supabase.from("injury_logs").update(patch).eq("id", injury.id).eq("user_id", user.id);
    setUpdatingId(null);
    if (error) { toast.error(error.message); return; }
    toast.success(
      status === "resolved"
        ? "Marked resolved — restrictions and flags for this injury are lifted."
        : "Status updated — the plan flags and the AI's next plan now reflect this.",
    );
    load();
  };

  /**
   * The PAID path on this tab: a personalised rehabilitation plan for one injury.
   *
   * Injury Management is bought once; this is what costs credits per use, and
   * the charge is deliberate rather than a paywall on an existing feature: the
   * plan is written by the model for this injury at this severity, against the
   * athlete's own training week, so it is a provider call every time it is
   * made — even for an athlete who already owns the tab. The free generic
   * scaffold stays free because it costs nothing to produce.
   *
   * The SERVER charges (ai-analyze, type "injury_plan") and refunds on failure,
   * so this page never spends credits itself, and nothing is written to the
   * injury row until an answer has arrived AND been read. A 402 is a purchase
   * opportunity, not a dead end: the top-up sheet opens for the exact gap.
   */
  const generateInjuryPlan = async (injury: InjuryRow) => {
    if (!user || !profile || planningId) return;
    // The same gate the button rendering applies, owning correctness in code:
    // a serious report is not something a training plan is written around,
    // at any price, whatever the UI does.
    if (injury.severity >= SERIOUS_SEVERITY) {
      toast.error("This injury needs assessment by a physiotherapist or doctor before any training plan. Update its status once they have looked at it.");
      return;
    }
    setPlanningId(injury.id);
    try {
      const created = typeof injury.created_at === "string" ? injury.created_at : null;
      const daysSince = created
        ? Math.max(1, Math.round((Date.now() - new Date(created).getTime()) / 86_400_000))
        : null;
      const briefing = buildInjuryBriefing({
        bodyPart: injury.body_part,
        severity: injury.severity,
        notes: injury.notes ?? null,
        daysSince: Number.isFinite(daysSince as number) ? daysSince : null,
        sport: profile.sport ?? null,
      });

      const { data, error } = await supabase.functions.invoke("ai-analyze", {
        body: {
          type: "injury_plan",
          briefing,
          userLocale: getAiLocale(),
          pbs: getLocalPBs().slice(0, 20).map((p) => ({ metric: p.metric, value: p.value, unit: p.unit, date: p.date })),
        },
      });

      if (error) {
        const raw = await edgeErrorMessage(error);
        // "Invalid type" means the server did not recognise the injury_plan
        // request at all — a version mismatch, not something retrying will
        // fix. Say so plainly instead of printing the wire error.
        const message = /invalid type/i.test(raw)
          ? "The server did not recognise this plan request. Update the app to the latest version and try again — if it persists, contact support rather than retrying."
          : raw;
        const status = (error as { context?: { status?: number } })?.context?.status ?? 0;
        if (status === 402) {
          const short = await shortfallFromEdgeError(error);
          if (short) {
            const outcome = await requestCreditTopUp({
              shortfall: short.shortfall,
              reasonLabel: "AI Injury Plan",
            });
            if (outcome.purchased) {
              toast.message("Credits added — tap \"Personalised plan\" again.");
              return;
            }
          }
        }
        toast.error(message);
        return;
      }

      const parsed = parseInjuryPlan((data as { result?: unknown } | null)?.result);
      if (!parsed.plan) {
        // Charged but unreadable: say so, and save nothing. The server has
        // already refunded a failed call; an unreadable answer is reported
        // rather than rendered as an empty plan the athlete paid for.
        toast.error(parsed.error || "The plan could not be read, so nothing was saved.");
        return;
      }

      // Written BEFORE the save, so a failed write is visible as a failure.
      // Creating it again would charge a second time, which is the one thing
      // the athlete cannot fix from here.
      const { error: saveError } = await supabase
        .from("injury_logs")
        .update({ recovery_protocol: renderInjuryProtocol(parsed.plan) })
        .eq("id", injury.id);
      if (saveError) {
        toast.error(
          "Your plan was written but not saved to this injury. Contact support — do not generate it again, a second attempt would charge you twice.",
        );
        return;
      }

      // The cost the SERVER charged, not the price from the config: Unlimited
      // pays nothing for a call that is metered for everyone else, and telling a
      // subscriber they spent 6 credits would be a lie about their own balance.
      const charged = Number((data as { cost?: unknown } | null)?.cost ?? 0);
      toast.success(planHeadline(parsed.plan), {
        description: charged > 0 ? `${charged} credits used.` : "Included with Unlimited.",
      });
      await refreshProfile();
      load();
    } catch (e) {
      toast.error((e as Error)?.message || "Could not create the plan");
    } finally {
      setPlanningId(null);
    }
  };

  if (loading || entitlementsLoading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin" /></div>;

  if (!unlocked) {
    return (
      <div className="min-h-screen bg-background px-5 pt-[var(--vaylo-screen-top)] pb-24 max-w-lg mx-auto">
        <div className="flex items-center gap-2 text-xs text-primary uppercase tracking-widest mb-2"><ShieldAlert size={14} /> Training strain & recovery</div>
        <h1 className="text-2xl font-display font-bold mt-1">Injury Management</h1>
        <div className="mt-8 p-6 rounded-2xl border-2 border-primary/40 bg-card/40 backdrop-blur space-y-4">
          <div className="text-sm text-muted-foreground">Unlock a training-strain reading, a free generic return-to-training scaffold with every injury, and personalised AI plans.</div>
          <ul className="text-sm space-y-1.5">
            <li className="flex gap-2"><CheckCircle2 size={14} className="text-primary mt-0.5" /> Strain reading 0–100 from your load, recovery and sleep</li>
            <li className="flex gap-2"><CheckCircle2 size={14} className="text-primary mt-0.5" /> A body-area scaffold with every injury you log — free, and it stays free</li>
            <li className="flex gap-2"><CheckCircle2 size={14} className="text-primary mt-0.5" /> Load & A:C ratio tracking</li>
            <li className="flex gap-2"><CheckCircle2 size={14} className="text-primary mt-0.5" /> Personalised AI plans, {creditCost("injury_plan")} credits each — charged per plan, even once the tab is unlocked</li>
          </ul>
          <div className="text-3xl font-display font-bold">{creditCost("injury_management_unlock")} <span className="text-sm text-muted-foreground">credits · one-time</span></div>
          <Button onClick={unlockInjury} disabled={unlocking} className="w-full">{unlocking ? "Unlocking..." : `Unlock for ${creditCost("injury_management_unlock")} credits`}</Button>
          <div className="text-[12px] text-muted-foreground">Your balance: {profile?.credits ?? 0} credits</div>
        </div>
      </div>
    );
  }


  const chartData = loads.slice(-28).map((l) => ({ date: l.log_date.slice(5), load: l.total_rpe }));

  return (
    <div className="min-h-screen bg-background px-5 pt-[var(--vaylo-screen-top)] pb-24 max-w-5xl mx-auto space-y-6">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center gap-2 text-xs text-primary uppercase tracking-widest"><ShieldAlert size={14} /> Training strain & recovery</div>
        <h1 className="text-2xl font-display font-bold mt-1">Injury Management</h1>
        <p className="text-muted-foreground mt-1 text-sm">How your recent load, recovery and trends add up — a training measure, not a medical assessment.</p>
      </motion.div>

      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.1 }}
        className={`p-6 rounded-2xl border-2 bg-card/40 backdrop-blur ${
          riskTier.color === "destructive" ? "border-destructive/40" : riskTier.color === "energy" ? "border-energy/40" : "border-primary/40"
        }`}>
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs uppercase tracking-widest text-muted-foreground">Current strain</div>
          <span className={`text-xs font-bold px-3 py-1 rounded-full ${
            riskTier.color === "destructive" ? "bg-destructive/20 text-destructive" : riskTier.color === "energy" ? "bg-energy/20 text-energy" : "bg-primary/20 text-primary"
          }`}>{riskTier.label}</span>
        </div>
        <div className="text-6xl font-display font-bold mb-2">{risk}<span className="text-2xl text-muted-foreground">/100</span></div>
        <div className="w-full bg-muted/30 h-2 rounded-full overflow-hidden mb-3">
          <motion.div initial={{ width: 0 }} animate={{ width: `${risk}%` }} transition={{ duration: 1, ease: "easeOut" }}
            className={`h-full ${riskTier.color === "destructive" ? "bg-destructive" : riskTier.color === "energy" ? "bg-energy" : "bg-primary"}`} />
        </div>
        <div className="text-sm">{riskTier.action}</div>
      </motion.div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
          className="p-5 rounded-2xl bg-card/40 border border-border">
          <h3 className="font-semibold mb-3">What's driving this</h3>
          <ul className="space-y-2 text-sm">
            <li className="flex justify-between"><span>A:C Ratio</span><span className={analysis.ratio > 1.3 ? "text-destructive" : "text-primary"}>{analysis.ratio.toFixed(2)}</span></li>
            <li className="flex justify-between"><span>Sprint share</span><span>{Math.round(analysis.sprintShare * 100)}%</span></li>
            <li className="flex justify-between"><span>Avg fatigue</span><span>{avgFatigue.toFixed(1)}/10</span></li>
            <li className="flex justify-between"><span>Avg soreness</span><span>{avgSoreness.toFixed(1)}/10</span></li>
            <li className="flex justify-between"><span>Avg sleep quality</span><span>{avgSleep.toFixed(1)}/10</span></li>
            <li className="flex justify-between"><span>Active injuries</span><span>{injuries.filter((i) => isRestrictingStatus(i.status)).length}</span></li>
          </ul>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
          className="p-5 rounded-2xl bg-card/40 border border-border">
          <h3 className="font-semibold mb-3">Load Trend (28d)</h3>
          <ResponsiveContainer width="100%" height={140}>
            <LineChart data={chartData}>
              <XAxis dataKey="date" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
              <ReferenceLine y={analysis.chronic} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
              <Line type="monotone" dataKey="load" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </motion.div>
      </div>

      <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
        className="p-5 rounded-2xl bg-card/40 border border-border">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold">Active Injuries</h3>
          <Button size="sm" onClick={() => setShowForm(!showForm)}><Plus size={14} className="mr-1" /> Log injury</Button>
        </div>
        {showForm && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}
            className="space-y-3 mb-4 p-4 rounded-xl bg-background/40 border border-border">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground" htmlFor="injury-site">What is hurt</label>
              <Select value={form.body_part} onValueChange={(v) => setForm({ ...form, body_part: v })}>
                <SelectTrigger id="injury-site"><SelectValue /></SelectTrigger>
                <SelectContent>{BODY_PARTS.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {/* Anything not on the list is still an injury, and it is the most
                specific thing the plan is written from — so it is typed here
                rather than reduced to "Other". */}
            {form.body_part === "Other" && (
              <div>
                <label className="mb-1 block text-xs text-muted-foreground" htmlFor="injury-site-other">
                  Name or describe it
                </label>
                <input
                  id="injury-site-other"
                  type="text"
                  value={otherSite}
                  maxLength={MAX_SITE_LENGTH}
                  onChange={(e) => setOtherSite(e.target.value)}
                  placeholder="e.g. groin, shin, lower back, rotator cuff"
                  className="w-full bg-muted border border-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Your words go straight into the plan's briefing. Any injury can be logged and built for — the list
                  above is only shortcuts.
                </p>
              </div>
            )}
            <div>
              <label className="text-xs text-muted-foreground">Severity: {form.severity}/10</label>
              <input type="range" min={1} max={10} value={form.severity} onChange={(e) => setForm({ ...form, severity: Number(e.target.value) })} className="w-full" />
            </div>
            <Textarea placeholder="Notes / how it happened" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            <div className="text-[12px] text-muted-foreground p-2 rounded-lg bg-energy/5 border border-energy/20 flex gap-2">
              <AlertTriangle size={14} className="text-energy flex-shrink-0 mt-0.5" />
              <span><strong>Not medical advice.</strong> Vaylo Sports generates a generic return-to-training scaffold. Sharp, persistent, or worsening pain — see a qualified physiotherapist or doctor.</span>
            </div>
            <Button onClick={submitInjury} disabled={submitting} className="w-full">
              {submitting ? <><Loader2 size={14} className="animate-spin" /> Saving…</> : "Save injury — free conservative scaffold"}
            </Button>
          </motion.div>
        )}
        {injuries.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-4 flex items-center justify-center gap-2">
            <CheckCircle2 size={16} className="text-primary" /> No injuries logged. Stay protected.
          </div>
        ) : (
          <div className="space-y-3">
            {injuries.map((i) => (
              <div key={i.id} className={`p-3 rounded-xl border ${
                isRestrictingStatus(i.status) ? "border-destructive/30 bg-destructive/5" : "border-border bg-background/40 opacity-60"
              }`}>
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <div className="font-medium text-sm">
                      {i.body_part} <span className="text-xs text-muted-foreground">· severity {i.severity}/10</span>
                      <span className={`ml-2 text-[11px] uppercase tracking-wider font-semibold ${
                        i.status === "active" ? "text-destructive"
                        : i.status === "improving" ? "text-success"
                        : i.status === "reassess" ? "text-energy"
                        : "text-muted-foreground"
                      }`}>
                        {INJURY_STATUSES.find((s) => s.value === i.status)?.label ?? i.status}
                      </span>
                    </div>
                    {i.notes && <div className="text-xs text-muted-foreground mt-1">{i.notes}</div>}
                  </div>
                </div>
                {/* Status + reassessment: where the athlete records getting
                    better, a setback, or resolution. This is deliberately a
                    deliberate write, not a checkbox next to "feels fine" —
                    resolved is a status for after a professional's outcome,
                    and the copy below says so. */}
                {isRestrictingStatus(i.status) && (
                  <div className="mt-2 p-2 rounded-lg bg-background/60 border border-border space-y-2">
                    <div className="flex items-center gap-2">
                      <Select value={i.status} onValueChange={(v) => void updateInjuryStatus(i, v, i.severity)} disabled={updatingId === i.id}>
                        <SelectTrigger className="h-8 text-xs w-44" aria-label="Injury status"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {INJURY_STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <span className="text-[11px] text-muted-foreground">severity</span>
                      <input
                        type="range" min={1} max={10} defaultValue={i.severity}
                        aria-label={`${i.body_part} severity`}
                        onMouseUp={(e) => void updateInjuryStatus(i, i.status, Number((e.target as HTMLInputElement).value))}
                        onTouchEnd={(e) => void updateInjuryStatus(i, i.status, Number((e.target as HTMLInputElement).value))}
                        className="w-20"
                      />
                      {updatingId === i.id && <Loader2 size={14} className="animate-spin text-muted-foreground" />}
                    </div>
                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                      Improving still counts as active for your restrictions until you mark it resolved; resolved is a status for after a professional has reassessed it, not just when it feels better.
                    </p>
                  </div>
                )}
                {i.recovery_protocol && (() => {
                  // The column holds both plans, so the label comes from the
                  // stored text (the marker line the paid path writes) rather
                  // than from state: a generic scaffold must never be shown as
                  // the thing the athlete paid for, and vice versa.
                  const stored = splitStoredProtocol(i.recovery_protocol);
                  // A stored medical referral is not one of the plans — it is
                  // the app's answer to a serious report, and it must not be
                  // relabelled as either the free scaffold or the paid plan.
                  const isReferral = i.recovery_protocol.startsWith(MEDICAL_REFERRAL_MARKER);
                  const storedIsPersonalised = stored.personalised && !isReferral;
                  return (
                    <div className="mt-2 pt-2 border-t border-border/40">
                      <div className={`text-[12px] uppercase tracking-widest mb-1 ${isReferral ? "text-destructive" : "text-primary"}`}>
                        {isReferral
                          ? "Medical assessment needed first"
                          : storedIsPersonalised
                          ? "Personalised plan (written for this injury)"
                          : "Generic scaffold (free)"}
                      </div>
                      <ul className="space-y-1 text-xs text-muted-foreground">
                        {stored.lines.map((line, idx) => (
                          <li key={idx} className="flex gap-2"><span className={isReferral ? "text-destructive" : "text-primary"}>•</span><span>{line}</span></li>
                        ))}
                      </ul>
                    </div>
                  );
                })()}

                {/* The paid action. The price comes from the credit config, never
                    from a literal written here, and the reason is on screen
                    rather than implied: a plan is written for this injury at this
                    severity against the athlete's training week, so it costs us a
                    provider call every time it is made.

                    Gated for a serious report: a stored medical referral, or a
                    severity at or above the serious threshold, means the app
                    has already declined to write a training plan for this
                    injury — the button is not offered, and the card says why,
                    rather than selling a scaffold around a possible fracture. */}
                {i.recovery_protocol?.startsWith(MEDICAL_REFERRAL_MARKER) || i.severity >= SERIOUS_SEVERITY ? (
                  <div className="mt-3 pt-2 border-t border-border/40">
                    <div className="p-3 rounded-lg bg-energy/5 border border-energy/20 flex gap-2">
                      <AlertTriangle size={14} className="text-energy flex-shrink-0 mt-0.5" />
                      <span className="text-[12px] leading-relaxed text-muted-foreground">
                        <strong>No plan is offered for this report.</strong> Based on the severity or the symptoms recorded, this injury needs assessment by a qualified physiotherapist or doctor first. Once they have assessed it, log what they said here (update the status and severity above) and the app can help you track a plan they approve.
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 pt-2 border-t border-border/40">
                    <Button
                      size="sm"
                      onClick={() => void generateInjuryPlan(i)}
                      disabled={planningId === i.id}
                      className="w-full gap-1.5"
                    >
                      {planningId === i.id ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                      {planningId === i.id
                        ? "Writing your plan…"
                        : `${i.recovery_protocol ? "Replace with a" : "Create a"} personalised plan · ${creditCost("injury_plan")} credits`}
                    </Button>
                    <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                      {creditCost("injury_plan")} credits per plan — written for this injury against your training week, so it costs a provider call every time it is made. The tab unlock does not cover it. The generic scaffold above stays free.
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </motion.div>
    </div>
  );
};

export default Injury;
