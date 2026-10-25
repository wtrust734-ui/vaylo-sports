import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { ShieldAlert, AlertTriangle, CheckCircle2, Loader2, Plus, Sparkles } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { analyzeLoads, type LoadRow } from "@/lib/performance";
import { creditCost } from "@/lib/credits";
import { edgeErrorMessage } from "@/lib/edgeErrors";
import { shortfallFromEdgeError } from "@/lib/shortfall";
import { requestCreditTopUp } from "@/lib/topUpStore";
import { getAiLocale } from "@/i18n";
import { getLocalPBs } from "@/lib/athleteDossier";
import { normaliseEquipment } from "@/config/equipment";
import {
  buildInjuryBriefing,
  freeInjuryProtocol,
  MAX_SITE_LENGTH,
  parseInjuryPlan,
  planHeadline,
  readStoredTrainingAdvice,
  renderInjuryProtocol,
  resolveInjurySite,
  splitStoredProtocol,
} from "@/lib/injuryPlan";
import { asPlanWeeks } from "@/lib/planSchedule";
import { useUnlockFeature } from "@/hooks/useUnlockFeature";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import InjuryPlanProgress from "@/components/injury/InjuryPlanProgress";

const BODY_PARTS = ["Knee", "Hamstring", "Calf", "Achilles", "Foot/Ankle", "Hip", "Lower Back", "Shoulder", "Elbow", "Wrist", "Other"];

const SWELLING_OPTIONS = [
  { value: "none", label: "None" },
  { value: "some", label: "Some swelling or bruising" },
  { value: "significant", label: "Significant swelling or bruising" },
] as const;


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
  type InjuryRow = {
    id: string;
    status: string;
    body_part: string;
    severity: number;
    notes?: string | null;
    mechanism?: string | null;
    hurts?: string | null;
    still_doing?: string | null;
    swelling?: string | null;
    onset_days?: number | null;
    recovery_protocol?: string | null;
    [key: string]: unknown;
  };
  const [recovery, setRecovery] = useState<RecoveryRow[]>([]);
  const [injuries, setInjuries] = useState<InjuryRow[]>([]);
  const [showForm, setShowForm] = useState(false);
  const emptyForm = {
    body_part: "Knee",
    severity: 3,
    mechanism: "",
    hurts: "",
    still_doing: "",
    swelling: "none" as "none" | "some" | "significant",
    onset_days: "",
    notes: "",
  };
  const [form, setForm] = useState(emptyForm);
  // The intake opens by itself for an athlete with nothing logged: the first
  // thing this tab should do is ask about the injury, not show an empty list.
  const openedIntake = useRef(false);
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
  // True once the answer has been written AND saved, so the progress bar can
  // reach 100% without ever showing it before the plan exists on the row.
  const [planDone, setPlanDone] = useState(false);
  /** Training days in the athlete's active plan, so the plan fits their real week. */
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
      // athlete is training. The rehab plan is written alongside that week, so
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
    const loadedInjuries = (i.data as InjuryRow[] | null) || [];
    setInjuries(loadedInjuries);
    if (!openedIntake.current) {
      openedIntake.current = true;
      if (loadedInjuries.length === 0) setShowForm(true);
    }
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

  /** Bounded, control-character-free text for a column, or null when blank. */
  const clean = (value: string, max = 600): string | null => {
    const text = (value || "").replace(/\p{C}/gu, " ").trim();
    return text ? text.slice(0, max) : null;
  };

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
    const mechanism = clean(form.mechanism);
    const hurts = clean(form.hurts);
    const stillDoing = clean(form.still_doing);
    const notes = clean(form.notes, 1000);
    const onsetRaw = form.onset_days.trim();
    const onsetDays = onsetRaw === ""
      ? null
      : Math.max(0, Math.min(3650, Math.round(Number(onsetRaw) || 0)));

    // The row still opens with the free safety guidance — the general pattern of
    // care for the area and the red flags — so an athlete is never left with an
    // empty card while deciding whether to pay for the personalised plan. The
    // full week-by-week rehab plan is the AI one, below.
    const scaffold = freeInjuryProtocol({
      bodyPart,
      severity,
      reported: [mechanism, hurts, stillDoing, notes].filter(Boolean).join(". "),
    });

    const { error } = await supabase.from("injury_logs").insert({
      user_id: user.id,
      body_part: bodyPart,
      severity,
      status: "active",
      mechanism,
      hurts,
      still_doing: stillDoing,
      swelling: form.swelling,
      onset_days: onsetDays,
      notes,
      recovery_protocol: scaffold.lines.join("\n"),
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    if (scaffold.referral) {
      toast.success("Injury logged", {
        description:
          "This needs a qualified clinician before any training plan. The referral note is on the injury.",
      });
    } else {
      toast.success("Injury logged", {
        description:
          "Create your personalised plan below — it is written from these answers and slots into your normal training.",
      });
    }
    setShowForm(false);
    setForm(emptyForm);
    setOtherSite("");
    load();
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
    setPlanDone(false);
    setPlanningId(injury.id);
    try {
      const created = typeof injury.created_at === "string" ? injury.created_at : null;
      const daysSince = created
        ? Math.max(1, Math.round((Date.now() - new Date(created).getTime()) / 86_400_000))
        : null;
      // Every answer the intake asked for goes into the briefing. These are the
      // facts the plan is personalised from; dropping one here is the same as
      // never asking the question.
      const briefing = buildInjuryBriefing({
        bodyPart: injury.body_part,
        severity: injury.severity,
        mechanism: injury.mechanism ?? null,
        hurts: injury.hurts ?? null,
        stillDoing: injury.still_doing ?? null,
        swelling: injury.swelling ?? null,
        notes: injury.notes ?? null,
        daysSince:
          injury.onset_days != null
            ? Number(injury.onset_days)
            : Number.isFinite(daysSince as number)
              ? daysSince
              : null,
        sport: profile.sport ?? null,
        trainingDays,
        // The profile already knows what they can train with; a rehab plan that
        // prescribes a band or a gym machine they do not have is a plan they
        // cannot follow.
        equipment: normaliseEquipment(
          (profile.extended_profile as { equipment?: unknown } | null)?.equipment,
        ),
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
        description: charged > 0 ? `${charged} credits used. It is saved on this injury.` : "Included with Unlimited. It is saved on this injury.",
      });
      await Promise.all([refreshProfile(), load()]);
      // Hold the finished bar for a beat: dropping the overlay in the same frame
      // the plan appears reads as a glitch rather than a completion.
      setPlanDone(true);
      await new Promise((resolve) => window.setTimeout(resolve, 420));
    } catch (e) {
      toast.error((e as Error)?.message || "Could not create the plan");
    } finally {
      setPlanningId(null);
      setPlanDone(false);
    }
  };

  if (loading || entitlementsLoading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin" /></div>;

  if (!unlocked) {
    return (
      <div className="min-h-screen bg-background px-5 pt-[var(--vaylo-screen-top)] pb-24 max-w-lg mx-auto">
        <div className="flex items-center gap-2 text-xs text-primary uppercase tracking-widest mb-2"><ShieldAlert size={14} /> Training strain & recovery</div>
        <h1 className="text-2xl font-display font-bold mt-1">Injury Management</h1>
        <div className="mt-8 p-6 rounded-2xl border-2 border-primary/40 bg-card/40 backdrop-blur space-y-4">
          <div className="text-sm text-muted-foreground">Log an injury properly, get a personalised rehab plan written from it, and see how your load is treating you.</div>
          <ul className="text-sm space-y-1.5">
            <li className="flex gap-2"><CheckCircle2 size={14} className="text-primary mt-0.5" /> A full injury intake — how it happened, triggers, what still works, swelling, timing</li>
            <li className="flex gap-2"><CheckCircle2 size={14} className="text-primary mt-0.5" /> Starter safety guidance with every injury you log</li>
            <li className="flex gap-2"><CheckCircle2 size={14} className="text-primary mt-0.5" /> Load & A:C ratio tracking</li>
            <li className="flex gap-2"><CheckCircle2 size={14} className="text-primary mt-0.5" /> Personalised AI rehab plans, {creditCost("injury_plan")} credits each — charged per plan, even once the tab is unlocked</li>
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
              <label className="text-xs text-muted-foreground" htmlFor="injury-severity">
                How bad is it right now: {form.severity}/10
              </label>
              <input
                id="injury-severity"
                type="range"
                min={1}
                max={10}
                value={form.severity}
                onChange={(e) => setForm({ ...form, severity: Number(e.target.value) })}
                className="w-full"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground" htmlFor="injury-mechanism">
                How did it happen?
              </label>
              <Textarea
                id="injury-mechanism"
                placeholder="e.g. sprinting, changed direction and felt it go"
                value={form.mechanism}
                maxLength={600}
                onChange={(e) => setForm({ ...form, mechanism: e.target.value })}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground" htmlFor="injury-hurts">
                What makes it worse?
              </label>
              <Textarea
                id="injury-hurts"
                placeholder="e.g. running downhill, cutting, sitting for long, pushing off"
                value={form.hurts}
                maxLength={600}
                onChange={(e) => setForm({ ...form, hurts: e.target.value })}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground" htmlFor="injury-still-doing">
                What can you still do pain-free?
              </label>
              <Textarea
                id="injury-still-doing"
                placeholder="e.g. walk, cycle, upper-body gym work"
                value={form.still_doing}
                maxLength={600}
                onChange={(e) => setForm({ ...form, still_doing: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="min-w-0">
                <label className="mb-1 block text-xs text-muted-foreground" htmlFor="injury-swelling">
                  Swelling or bruising
                </label>
                <Select
                  value={form.swelling}
                  onValueChange={(v) => setForm({ ...form, swelling: v as typeof form.swelling })}
                >
                  <SelectTrigger id="injury-swelling"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SWELLING_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="min-w-0">
                <label className="mb-1 block text-xs text-muted-foreground" htmlFor="injury-onset">
                  Days ago it started
                </label>
                <Input
                  id="injury-onset"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={3650}
                  placeholder="e.g. 3"
                  value={form.onset_days}
                  onChange={(e) => setForm({ ...form, onset_days: e.target.value })}
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground" htmlFor="injury-notes">
                Anything else the plan should take into account?
              </label>
              <Textarea
                id="injury-notes"
                placeholder="e.g. I have a physio appointment next week, or I cannot take time off work"
                value={form.notes}
                maxLength={1000}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>
            <div className="text-[12px] text-muted-foreground p-2 rounded-lg bg-energy/5 border border-energy/20 flex gap-2">
              <AlertTriangle size={14} className="text-energy flex-shrink-0 mt-0.5" />
              <span><strong>Not medical advice.</strong> These answers become the briefing for your plan. Sharp, persistent, or worsening pain — see a qualified physiotherapist or doctor.</span>
            </div>
            <Button onClick={submitInjury} className="w-full">Save injury and answers</Button>
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
                    {(i.mechanism || i.hurts || i.still_doing || i.onset_days != null) && (
                      <details className="mt-1.5 text-xs text-muted-foreground">
                        <summary className="cursor-pointer select-none text-[11px] font-semibold text-primary">
                          Your logged answers
                        </summary>
                        <dl className="mt-1.5 space-y-1">
                          {i.mechanism ? (
                            <div className="flex gap-1.5">
                              <dt className="shrink-0 font-medium text-foreground/80">How:</dt>
                              <dd className="min-w-0 break-words">{i.mechanism}</dd>
                            </div>
                          ) : null}
                          {i.hurts ? (
                            <div className="flex gap-1.5">
                              <dt className="shrink-0 font-medium text-foreground/80">Worse with:</dt>
                              <dd className="min-w-0 break-words">{i.hurts}</dd>
                            </div>
                          ) : null}
                          {i.still_doing ? (
                            <div className="flex gap-1.5">
                              <dt className="shrink-0 font-medium text-foreground/80">Still can:</dt>
                              <dd className="min-w-0 break-words">{i.still_doing}</dd>
                            </div>
                          ) : null}
                          {i.onset_days != null ? (
                            <div className="flex gap-1.5">
                              <dt className="shrink-0 font-medium text-foreground/80">Started:</dt>
                              <dd className="min-w-0">
                                {i.onset_days === 0 ? "Today" : `${i.onset_days} day${Number(i.onset_days) === 1 ? "" : "s"} ago`}
                              </dd>
                            </div>
                          ) : null}
                        </dl>
                      </details>
                    )}
                  </div>
                  {i.status === "active" && <Button size="sm" variant="ghost" className="shrink-0" onClick={() => resolveInjury(i.id)}>Resolve</Button>}
                </div>
                {i.recovery_protocol && (() => {
                  // The column holds both plans, so the label comes from the
                  // stored text (the marker line the paid path writes) rather
                  // than from state: a generic scaffold must never be shown as
                  // the thing the athlete paid for, and vice versa.
                  const stored = splitStoredProtocol(i.recovery_protocol);
                  // The training advice is stored as labelled lines so it can be
                  // lifted out of the plan and shown first — an athlete told to
                  // stop training must not have to read three weeks of drills to
                  // find that out.
                  const advice = stored.kind === "ai" ? readStoredTrainingAdvice(stored.lines) : null;
                  // The model chooses the length, so the card states it from the
                  // plan itself. The highest week number is the length even if a
                  // week is missing, which a count would understate.
                  const planWeeks = stored.lines.reduce((longest, line) => {
                    const match = /^Week (\d+)/.exec(line);
                    return match ? Math.max(longest, Number(match[1])) : longest;
                  }, 0);
                  let planLines = stored.lines;
                  if (advice) {
                    const skip = new Set<number>();
                    stored.lines.forEach((line, index) => {
                      if (line.startsWith("Training:") || line.startsWith("What you can still do:")) {
                        skip.add(index);
                        return;
                      }
                      if (line === "Build back into training:") {
                        skip.add(index);
                        for (let k = index + 1; k < stored.lines.length; k += 1) {
                          if (!stored.lines[k].startsWith("•")) break;
                          skip.add(k);
                        }
                      }
                    });
                    planLines = stored.lines.filter((_, index) => !skip.has(index));
                  }
                  return (
                    <div className="mt-2 pt-2 border-t border-border/40">
                      <div className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-primary">
                        {stored.kind === "ai"
                          ? `Your personalised plan${planWeeks > 0 ? ` · ${planWeeks} week${planWeeks === 1 ? "" : "s"}` : ""}`
                          : stored.kind === "mobility"
                            ? "Mobility & rehab plan"
                            : "Starter safety guidance"}
                      </div>
                      {advice ? (
                        <div className="mb-3 rounded-xl border border-energy/30 bg-energy/5 p-3">
                          <p className="text-[11px] font-semibold uppercase tracking-widest text-energy">
                            Training while this heals
                          </p>
                          <p className="mt-1 text-xs font-medium leading-relaxed text-foreground">
                            {(() => {
                              // The panel heading already says "Training while this
                              // heals", so the stored prefix would repeat it.
                              const detail = advice.headline.replace(/^Training:\s*/i, "");
                              return detail.charAt(0).toUpperCase() + detail.slice(1);
                            })()}
                          </p>
                          {advice.during ? (
                            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{advice.during}</p>
                          ) : null}
                          {advice.buildBack.length > 0 ? (
                            <ol className="mt-2 space-y-1 text-xs leading-relaxed text-muted-foreground">
                              {advice.buildBack.map((step, index) => (
                                <li key={step} className="flex gap-2">
                                  <span aria-hidden className="shrink-0 font-semibold text-energy">{index + 1}.</span>
                                  <span className="min-w-0">{step}</span>
                                </li>
                              ))}
                            </ol>
                          ) : null}
                        </div>
                      ) : null}
                      {/* The stored plan is line-based text, so the shape has to
                          come from the lines: week headings get their own band,
                          checklist lines keep the bullet in its own column (so a
                          wrapped line lines up under the text, not under the
                          dot), and everything else reads as a paragraph. */}
                      <ul className="space-y-1.5 text-xs leading-relaxed text-muted-foreground">
                        {planLines.map((line, idx) => {
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
                    rather than implied: the plan is written for this injury at
                    this severity against the athlete's training week, so it
                    costs a provider call every time it is made. */}
                <div className="mt-3 space-y-2 border-t border-border/40 pt-2">
                  {(() => {
                    // Show which of the intake answers this plan will be written
                    // from. The answers were asked for one reason — they change
                    // the plan — so the athlete should see them going in.
                    const facts = [
                      i.mechanism ? "how it happened" : null,
                      i.hurts ? "what makes it worse" : null,
                      i.still_doing ? "what still works" : null,
                      i.swelling && i.swelling !== "none" ? "swelling" : null,
                      i.onset_days != null ? "how long ago" : null,
                    ].filter((fact): fact is string => Boolean(fact));
                    return facts.length > 0 ? (
                      <ul aria-label="Written from your logged answers" className="flex flex-wrap gap-1.5">
                        {facts.map((fact) => (
                          <li
                            key={fact}
                            className="rounded-full border border-border bg-background/60 px-2.5 py-1 text-[10px] leading-none text-muted-foreground"
                          >
                            {fact}
                          </li>
                        ))}
                      </ul>
                    ) : null;
                  })()}
                  <Button
                    size="sm"
                    onClick={() => void generateInjuryPlan(i)}
                    disabled={Boolean(planningId) || i.status !== "active"}
                    className="w-full gap-1.5"
                  >
                    {planningId === i.id ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                    {planningId === i.id
                      ? "Writing your plan…"
                      : i.recovery_protocol
                        ? "Write a new plan"
                        : "Create my personalised plan"}
                  </Button>
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    Mobility, activation and strength work added on to your normal training — not a replacement
                    for it. The plan runs for however many weeks this injury actually needs, tells you if you
                    should stop training and for how long, and builds you back in step by step. Written from
                    every answer you logged.
                  </p>
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    {creditCost("injury_plan")} credits per plan — each one is a provider call, so the tab unlock
                    does not cover it. Failed calls are refunded automatically.
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </motion.div>

      {/* The wait screen is rendered from `planningId`, not from a local flag:
          it has to survive every toast and profile refresh in between. */}
      {planningId && (() => {
        const active = injuries.find((injury) => injury.id === planningId);
        if (!active) return null;
        return (
          <InjuryPlanProgress
            bodyPart={active.body_part}
            severity={active.severity}
            done={planDone}
          />
        );
      })()}
    </div>
  );
};

export default Injury;
