import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ShieldAlert, AlertTriangle, CheckCircle2, Loader2, Plus, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { analyzeLoads, type LoadRow } from "@/lib/performance";
import { creditCost } from "@/lib/credits";
import { useUnlockFeature } from "@/hooks/useUnlockFeature";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, ReferenceLine } from "recharts";

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
  const [unlocked, setUnlocked] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const unlock = useUnlockFeature();

  useEffect(() => { if (user) load(); }, [user]);
  const load = async () => {
    if (!user) return;
    const [l, r, i, u] = await Promise.all([
      supabase.from("training_loads").select("*").eq("user_id", user.id).order("log_date").limit(60),
      supabase.from("recovery_logs").select("*").eq("user_id", user.id).order("log_date", { ascending: false }).limit(14),
      supabase.from("injury_logs").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
      supabase.from("user_purchases").select("product_id").eq("user_id", user.id).eq("product_id", "injury_management").maybeSingle(),
    ]);
    setLoads(l.data || []);
    setRecovery(r.data || []);
    setInjuries(i.data || []);
    setUnlocked(!!u.data);
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
      await refreshProfile();
      setUnlocked(true);
      toast.success("Injury Management unlocked!");
    } catch (e) {
      toast.error(e.message || "Failed to unlock");
    } finally { setUnlocking(false); }
  };

  const analysis = analyzeLoads(loads);
  const avgFatigue = recovery.length ? recovery.reduce((a, b) => a + (b.fatigue || 5), 0) / recovery.length : 5;
  const avgSoreness = recovery.length ? recovery.reduce((a, b) => a + (b.soreness || 5), 0) / recovery.length : 5;
  const avgSleep = recovery.length ? recovery.reduce((a, b) => a + (b.sleep_quality || 5), 0) / recovery.length : 5;

  // Predictive risk score 0-100
  let risk = 0;
  if (analysis.ratio > 1.5) risk += 35; else if (analysis.ratio > 1.3) risk += 20;
  if (analysis.sprintShare > 0.5) risk += 15;
  if (avgFatigue > 7) risk += 15;
  if (avgSoreness > 7) risk += 15;
  if (avgSleep < 4) risk += 10;
  if (injuries.filter((i) => i.status === "active").length > 0) risk += 20;
  risk = Math.min(100, risk);

  const riskTier = risk >= 65 ? { label: "HIGH RISK", color: "destructive", action: "Reduce load 30% for 5 days. Add 2 mobility sessions." }
    : risk >= 40 ? { label: "ELEVATED", color: "energy", action: "Cap intensity below 80%. Prioritize sleep & soft-tissue work." }
    : { label: "PROTECTED", color: "primary", action: "Keep current load. Maintain mobility routine." };

  const submitInjury = async () => {
    if (!user) return;
    const plan = planForInjury(form.body_part, form.severity);
    const { error } = await supabase.from("injury_logs").insert({
      user_id: user.id, ...form, recovery_protocol: plan.join("\n"),
    });
    if (error) toast.error(error.message);
    else {
      toast.success("Injury logged — recovery plan generated below");
      setShowForm(false); setForm({ body_part: "Knee", severity: 3, notes: "" }); load();
    }
  };

  const resolveInjury = async (id: string) => {
    const { error } = await supabase.from("injury_logs").update({ status: "resolved" }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    load();
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin" /></div>;

  if (!unlocked) {
    return (
      <div className="min-h-screen p-6 pt-20 pb-24 max-w-lg mx-auto">
        <div className="flex items-center gap-2 text-xs text-primary uppercase tracking-widest mb-2"><ShieldAlert size={14} /> Predictive Injury Engine</div>
        <h1 className="text-4xl font-display font-bold">Injury <span className="text-gradient-electric">Management</span></h1>
        <div className="mt-8 p-6 rounded-2xl border-2 border-primary/40 bg-card/40 backdrop-blur space-y-4">
          <div className="text-sm text-muted-foreground">Unlock predictive risk scoring, evidence-led recovery scaffolds, and automatic protocol generation whenever you log an injury.</div>
          <ul className="text-sm space-y-1.5">
            <li className="flex gap-2"><CheckCircle2 size={14} className="text-primary mt-0.5" /> Real-time risk 0–100 from load, recovery, sleep</li>
            <li className="flex gap-2"><CheckCircle2 size={14} className="text-primary mt-0.5" /> Body-part specific return-to-play plans</li>
            <li className="flex gap-2"><CheckCircle2 size={14} className="text-primary mt-0.5" /> Load & A:C ratio tracking</li>
          </ul>
          <div className="text-3xl font-display font-bold">{creditCost("injury_management_unlock")} <span className="text-sm text-muted-foreground">credits · one-time</span></div>
          <Button onClick={unlockInjury} disabled={unlocking} className="w-full">{unlocking ? "Unlocking..." : `Unlock for ${creditCost("injury_management_unlock")} credits`}</Button>
          <div className="text-[11px] text-muted-foreground">Your balance: {profile?.credits ?? 0} credits</div>
        </div>
      </div>
    );
  }


  const chartData = loads.slice(-28).map((l) => ({ date: l.log_date.slice(5), load: l.total_rpe }));

  return (
    <div className="min-h-screen p-6 pt-20 pb-24 max-w-5xl mx-auto space-y-6">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center gap-2 text-xs text-primary uppercase tracking-widest"><ShieldAlert size={14} /> Predictive Injury Engine</div>
        <h1 className="text-4xl font-display font-bold mt-2">Injury <span className="text-gradient-electric">Management</span></h1>
        <p className="text-muted-foreground mt-1 text-sm">Real-time risk forecasting from your load, recovery, and trends.</p>
      </motion.div>

      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.1 }}
        className={`p-6 rounded-2xl border-2 bg-card/40 backdrop-blur ${
          riskTier.color === "destructive" ? "border-destructive/40" : riskTier.color === "energy" ? "border-energy/40" : "border-primary/40"
        }`}>
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs uppercase tracking-widest text-muted-foreground">Current Risk</div>
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
          <h3 className="font-semibold mb-3">Risk Drivers</h3>
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
            <Select value={form.body_part} onValueChange={(v) => setForm({ ...form, body_part: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{BODY_PARTS.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent>
            </Select>
            <div>
              <label className="text-xs text-muted-foreground">Severity: {form.severity}/10</label>
              <input type="range" min={1} max={10} value={form.severity} onChange={(e) => setForm({ ...form, severity: Number(e.target.value) })} className="w-full" />
            </div>
            <Textarea placeholder="Notes / how it happened" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            <div className="text-[11px] text-muted-foreground p-2 rounded-lg bg-energy/5 border border-energy/20 flex gap-2">
              <AlertTriangle size={14} className="text-energy flex-shrink-0 mt-0.5" />
              <span><strong>Not medical advice.</strong> Vaylo Sports generates a generic return-to-play scaffold. Sharp, persistent, or worsening pain — see a qualified physiotherapist or doctor.</span>
            </div>
            <Button onClick={submitInjury} className="w-full">Save & generate plan</Button>
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
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <div className="font-medium text-sm">{i.body_part} <span className="text-xs text-muted-foreground">· severity {i.severity}/10</span></div>
                    {i.notes && <div className="text-xs text-muted-foreground mt-1">{i.notes}</div>}
                  </div>
                  {i.status === "active" && <Button size="sm" variant="ghost" onClick={() => resolveInjury(i.id)}>Resolve</Button>}
                </div>
                {i.recovery_protocol && (
                  <div className="mt-2 pt-2 border-t border-border/40">
                    <div className="text-[10px] uppercase tracking-widest text-primary mb-1">Recovery Plan</div>
                    <ul className="space-y-1 text-xs text-muted-foreground">
                      {i.recovery_protocol.split("\n").map((line: string, idx: number) => (
                        <li key={idx} className="flex gap-2"><span className="text-primary">•</span><span>{line}</span></li>
                      ))}
                    </ul>
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
