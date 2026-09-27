import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Shuffle, Dumbbell, Heart, Move, Zap, Shield, Clock, Sparkles, AlertTriangle, Target } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { buildClientDossier, getLocalPBs } from "@/lib/athleteDossier";
import { calculateVPR } from "@/lib/performance";

type Exercise = { name: string; focus: string; sets: string; benefit: string; phase: string[]; impact?: "low" | "high" };

const LIBRARY: Record<string, Exercise[]> = {
  Running: [
    { name: "Pool Running", focus: "Aerobic", sets: "30–45 min easy", benefit: "Zero-impact cardio when joints need a break", phase: ["base", "recovery"], impact: "low" },
    { name: "Cycling (Z2)", focus: "Aerobic", sets: "60–90 min", benefit: "Builds aerobic engine without ground impact", phase: ["base"], impact: "low" },
    { name: "Single-Leg Glute Bridge", focus: "Strength", sets: "3×12 each", benefit: "Bulletproofs hamstrings, drops strain risk", phase: ["base", "build"], impact: "low" },
    { name: "Calf Eccentrics", focus: "Strength", sets: "3×15 each", benefit: "Achilles tendon resilience", phase: ["base", "build"], impact: "low" },
    { name: "Yoga Flow", focus: "Mobility", sets: "30 min", benefit: "Hip + thoracic mobility for stride length", phase: ["base", "recovery", "taper"], impact: "low" },
    { name: "Hill Repeats (bike)", focus: "Power", sets: "6×3min @ Z4", benefit: "Leg power without running impact", phase: ["build", "peak"], impact: "low" },
  ],
  Football: [
    { name: "Plyo Box Jumps", focus: "Power", sets: "5×3", benefit: "Sharper acceleration and change of direction", phase: ["build", "peak"], impact: "high" },
    { name: "Lateral Band Walks", focus: "Strength", sets: "3×15", benefit: "Glute med strength prevents knee valgus", phase: ["base", "build"], impact: "low" },
    { name: "Swimming", focus: "Aerobic", sets: "30 min", benefit: "Active recovery + lung capacity", phase: ["recovery"], impact: "low" },
    { name: "Core Anti-Rotation", focus: "Strength", sets: "3×30s/side", benefit: "Stability for cuts and tackles", phase: ["base", "build"], impact: "low" },
    { name: "Sled Pushes", focus: "Power", sets: "6×20m", benefit: "Pure horizontal force production", phase: ["build", "peak"], impact: "high" },
    { name: "Yoga (hips)", focus: "Mobility", sets: "20 min", benefit: "Restores hip rotation eaten by sprinting", phase: ["recovery", "taper"], impact: "low" },
  ],
  Basketball: [
    { name: "Depth Jumps", focus: "Power", sets: "4×4", benefit: "Reactive strength for vertical and first-step", phase: ["build", "peak"], impact: "high" },
    { name: "Single-Leg RDLs", focus: "Strength", sets: "3×8 each", benefit: "Posterior chain unilateral strength", phase: ["base", "build"], impact: "low" },
    { name: "Cycling (Z2)", focus: "Aerobic", sets: "45 min", benefit: "Recovery between game days", phase: ["recovery"], impact: "low" },
    { name: "Rotator Cuff Bands", focus: "Prehab", sets: "3×15", benefit: "Shoulder durability for shooting volume", phase: ["base"], impact: "low" },
    { name: "Ankle Hops", focus: "Power", sets: "3×20", benefit: "Stiff-spring landings for rebounds", phase: ["build"], impact: "high" },
  ],
  Cycling: [
    { name: "Trail Running (easy)", focus: "Aerobic", sets: "30 min", benefit: "Bone density cycling alone won't build", phase: ["base"], impact: "high" },
    { name: "Squat (heavy)", focus: "Strength", sets: "5×5", benefit: "Adds peak watts and protects knees", phase: ["base", "build"], impact: "low" },
    { name: "Yoga (hips)", focus: "Mobility", sets: "30 min", benefit: "Counters cycling hip flexor tightness", phase: ["recovery", "taper"], impact: "low" },
    { name: "Plank Variations", focus: "Strength", sets: "3×45s", benefit: "Core stability for power transfer", phase: ["base", "build"], impact: "low" },
  ],
  Swimming: [
    { name: "Pull-Ups", focus: "Strength", sets: "4×max", benefit: "Catch-phase pulling power", phase: ["base", "build"], impact: "low" },
    { name: "Rotational Med Ball", focus: "Power", sets: "3×8/side", benefit: "Core power for stroke rotation", phase: ["build", "peak"], impact: "low" },
    { name: "Easy Cycling", focus: "Aerobic", sets: "60 min", benefit: "Active recovery without shoulder load", phase: ["recovery"], impact: "low" },
    { name: "Shoulder Mobility Series", focus: "Mobility", sets: "10 min daily", benefit: "Prevents impingement", phase: ["base", "build", "recovery"], impact: "low" },
  ],
  Tennis: [
    { name: "Lateral Hops", focus: "Power", sets: "4×8", benefit: "Court-coverage burst", phase: ["build", "peak"], impact: "high" },
    { name: "Forearm Wrist Curls", focus: "Strength", sets: "3×15", benefit: "Wrist resilience for groundstrokes", phase: ["base"], impact: "low" },
    { name: "Yoga", focus: "Mobility", sets: "30 min", benefit: "Hip and shoulder mobility", phase: ["recovery", "base"], impact: "low" },
    { name: "Core Anti-Rotation", focus: "Strength", sets: "3×30s/side", benefit: "Power + injury protection on serves", phase: ["base", "build"], impact: "low" },
  ],
  Rugby: [
    { name: "Trap Bar Deadlift", focus: "Strength", sets: "5×3", benefit: "Total-body force for collisions", phase: ["base", "build"], impact: "low" },
    { name: "Sled Pushes", focus: "Power", sets: "6×20m", benefit: "Contact-driving power", phase: ["build", "peak"], impact: "high" },
    { name: "Pool Recovery", focus: "Recovery", sets: "20 min", benefit: "Reduces post-match soreness", phase: ["recovery"], impact: "low" },
    { name: "Neck Isometrics", focus: "Prehab", sets: "3×20s/dir", benefit: "Concussion-risk reduction", phase: ["base"], impact: "low" },
  ],
  MMA: [
    { name: "Sled Drags", focus: "Strength", sets: "5×30m", benefit: "Builds grappling-specific work capacity", phase: ["base", "build"], impact: "low" },
    { name: "Rotational Med Ball", focus: "Power", sets: "4×6/side", benefit: "Strike power through the hips", phase: ["build", "peak"], impact: "low" },
    { name: "Yoga", focus: "Mobility", sets: "30 min", benefit: "Hip mobility for guard work", phase: ["base", "recovery"], impact: "low" },
    { name: "Zone 2 Bike", focus: "Aerobic", sets: "45–60 min", benefit: "Aerobic base for round recovery", phase: ["base"], impact: "low" },
  ],
  CrossFit: [
    { name: "Zone 2 Run", focus: "Aerobic", sets: "40 min easy", benefit: "Aerobic ceiling that limits metcons", phase: ["base"], impact: "high" },
    { name: "Strict Pull-ups", focus: "Strength", sets: "5×3-5", benefit: "Foundation for kipping volume", phase: ["base", "build"], impact: "low" },
    { name: "Banded Distraction", focus: "Mobility", sets: "10 min", benefit: "Ankle + hip prep for squat depth", phase: ["base", "build", "recovery"], impact: "low" },
  ],
  Boxing: [
    { name: "Skipping", focus: "Aerobic", sets: "5×3min", benefit: "Foot speed + aerobic-anaerobic transitions", phase: ["base", "build"], impact: "high" },
    { name: "Med Ball Slams", focus: "Power", sets: "4×8", benefit: "Punching power through trunk", phase: ["build", "peak"], impact: "low" },
    { name: "Neck Bridges", focus: "Prehab", sets: "3×30s", benefit: "Punch absorption", phase: ["base"], impact: "low" },
  ],
  Triathlon: [
    { name: "Strength (full body)", focus: "Strength", sets: "3×8", benefit: "Force production missing from endurance", phase: ["base", "build"], impact: "low" },
    { name: "Yoga (hips)", focus: "Mobility", sets: "30 min", benefit: "Hip openers for the bike-to-run transition", phase: ["recovery"], impact: "low" },
    { name: "Core Stability", focus: "Strength", sets: "3 rounds", benefit: "Holds form deep into the run", phase: ["base", "build"], impact: "low" },
  ],
  default: [
    { name: "Cycling (Z2)", focus: "Aerobic", sets: "45 min", benefit: "Low-impact aerobic base", phase: ["base", "recovery"], impact: "low" },
    { name: "Yoga Flow", focus: "Mobility", sets: "30 min", benefit: "Restores movement quality", phase: ["recovery", "taper"], impact: "low" },
    { name: "Goblet Squat", focus: "Strength", sets: "3×10", benefit: "Functional lower-body strength", phase: ["base", "build"], impact: "low" },
    { name: "Plank Series", focus: "Strength", sets: "3×45s", benefit: "Core stability transfer", phase: ["base", "build"], impact: "low" },
    { name: "Mobility Routine", focus: "Mobility", sets: "10 min", benefit: "Daily joint health", phase: ["base", "build", "recovery", "taper"], impact: "low" },
  ],
};

const PHASES = [
  { v: "base", l: "Base", desc: "Build the engine" },
  { v: "build", l: "Build", desc: "Add intensity" },
  { v: "peak", l: "Peak", desc: "Race-ready" },
  { v: "taper", l: "Taper", desc: "Sharpen, don't grind" },
  { v: "recovery", l: "Recovery", desc: "Restore everything" },
];

const FOCUS_META: Record<string, { icon: any; tone: string }> = {
  Aerobic: { icon: Heart, tone: "bg-primary/10 text-primary border-primary/30" },
  Strength: { icon: Dumbbell, tone: "bg-electric-purple/10 text-electric-purple border-electric-purple/30" },
  Power: { icon: Zap, tone: "bg-energy/10 text-energy border-energy/30" },
  Mobility: { icon: Move, tone: "bg-success/10 text-success border-success/30" },
  Prehab: { icon: Shield, tone: "bg-muted/30 text-foreground border-border" },
  Recovery: { icon: Heart, tone: "bg-primary/10 text-primary border-primary/30" },
};

function bucketToFocus(bucket: string): string[] {
  switch (bucket) {
    case "speed_index": return ["Power", "Aerobic"];
    case "power_index": return ["Strength", "Power"];
    case "endurance_capacity": return ["Aerobic"];
    case "skill_consistency": return ["Strength", "Prehab"];
    case "reaction_efficiency": return ["Power", "Prehab"];
    case "repeatability": return ["Aerobic", "Recovery"];
    default: return ["Strength"];
  }
}

const CrossTraining = () => {
  const { profile } = useAuth();
  const profileSport = profile?.sport?.split(",")[0]?.trim();
  const sports = Object.keys(LIBRARY).filter((s) => s !== "default");
  const initialSport = profileSport && LIBRARY[profileSport] ? profileSport : sports[0];
  const [sport, setSport] = useState<string>(initialSport);
  const [phase, setPhase] = useState("base");
  const [focus, setFocus] = useState<string | null>(null);
  const [dossier, setDossier] = useState<any>(null);
  const [dossierLoading, setDossierLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setDossierLoading(true);
    buildClientDossier().then((d) => { if (alive) { setDossier(d); setDossierLoading(false); } }).catch(() => { if (alive) setDossierLoading(false); });
    return () => { alive = false; };
  }, [profile?.sport, profile?.date_of_birth]);

  const exercises = LIBRARY[sport] || LIBRARY.default;
  const focusList = ["All", ...Array.from(new Set(exercises.map((e) => e.focus)))];
  const filtered = exercises.filter((e) => e.phase.includes(phase) && (!focus || focus === "All" || e.focus === focus));

  // ——— Personalised “For you” picks ———
  const forYou = useMemo(() => {
    if (!dossier) return null;
    const injuries: any[] = dossier.injuries || [];
    const activeInjuries = injuries.filter((i) => i.status !== "resolved");
    const recovery: any[] = dossier.recovery || [];
    const readinessAvg = recovery.length ? recovery.reduce((a: number, b: any) => a + (b.readiness_score || 50), 0) / recovery.length : 65;
    const outcomeGoals: any[] = dossier.outcomeGoals || [];
    const vpr = dossier.vpr as Record<string, number | undefined> | null;

    // weakest buckets
    let weakestBuckets: string[] = [];
    if (vpr && typeof vpr === "object") {
      const buckets = ["speed_index", "power_index", "endurance_capacity", "skill_consistency", "reaction_efficiency", "repeatability"] as const;
      const entries = buckets.map((b) => ({ b, v: Number(vpr?.[b] ?? 50) })).sort((a, b) => a.v - b.v);
      weakestBuckets = entries.slice(0, 2).map((e) => e.b);
    }

    const weakFocuses = new Set(weakestBuckets.flatMap(bucketToFocus));
    // Goals bias
    const goalText = (outcomeGoals.map((g) => `${g.title} ${g.category}`).join(" ") + " " + (profile?.goals?.join(" ") || "")).toLowerCase();
    if (goalText.includes("strength") || goalText.includes("muscle")) weakFocuses.add("Strength");
    if (goalText.includes("speed") || goalText.includes("sprint") || goalText.includes("power")) weakFocuses.add("Power");
    if (goalText.includes("endurance") || goalText.includes("marathon") || goalText.includes("distance")) weakFocuses.add("Aerobic");
    if (goalText.includes("mobility") || goalText.includes("flex")) weakFocuses.add("Mobility");

    // Decide avoidance based on injuries
    const avoidHighImpact = activeInjuries.some((i) => /knee|ankle|achilles|shin|hip|lower.?back/i.test(String(i.body_part)));
    const avoidShoulder = activeInjuries.some((i) => /shoulder|rotator|elbow|wrist/i.test(String(i.body_part)));

    // Score each exercise in this sport's library
    const pool = (LIBRARY[sport] || LIBRARY.default).flatMap((e) => [e]);
    // also include default low-impact options as fallback if injuries
    const extended = avoidHighImpact ? [...pool, ...LIBRARY.default] : pool;

    const scored = extended.map((e) => {
      let score = 0;
      const reasons: string[] = [];
      if (weakFocuses.has(e.focus)) { score += 3; reasons.push(`Targets weak spot: ${e.focus}`); }
      if (readinessAvg < 55 && (e.focus === "Mobility" || e.focus === "Recovery" || e.phase.includes("recovery"))) { score += 2; reasons.push("Low readiness — recovery priority"); }
      if (e.phase.includes(phase)) { score += 1; }
      // penalise high impact when injured
      if (avoidHighImpact && e.impact === "high") { score -= 5; reasons.push("Avoid high impact (injury)"); }
      if (avoidShoulder && /pull-up|press|rotator/i.test(e.name)) { score -= 2; }
      // Prefer low impact when recovering
      if (avoidHighImpact && e.impact === "low") { score += 1; }
      return { e, score, reasons };
    });

    const picked = scored.sort((a, b) => b.score - a.score).slice(0, 3);
    // dedupe by name
    const seen = new Set<string>();
    const deduped: typeof picked = [];
    for (const p of picked) { if (!seen.has(p.e.name)) { seen.add(p.e.name); deduped.push(p); } if (deduped.length >= 3) break; }

    return {
      weakestBuckets,
      weakFocuses: Array.from(weakFocuses),
      readinessAvg: Math.round(readinessAvg),
      activeInjuries,
      outcomeGoals: outcomeGoals.slice(0, 2),
      picks: deduped,
    };
  }, [dossier, sport, phase, profile?.goals]);

  return (
    <div className="min-h-screen p-6 pt-20 pb-24 max-w-5xl mx-auto space-y-6">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center gap-2 text-xs text-primary uppercase tracking-widest"><Shuffle size={14} /> Cross-Training Library</div>
        <h1 className="text-4xl font-display font-bold mt-2">Smart <span className="text-gradient-electric">Cross-Training</span></h1>
        <p className="text-muted-foreground mt-1 text-sm">Sport-specific transfer work, dialled into your training phase — now tailored to your gaps, goals and recovery.</p>
      </motion.div>

      {/* For You — personalised */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
        className="p-5 rounded-2xl bg-gradient-to-br from-primary/10 via-card to-card border border-primary/20">
        <div className="flex items-center gap-2 mb-1">
          <Sparkles size={16} className="text-primary" />
          <span className="text-xs font-bold uppercase tracking-widest text-primary">For you</span>
          {dossierLoading && <span className="text-[10px] text-muted-foreground ml-auto">Loading your dossier…</span>}
          {!dossierLoading && forYou && <span className="text-[10px] text-muted-foreground ml-auto">Readiness {forYou.readinessAvg}/100{forYou.activeInjuries.length ? ` · ${forYou.activeInjuries.length} active injury` : ""}</span>}
        </div>
        {!dossierLoading && forYou ? (
          <>
            <div className="flex flex-wrap gap-1.5 mt-2 mb-3">
              {forYou.weakestBuckets.length ? forYou.weakestBuckets.map((b) => (
                <span key={b} className="text-[10px] px-2 py-1 rounded-full bg-energy/10 text-energy border border-energy/20 flex items-center gap-1"><Target size={10} /> Weak: {b.replace("_", " ")}</span>
              )) : <span className="text-[10px] px-2 py-1 rounded-full bg-muted/40 border border-border">Log metrics to unlock VPR-based picks</span>}
              {forYou.activeInjuries.slice(0, 2).map((inj: any, i: number) => (
                <span key={i} className="text-[10px] px-2 py-1 rounded-full bg-destructive/10 text-destructive border border-destructive/20 flex items-center gap-1"><AlertTriangle size={10} /> {inj.body_part} · {inj.status}</span>
              ))}
              {forYou.outcomeGoals.map((g: any) => (
                <span key={g.title} className="text-[10px] px-2 py-1 rounded-full bg-primary/10 text-primary border border-primary/20">{g.title}</span>
              ))}
            </div>
            <div className="grid md:grid-cols-3 gap-2">
              {forYou.picks.map(({ e, reasons }, idx) => {
                const meta = FOCUS_META[e.focus] ?? FOCUS_META.Prehab;
                const Icon = meta.icon;
                const isRecovery = forYou.readinessAvg < 55 && (e.focus === "Mobility" || e.focus === "Recovery");
                return (
                  <motion.div key={e.name + idx} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 + idx * 0.04 }}
                    className={`p-4 rounded-xl border ${isRecovery ? "border-success/40 bg-success/5" : "border-primary/20 bg-card/60"} hover:border-primary/40 transition-colors`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full border flex items-center gap-1 ${meta.tone}`}><Icon size={10} /> {e.focus}</span>
                      <span className="text-[10px] text-muted-foreground font-mono">{e.sets}</span>
                    </div>
                    <h3 className="font-semibold text-sm">{e.name}</h3>
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{e.benefit}</p>
                    {reasons.length > 0 && <p className="text-[11px] text-primary mt-2 leading-tight">↳ {reasons[0]}</p>}
                  </motion.div>
                );
              })}
            </div>
            {forYou.readinessAvg < 50 && (
              <p className="text-xs text-energy mt-3 flex items-center gap-1.5"><AlertTriangle size={12} /> Readiness is low — favour mobility & aerobic picks above; push hard sessions to next week.</p>
            )}
            {forYou.activeInjuries.length > 0 && (
              <p className="text-xs text-muted-foreground mt-2">High-impact work hidden while injured. Low-impact alternatives shown. Clear injuries in Injury Mgmt when resolved.</p>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground mt-2">We’ll tailor picks once you log a few metrics, goals and recovery scores. Browse the full library below.</p>
        )}
      </motion.div>

      {/* Sport selector */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.06 }}
        className="p-4 rounded-2xl bg-card/40 border border-border">
        <div className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Primary Sport</div>
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          {sports.map((s) => (
            <button key={s} onClick={() => setSport(s)}
              className={`px-4 py-2 rounded-xl text-sm font-semibold whitespace-nowrap transition-all border ${
                sport === s
                  ? "bg-gradient-primary text-primary-foreground border-transparent shadow-glow"
                  : "bg-background/40 border-border text-muted-foreground hover:text-foreground hover:border-primary/30"
              }`}>{s}</button>
          ))}
        </div>
      </motion.div>

      {/* Phase selector */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
        className="grid grid-cols-2 md:grid-cols-5 gap-2">
        {PHASES.map((p) => (
          <button key={p.v} onClick={() => setPhase(p.v)}
            className={`p-3 rounded-xl border text-start transition-all ${
              phase === p.v
                ? "border-primary/60 bg-primary/10"
                : "border-border bg-card/40 hover:border-primary/30"
            }`}>
            <div className="flex items-center gap-2">
              <Clock size={14} className={phase === p.v ? "text-primary" : "text-muted-foreground"} />
              <span className="font-semibold text-sm">{p.l}</span>
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">{p.desc}</div>
          </button>
        ))}
      </motion.div>

      {/* Focus filter */}
      <div className="flex gap-2 flex-wrap">
        {focusList.map((f) => (
          <button key={f} onClick={() => setFocus(f === "All" ? null : f)}
            className={`px-3 py-1 rounded-full text-xs font-semibold transition-all ${
              (focus ?? "All") === f
                ? "bg-foreground text-background"
                : "bg-muted/30 text-muted-foreground hover:text-foreground"
            }`}>{f}</button>
        ))}
      </div>

      <AnimatePresence mode="popLayout">
        <motion.div key={`${sport}-${phase}-${focus}`}
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
          className="grid md:grid-cols-2 gap-3">
          {filtered.map((e, idx) => {
            const meta = FOCUS_META[e.focus] ?? FOCUS_META.Prehab;
            const Icon = meta.icon;
            return (
              <motion.div key={e.name + idx} layout
                initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.04 }}
                className="group p-5 rounded-2xl bg-card/40 border border-border hover:border-primary/40 transition-all hover:shadow-glow">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold">{e.name}</h3>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full border flex items-center gap-1 ${meta.tone}`}>
                    <Icon size={10} /> {e.focus}
                  </span>
                </div>
                <div className="text-sm text-muted-foreground mb-2 font-mono">{e.sets}</div>
                <div className="text-sm">{e.benefit}</div>
              </motion.div>
            );
          })}
          {filtered.length === 0 && (
            <div className="col-span-2 p-8 text-center text-muted-foreground">
              Nothing in this combo. Try another phase or focus.
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
};

export default CrossTraining;
