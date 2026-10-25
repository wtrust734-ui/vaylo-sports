import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ShieldAlert, AlertTriangle, CheckCircle2, Loader2, Plus, Sparkles, X, Activity } from "lucide-react";
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
  MAX_SITE_LENGTH,
  parseInjuryPlan,
  planHeadline,
  renderInjuryProtocol,
  resolveInjurySite,
  splitStoredProtocol,
} from "@/lib/injuryPlan";
import { buildInjuryRehabPlan } from "@/lib/injuryRehabPlan";
import { asPlanWeeks } from "@/lib/planSchedule";
import { useUnlockFeature } from "@/hooks/useUnlockFeature";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

const BODY_PARTS = ["Knee", "Hamstring", "Calf", "Achilles", "Foot/Ankle", "Hip", "Lower Back", "Shoulder", "Elbow", "Wrist", "Other"];

// Generic, evidence-led recovery scaffolds. NOT medical advice — disclaimer always shown.
const RECOVERY_PLANS: Record<string, string[]> = {
  Knee: [
    "Days 1–3: Rest, ice 15min ×3/day, compression sleeve, elevate when seated.",
    "Days 4–7: Quad sets, straight-leg raises 3×10. Stationary bike, no resistance.",
    "Week 2: Wall sits 3×30s, step-ups (low box), terminal knee extension band work.",
    "Week 3–4: Single-leg balance, Bulgarian split squats (bodyweight), gradual jog return.",
    "Red flags: locking, giving way, swelling that doesn't drop → see a physio.",
  ],
  Hamstring: [
    "Days 1–3: Ice, gentle isometrics (bridges 3×10s holds), avoid stretching.",
    "Days 4–7: Nordic curl negatives 3×3, single-leg deadlift (light), walking lunges.",
    "Week 2: Romanian deadlift, prone hamstring curls, sled drags.",
    "Week 3+: Build to sprints — start at 50% and add 10% per session.",
    "Red flags: bruising, popping sensation, inability to bear weight → get imaged.",
  ],
  Calf: [
    "Days 1–3: Ice, calf compression sleeve, walking only.",
    "Days 4–10: Seated calf raises 3×15, ankle ABCs, eccentric calf drops on stairs.",
    "Week 2: Standing calf raises (both then single leg), pogo hops low height.",
    "Week 3+: Skipping rope, then progressive jogging at 30%/50%/70%/100% over 4 sessions.",
  ],
  Achilles: [
    "Days 1–5: Heel lift in shoes, isometric calf holds 5×45s daily, no jumping.",
    "Week 1–3: Alfredson protocol — heavy slow eccentric heel drops 3×15 twice daily.",
    "Week 4+: Reintroduce skipping, then 20s strides at 60% effort.",
    "Avoid: stretching to pain, plyos until pain on hopping <2/10.",
  ],
  "Foot/Ankle": [
    "Days 1–3: PEACE & LOVE — Protection, Elevation, Avoid anti-inflammatories, Compression, Education.",
    "Days 4–10: Single-leg balance 3×30s, alphabet drills, towel scrunches.",
    "Week 2: Heel-to-toe walking, lateral band walks, controlled hops.",
    "Week 3+: Plyo progression — pogos → broad jumps → cutting.",
  ],
  Hip: [
    "Days 1–7: Hip flexor stretch (couch stretch) 2×60s/side, glute bridges 3×15.",
    "Week 2: Banded clams, side-lying hip abduction, deadbugs.",
    "Week 3+: Goblet squats, lateral lunges, single-leg RDL progression.",
  ],
  "Lower Back": [
    "Days 1–3: Walking 10–15min ×2/day. Avoid prolonged sitting. Cat-cow gently.",
    "Days 4–10: McKenzie press-ups 10 reps every 2h, glute bridges, deadbugs.",
    "Week 2+: Bird-dogs, hip hinge practice (broomstick), kettlebell deadlifts (very light).",
    "Red flags: leg numbness, bladder/bowel changes → ER immediately.",
  ],
  Shoulder: [
    "Days 1–7: Pendulum swings, scapular squeezes 3×10, avoid overhead.",
    "Week 2: External rotation band work 3×15, prone Y-T-W raises.",
    "Week 3+: Push-up plus, landmine press, gradual return to overhead.",
  ],
  Elbow: [
    "Days 1–7: Wrist eccentrics (flexion + extension) 3×15, ice 10min post-activity.",
    "Week 2+: Forearm strengthening — pronation/supination with hammer, towel twists.",
    "Avoid: gripping under load until pain on resisted wrist extension <3/10.",
  ],
  Wrist: [
    "Days 1–5: Splint, wrist circles, gentle pronation/supination.",
    "Week 2+: Wrist curls (very light), grip work with stress ball, gradual loading.",
  ],
  Other: [
    "General protocol: 48–72h relative rest, then begin pain-free movement.",
    "Re-introduce strength at 50% load, progress 10% per session if pain stays <3/10.",
    "Sleep 8h+, protein 1.6–2.0g/kg/day, manage stress — recovery is systemic.",
  ],
};

const planForInjury = (bodyPart: string, severity: number): string[] => {
  const base = RECOVERY_PLANS[bodyPart] ?? RECOVERY_PLANS.Other;
  if (severity >= 7) {
    return ["⚠ Severity 7+: see a qualified physiotherapist or doctor BEFORE following any plan.", ...base];
  }
  return base;
};

/**
 * Load trend drawn as plain SVG.
 *
 * This used to be a `recharts` chart. It was the only interactive chart on the
 * screen and it pulled a large charting dependency into a lazily loaded tab;
 * when that module failed, the whole tab showed the global error boundary
 * instead of a load graph. Twenty-eight points and one baseline do not need a
 * chart library — this keeps the tab rendering even if a vendor module is
 * broken, and it cannot throw while a lazy chunk is being evaluated.
 */
function LoadTrendChart({
  data,
  baseline,
}: {
  data: { date: string; load: number }[];
  baseline: number;
}) {
  if (data.length === 0) {
    return (
      <div className="flex h-[140px] items-center justify-center rounded-xl border border-dashed border-border/60 text-xs text-muted-foreground">
        No load logged in the last 28 days.
      </div>
    );
  }

  const width = 320;
  const height = 150;
  const pad = { top: 14, right: 10, bottom: 22, left: 30 };
  const values = data.map((point) => point.load);
  const max = Math.max(1, baseline, ...values) * 1.12;
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const x = (index: number) =>
    pad.left + (data.length === 1 ? plotW / 2 : (index / (data.length - 1)) * plotW);
  const y = (value: number) => pad.top + plotH - (value / max) * plotH;
  const points = data.map((point, index) => `${x(index)},${y(point.load)}`).join(" ");
  const baselineY = y(baseline);
  const first = data[0]?.date ?? "";
  const last = data[data.length - 1]?.date ?? "";
  const peak = Math.max(...values);

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-[140px] w-full"
        role="img"
        aria-label={`Training load for the last ${data.length} days. Peak ${Math.round(peak)}, usual load ${Math.round(baseline)}.`}
      >
        {/* Horizontal guides keep the line readable without a chart library. */}
        {[0, 0.5, 1].map((fraction) => {
          const value = max * fraction;
          return (
            <g key={fraction}>
              <line
                x1={pad.left}
                x2={width - pad.right}
                y1={y(value)}
                y2={y(value)}
                stroke="hsl(var(--border))"
                strokeWidth="1"
                opacity="0.5"
              />
              <text
                x={pad.left - 4}
                y={y(value) + 3}
                textAnchor="end"
                fontSize="9"
                fill="hsl(var(--muted-foreground))"
              >
                {Math.round(value)}
              </text>
            </g>
          );
        })}

        {baseline > 0 ? (
          <line
            x1={pad.left}
            x2={width - pad.right}
            y1={baselineY}
            y2={baselineY}
            stroke="hsl(var(--muted-foreground))"
            strokeWidth="1"
            strokeDasharray="3 3"
            opacity="0.75"
          />
        ) : null}

        <polyline
          points={points}
          fill="none"
          stroke="hsl(var(--primary))"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />

        {data.map((point, index) => (
          <circle
            key={`${point.date}-${index}`}
            cx={x(index)}
            cy={y(point.load)}
            r="2.5"
            fill="hsl(var(--primary))"
          >
            <title>{`${point.date}: ${Math.round(point.load)} load`}</title>
          </circle>
        ))}

        <text x={pad.left} y={height - 5} fontSize="9" fill="hsl(var(--muted-foreground))">
          {first.slice(5)}
        </text>
        <text
          x={width - pad.right}
          y={height - 5}
          fontSize="9"
          textAnchor="end"
          fill="hsl(var(--muted-foreground))"
        >
          {last.slice(5)}
        </text>
      </svg>
      <figcaption className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
        <span>Daily load</span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-px w-4 border-t border-dashed border-muted-foreground" />
          Usual load
        </span>
      </figcaption>
    </figure>
  );
}

const Injury = () => {
  const { user, profile, refreshProfile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
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
  const [unlocking, setUnlocking] = useState(false);
  // The injury whose personalised plan is being written right now. One at a
  // time: a double tap used to be two paid calls.
  const [planningId, setPlanningId] = useState<string | null>(null);
  // The injury whose on-device mobility plan is being saved. Separate from
  // `planningId` because the two actions are different: one waits on a provider
  // call, the other is local and finishes in a moment.
  const [rehabPlanId, setRehabPlanId] = useState<string | null>(null);
  /** Training days in the athlete's active plan, so the rehab plan wraps around it. */
  const [trainingDays, setTrainingDays] = useState<number | null>(null);
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

  // Declared before the effect that calls it, and memoised by `user`, so the
  // effect never closes over an uninitialised binding and a refresh does not
  // refire the page load on every render. Each query's error is read: a
  // permission/network failure used to leave the tab on a spinner forever,
  // which reads exactly like "injury management is broken".
  const load = useCallback(async () => {
    if (!user) return;
    const [l, r, i, p] = await Promise.all([
      supabase.from("training_loads").select("*").eq("user_id", user.id).order("log_date").limit(60),
      supabase.from("recovery_logs").select("*").eq("user_id", user.id).order("log_date", { ascending: false }).limit(14),
      supabase.from("injury_logs").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
      // The active training plan, read for one fact: how many days a week the
      // athlete is training. The mobility plan is written around that week so
      // the two pieces of programming agree instead of competing.
      supabase.from("training_plans").select("plan_data").eq("user_id", user.id).eq("active", true).maybeSingle(),
    ]);
    const failure = l.error ?? r.error ?? i.error ?? p.error;
    if (failure) {
      setLoadError(failure.message || "Could not load your injury data.");
      setLoading(false);
      return;
    }
    setLoadError(null);
    setLoads((l.data as LoadRow[] | null) || []);
    setRecovery((r.data as RecoveryRow[] | null) || []);
    setInjuries((i.data as InjuryRow[] | null) || []);
    const weeks = asPlanWeeks((p.data as { plan_data?: unknown } | null)?.plan_data);
    const sessions = weeks[0]?.sessions ?? [];
    setTrainingDays(
      sessions.length
        ? sessions.filter((session) => !session.isRest && !session.isRecovery).length
        : null,
    );
    setLoading(false);
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

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
  if (injuries.filter((i) => i.status === "active").length > 0) risk += 20;
  risk = Math.min(100, risk);

  const riskTier = risk >= 65 ? { label: "HEAVY LOAD", color: "destructive", action: "Reduce load 30% for 5 days. Add 2 mobility sessions." }
    : risk >= 40 ? { label: "BUILDING", color: "energy", action: "Cap intensity below 80%. Prioritize sleep & soft-tissue work." }
    : { label: "STEADY", color: "primary", action: "Keep current load. Maintain mobility routine." };

  const submitInjury = async () => {
    if (!user) return;
    // Mirror the injury_logs DB checks: severity 1–10, closed status set,
    // body part from the product list, bounded note length. A malicious or
    // broken client cannot store a fabricated status/severity combination.
    const severity = Math.max(1, Math.min(10, Math.round(Number(form.severity) || 1)));
    // How the injury is described IS the briefing the paid plan is written from,
    // so the athlete's own words are kept when they gave them (see
    // resolveInjurySite, which is where that rule is tested).
    const bodyPart = resolveInjurySite({ listed: form.body_part, typed: otherSite, known: BODY_PARTS });
    const status = "active";
    const plan = planForInjury(bodyPart, severity);
    const { error } = await supabase.from("injury_logs").insert({
      user_id: user.id,
      body_part: bodyPart,
      severity,
      status,
      notes: (form.notes || "").replace(/\p{C}/gu, " ").slice(0, 1000) || null,
      recovery_protocol: plan.join("\n"),
    });
    if (error) toast.error(error.message);
    else {
      toast.success("Injury logged — a free generic scaffold is below. A personalised plan costs credits.");
      setShowForm(false); setForm({ body_part: "Knee", severity: 3, notes: "" }); setOtherSite(""); load();
    }
  };

  const resolveInjury = async (id: string) => {
    const { error } = await supabase.from("injury_logs").update({ status: "resolved" }).eq("id", id);
    if (error) { toast.error(error.message); return; }
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

  /**
   * The on-device mobility plan: what the athlete actually needs to fix it.
   *
   * This is the primary action on the tab because it always works — no provider
   * call, no credits, no answer to parse. It is deliberately NOT a training
   * plan: three weeks of range, activation and gentle strength for the injured
   * area, with the training week treated as the thing it runs alongside. The
   * paid AI version stays available underneath for a longer, personalised
   * scaffold.
   */
  const createRehabPlan = async (injury: InjuryRow) => {
    if (!user || rehabPlanId) return;
    const result = buildInjuryRehabPlan({
      bodyPart: injury.body_part,
      severity: injury.severity,
      notes: injury.notes ?? null,
      sport: profile?.sport ?? null,
      trainingDaysPerWeek: trainingDays,
    });
    if (!result.plan) {
      toast.error(result.reason);
      return;
    }
    setRehabPlanId(injury.id);
    try {
      const { error } = await supabase
        .from("injury_logs")
        .update({ recovery_protocol: renderInjuryProtocol(result.plan, "mobility") })
        .eq("id", injury.id)
        .eq("user_id", user.id);
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success("Mobility plan ready", {
        description: "Three weeks of range, activation and strength work, written around your training week — it is on this injury now.",
      });
      load();
    } finally {
      setRehabPlanId(null);
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

      {loadError ? (
        <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <p className="font-semibold">Couldn't load your injury data</p>
          <p className="mt-1 text-[12px] leading-relaxed text-destructive/90">{loadError}</p>
          <button
            type="button"
            onClick={() => { setLoading(true); void load(); }}
            className="mt-2 min-h-[44px] rounded-lg border border-destructive/40 px-3 text-xs font-semibold"
          >
            Try again
          </button>
        </div>
      ) : null}

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
            <li className="flex justify-between"><span>Active injuries</span><span>{injuries.filter((i) => i.status === "active").length}</span></li>
          </ul>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
          className="p-5 rounded-2xl bg-card/40 border border-border">
          <h3 className="font-semibold mb-3">Load Trend (28d)</h3>
          <LoadTrendChart data={chartData} baseline={analysis.chronic} />
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
            <Button onClick={submitInjury} className="w-full">Save injury — free generic scaffold</Button>
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
                i.status === "active" ? "border-destructive/30 bg-destructive/5" : "border-border bg-background/40 opacity-60"
              }`}>
                {/* `items-start` + `min-w-0`: a long site ("rotator cuff, right
                    shoulder") and its note wrap in their own column instead of
                    squeezing the Resolve button off the card. */}
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{i.body_part} <span className="text-xs text-muted-foreground">· severity {i.severity}/10</span></div>
                    {i.notes && <div className="mt-1 break-words text-xs text-muted-foreground">{i.notes}</div>}
                  </div>
                  {i.status === "active" && <Button size="sm" variant="ghost" className="shrink-0" onClick={() => resolveInjury(i.id)}>Resolve</Button>}
                </div>
                {i.recovery_protocol && (() => {
                  // The column holds both plans, so the label comes from the
                  // stored text (the marker line the paid path writes) rather
                  // than from state: a generic scaffold must never be shown as
                  // the thing the athlete paid for, and vice versa.
                  const stored = splitStoredProtocol(i.recovery_protocol);
                  return (
                    <div className="mt-2 pt-2 border-t border-border/40">
                      <div className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-primary">
                        {stored.kind === "ai"
                          ? "AI-written plan"
                          : stored.kind === "mobility"
                            ? "Mobility & rehab plan"
                            : "Generic scaffold (free)"}
                      </div>
                      {/* The stored plan is line-based text, so the shape has to
                          come from the lines: week headings get their own band,
                          checklist lines keep the bullet in its own column (so a
                          wrapped line lines up under the text, not under the
                          dot), and everything else reads as a paragraph. */}
                      <ul className="space-y-1.5 text-xs leading-relaxed text-muted-foreground">
                        {stored.lines.map((line, idx) => {
                          const isWeek = /^Week \d+/.test(line);
                          const isBullet = line.startsWith("•");
                          if (isWeek) {
                            return (
                              <li
                                key={idx}
                                className="mt-3 border-t border-border/40 pt-2 text-[11px] font-bold uppercase tracking-widest text-primary first:mt-0 first:border-0 first:pt-0"
                              >
                                {line}
                              </li>
                            );
                          }
                          if (isBullet) {
                            return (
                              <li key={idx} className="flex gap-2">
                                <span aria-hidden className="shrink-0 text-primary">•</span>
                                <span className="min-w-0">{line.slice(1).trim()}</span>
                              </li>
                            );
                          }
                          return <li key={idx}>{line}</li>;
                        })}
                      </ul>
                    </div>
                  );
                })()}

                {/* The paid action. The price comes from the credit config, never
                    from a literal written here, and the reason is on screen
                    rather than implied: a plan is written for this injury at this
                    severity against the athlete's training week, so it costs us a
                    provider call every time it is made. */}
                {/* Two ways to get a plan, and the one that always works comes
                    first. The mobility plan is built on the device: no provider
                    call, no charge, no unreadable answer — it is the button an
                    athlete can rely on when they are hurt and need something
                    to do today. The AI scaffold is the optional longer version. */}
                <div className="mt-3 space-y-2 border-t border-border/40 pt-2">
                  <Button
                    size="sm"
                    onClick={() => void createRehabPlan(i)}
                    disabled={rehabPlanId === i.id || planningId === i.id}
                    className="w-full gap-1.5"
                  >
                    {rehabPlanId === i.id ? <Loader2 size={14} className="animate-spin" /> : <Activity size={14} />}
                    {rehabPlanId === i.id
                      ? "Building your mobility plan…"
                      : i.recovery_protocol
                        ? "Rebuild the mobility plan"
                        : "Create a mobility plan"}
                  </Button>
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    Three weeks of range, activation and gentle strength for this injury, with a pain rule on every
                    drill and your training week written around it. Free, instant, and works offline.
                  </p>

                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void generateInjuryPlan(i)}
                    disabled={planningId === i.id || rehabPlanId === i.id}
                    className="w-full gap-1.5"
                  >
                    {planningId === i.id ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                    {planningId === i.id
                      ? "Writing your AI plan…"
                      : `AI-written personalised plan · ${creditCost("injury_plan")} credits`}
                  </Button>
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    {creditCost("injury_plan")} credits per AI plan — written for this injury against your training
                    week by the model, so it costs a provider call every time. The tab unlock does not cover it. The
                    mobility plan above is free.
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </motion.div>
    </div>
  );
};

export default Injury;
