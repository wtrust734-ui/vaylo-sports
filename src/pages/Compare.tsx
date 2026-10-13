import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Trophy, Loader2, Lock, Info } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { creditCost } from "@/lib/credits";
import { useSpendWithTopUp } from "@/hooks/useSpendWithTopUp";
import { calculateVPR, type MetricRow } from "@/lib/performance";
import {
  ELITE_GROUPS_WITH_PROFILES,
  ELITE_PROFILES,
  groupForSport,
  profilesInGroup,
  type EliteProfile,
} from "@/lib/eliteProfiles";
import { VPR_COMPARE_FEATURE, compareSpendMetadata, paidTargetsFrom } from "@/lib/vprCompare";
import { Radar, RadarChart, PolarAngleAxis, PolarGrid, PolarRadiusAxis, ResponsiveContainer } from "recharts";

/**
 * STACK UP VS ELITE
 *
 * The benchmarks are real athletes, one per event, across essentially every
 * sport the app supports (see src/lib/eliteProfiles.ts). The 0–100 indices are
 * illustrative shapes of what each event demands, on the same scale as the
 * athlete's own VPR — they are not measurements of the named athlete, and the
 * screen says so in words right under the chart.
 *
 * A comparison costs 2 credits, once per target. Browsing the list, switching
 * sport and switching event are all free; only revealing a comparison spends,
 * and comparing again to a target already paid for does not charge twice.
 */
const Compare = () => {
  const { user, profile, refreshProfile } = useAuth();
  const [metrics, setMetrics] = useState<MetricRow[]>([]);
  const [loading, setLoading] = useState(true);
  const userSport = profile?.sport?.split(",")[0]?.trim() || "Running";

  // Opens on the athlete's own sport family, so a 800m runner lands on the
  // 800m target rather than on whatever is first in the list.
  const [group, setGroup] = useState<string>(() => groupForSport(userSport));
  const groupTargets = useMemo(() => profilesInGroup(group), [group]);
  const [targetId, setTargetId] = useState<string>(() => profilesInGroup(groupForSport(userSport))[0].id);
  const [touched, setTouched] = useState(false);

  const compareCost = creditCost("vpr_compare");
  const spendWithTopUp = useSpendWithTopUp();
  const [paidIds, setPaidIds] = useState<string[]>([]);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);

  const elite: EliteProfile = ELITE_PROFILES.find((p) => p.id === targetId) ?? groupTargets[0];

  // Until the athlete picks something themselves, follow the profile: the
  // profile can finish loading after first render, and landing on the wrong
  // sport is the complaint this screen exists to fix.
  useEffect(() => {
    if (touched) return;
    const nextGroup = groupForSport(userSport);
    setGroup(nextGroup);
    setTargetId(profilesInGroup(nextGroup)[0].id);
  }, [userSport, touched]);

  const unlockComparison = async () => {
    if (!user) return;
    setPaying(true);
    setPayError(null);
    try {
      // The target id is recorded on the receipt, not just held in state:
      // "once per target" has to survive leaving this screen, and the credit
      // balance it was spent from lives on the account.
      const spend = await spendWithTopUp("vpr_compare", {
        reason: `VPR comparison vs ${elite.name} (${elite.event})`,
        metadata: compareSpendMetadata(elite.id),
      });
      if (!spend.success) {
        setPayError(
          spend.dismissedTopUp
            ? "Not enough credits — top up to compare."
            : spend.error || "Could not start the comparison.",
        );
        return;
      }
      setPaidIds((prev) => (prev.includes(elite.id) ? prev : [...prev, elite.id]));
      await refreshProfile();
    } finally {
      setPaying(false);
    }
  };

  /**
   * Comparisons this account has already paid for.
   *
   * The screen used to keep these in component state, which made "once per
   * target" true only within one visit: an athlete who compared against a
   * target, left, and came back was charged 2 credits again for a comparison
   * they already owned. The receipts are the `credit_transactions` rows the
   * spend wrote, so the answer is the same on every device they sign in to.
   *
   * A failed read leaves the list as it was rather than clearing it: the worst
   * case is the paywall showing for something already bought at the old price,
   * which `credits_spend` still has to authorise.
   */
  useEffect(() => { if (user) void load(); }, [user]);
  const load = async () => {
    if (!user) return;
    const [{ data }, { data: receipts }] = await Promise.all([
      supabase.from("performance_metrics").select("*").eq("user_id", user.id).limit(200),
      supabase
        .from("credit_transactions")
        .select("metadata")
        .eq("user_id", user.id)
        .eq("feature", VPR_COMPARE_FEATURE)
        .order("created_at", { ascending: false })
        .limit(200),
    ]);
    setMetrics(data || []);
    if (receipts) setPaidIds(paidTargetsFrom(receipts));
    setLoading(false);
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin" /></div>;

  const userVpr = calculateVPR(metrics, userSport);

  const data = [
    { axis: "Speed", you: userVpr.speed_index, elite: elite.profile.speed_index },
    { axis: "Power", you: userVpr.power_index, elite: elite.profile.power_index },
    { axis: "Endurance", you: userVpr.endurance_capacity, elite: elite.profile.endurance_capacity },
    { axis: "Repeat", you: userVpr.repeatability, elite: elite.profile.repeatability },
    { axis: "Skill", you: userVpr.skill_consistency, elite: elite.profile.skill_consistency },
    { axis: "React", you: userVpr.reaction_efficiency, elite: elite.profile.reaction_efficiency },
  ];

  const gaps = data.map((d) => ({ axis: d.axis, gap: d.elite - d.you })).sort((a, b) => b.gap - a.gap);
  const biggestGap = gaps[0];
  const hasData = metrics.length > 0;
  const isPaid = paidIds.includes(elite.id);

  const guidance: Record<string, string> = {
    Speed: "Add 2 sprint sessions/week. Focus on max-velocity flying 30s and acceleration starts.",
    Power: "Bring in plyometrics + 1 heavy lower-body lift weekly. Triple-extension drills pay off.",
    Endurance: "Add 1 long Zone-2 session and 1 threshold session per week for 6 weeks.",
    Repeat: "Train repeatability with EMOM/AMRAP-style intervals. Keep RPE consistent across sets.",
    Skill: "Schedule daily skill-specific deliberate practice (15 min) under low fatigue.",
    React: "Add reaction-cue drills (visual/audio) pre-warmup. 5 min × 4 days/week.",
  };

  const chooseGroup = (g: string) => {
    setTouched(true);
    setGroup(g);
    setTargetId(profilesInGroup(g)[0].id);
    setPayError(null);
  };

  return (
    <div className="min-h-screen bg-background px-5 pt-[var(--vaylo-screen-top)] pb-24 max-w-4xl mx-auto space-y-5">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center gap-2 text-xs text-primary uppercase tracking-widest"><Trophy size={14} /> Athlete Comparison</div>
        <h1 className="text-2xl font-display font-bold mt-1">Stack Up vs Elite</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {ELITE_PROFILES.length} benchmarks across {ELITE_GROUPS_WITH_PROFILES.length} sports — one per event, so an 800m runner compares against an 800m runner.
        </p>
      </motion.div>

      {/* Sport group — the first narrowing. A runner should never have to scroll
          past Formula 1 to find the 800m. */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Sport</p>
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1">
          {ELITE_GROUPS_WITH_PROFILES.map((g) => (
            <button
              key={g.group}
              type="button"
              onClick={() => chooseGroup(g.group)}
              className={`shrink-0 rounded-full border px-3.5 py-2 text-xs font-semibold whitespace-nowrap transition-colors ${
                group === g.group
                  ? "border-transparent bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:border-primary/40"
              }`}
            >
              {g.group}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground" htmlFor="elite-event">
          Event &amp; athlete
        </label>
        <select
          id="elite-event"
          value={elite.id}
          onChange={(e) => { setTouched(true); setTargetId(e.target.value); setPayError(null); }}
          className="w-full rounded-xl border border-border bg-card px-3 py-3 text-sm text-foreground"
        >
          {groupTargets.map((p) => (
            <option key={p.id} value={p.id}>{p.event} — {p.name}</option>
          ))}
        </select>

        {/* The fact that makes the benchmark credible, shown next to the name —
            and labelled as a verified fact rather than an app claim. */}
        <div className="flex items-start gap-2 rounded-xl border border-border bg-card/60 px-3 py-2.5">
          <Info size={14} className="mt-0.5 shrink-0 text-primary" />
          <p className="text-[12px] leading-relaxed text-muted-foreground">
            <span className="font-semibold text-foreground">{elite.name}</span> · {elite.country} — {elite.credential}.
          </p>
        </div>
      </div>

      {!hasData && (
        <div className="rounded-2xl border border-dashed border-border bg-card/40 p-6 text-center">
          <p className="text-sm font-semibold">No performance metrics yet</p>
          <p className="mt-1 text-xs text-muted-foreground">Log workouts, skills and tests in Training & Performance to build your VPR. The chart below will fill as you add data — comparison is most useful once you have logs in 2–3 domains (e.g., speed + endurance + skill).</p>
        </div>
      )}

      {isPaid ? (
        <>
          <motion.div initial={{ opacity: 0, scale: 0.95 }} whileInView={{ opacity: 1, scale: 1 }} viewport={{ once: true }}
            className="p-6 rounded-2xl bg-card/40 border border-border">
            <ResponsiveContainer width="100%" height={320}>
              <RadarChart data={data}>
                <PolarGrid stroke="hsl(var(--border))" />
                <PolarAngleAxis dataKey="axis" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                <PolarRadiusAxis domain={[0, 100]} tick={{ fontSize: 9 }} />
                <Radar name="Elite" dataKey="elite" stroke="hsl(var(--energy))" fill="hsl(var(--energy))" fillOpacity={0.15} />
                <Radar name="You" dataKey="you" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.4} />
              </RadarChart>
            </ResponsiveContainer>
            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs mt-2">
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-primary" /> You · {userVpr.overall_vpr} VPR</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-energy" /> {elite.name} ({elite.event}) · {elite.profile.overall_vpr} VPR</span>
            </div>
            <p className="mt-3 text-center text-[12px] leading-relaxed text-muted-foreground">
              {elite.name} is a real benchmark athlete for the {elite.event} — {elite.credential}. The six indices are illustrative
              (0–100) and are not measurements of them; your VPR is calculated only from your logged metrics on the same scale.
              Use the gap as a directional training prompt, not a diagnosis.
            </p>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
            className="p-5 rounded-2xl bg-card/40 border border-border">
            <h3 className="font-semibold mb-3">Biggest Gap → Action Plan</h3>
            {!hasData ? (
              <p className="text-sm text-muted-foreground">Add at least 3 performance logs to generate a personalised action plan.</p>
            ) : (
              <>
                <div className="text-sm mb-1 text-muted-foreground">Your largest opportunity is in <span className="text-primary font-semibold">{biggestGap.axis}</span> ({biggestGap.gap > 0 ? `+${biggestGap.gap} pts` : "you lead"}).</div>
                <p className="text-sm">{guidance[biggestGap.axis]}</p>
              </>
            )}

            <div className="mt-4 space-y-1.5">
              {gaps.map((g) => (
                <div key={g.axis} className="flex items-center gap-3">
                  <span className="w-16 text-xs text-muted-foreground">{g.axis}</span>
                  <div className="flex-1 bg-muted/30 h-2 rounded-full overflow-hidden">
                    <motion.div initial={{ width: 0 }} whileInView={{ width: `${Math.max(0, Math.min(100, (data.find((d) => d.axis === g.axis)!.you / 100) * 100))}%` }} viewport={{ once: true }}
                      className="h-full bg-primary" />
                  </div>
                  <span className="w-16 text-xs text-right">{g.gap > 0 ? `-${g.gap}` : `+${-g.gap}`}</span>
                </div>
              ))}
            </div>
          </motion.div>
        </>
      ) : (
        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
          className="p-6 rounded-2xl border-2 border-primary/40 bg-card/40 text-center space-y-3">
          <Lock size={24} className="mx-auto text-primary" />
          <h3 className="font-display font-bold text-lg">Stack up against {elite.name}</h3>
          <p className="text-sm text-muted-foreground">Your VPR radar overlaid on {elite.event}, your biggest gap, and the action plan that closes it.</p>
          <div className="text-3xl font-display font-bold">{compareCost} <span className="text-sm text-muted-foreground">credits · per comparison</span></div>
          <button onClick={unlockComparison} disabled={paying || !hasData || !user}
            className="w-full flex items-center justify-center gap-2 bg-gradient-primary text-primary-foreground font-semibold py-3 rounded-xl shadow-glow disabled:opacity-50">
            <Trophy size={16} /> {paying ? "Unlocking…" : `Compare for ${compareCost} credits`}
          </button>
          {!hasData && <p className="text-xs text-muted-foreground">Log at least one workout, skill or test first — there is no VPR to compare yet.</p>}
          {payError && <p className="text-xs text-destructive">{payError}</p>}
          <div className="text-[12px] text-muted-foreground">Your balance: {profile?.credits ?? 0} credits</div>
        </motion.div>
      )}
    </div>
  );
};

export default Compare;
