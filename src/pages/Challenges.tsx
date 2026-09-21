import { useEffect, useMemo, useState } from "react";
import { localDateKey } from "@/lib/dates";
import { motion } from "framer-motion";
import { Trophy, Target, Users, Plus, Clock, Filter, CheckCircle2, Sparkles, Medal } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { joinChallenge, leaveChallenge } from "@/lib/scoring";
import { toast } from "sonner";
import SponsoredSlot from "@/components/sponsor/SponsoredSlot";


interface Challenge {
  id: string; title: string; description: string | null; type: string; sport: string | null;
  scope: string; target_value: number; target_unit: string;
  start_date: string; end_date: string; icon: string | null;
  reward_credits: number; reward_points: number; participant_count: number;
  /** Set only on brand challenges. Rows are hidden from under-18s by RLS. */
  sponsor_name?: string | null; sponsor_disclosure?: string | null;
}
interface Participant { challenge_id: string; progress: number; status: string; completed_at: string | null; }

const TABS = ["Active", "My Challenges", "History"] as const;
const SCOPES = ["all","weekly","monthly","custom"] as const;

const Challenges = () => {
  const { user, profile } = useAuth();
  const nav = useNavigate();
  const [tab, setTab] = useState<typeof TABS[number]>("Active");
  const [scope, setScope] = useState<typeof SCOPES[number]>("all");
  const [items, setItems] = useState<Challenge[]>([]);
  const [mine, setMine] = useState<Record<string, Participant>>({});
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [prefill, setPrefill] = useState<any>(null);


  const load = async () => {
    setLoading(true);
    const client = supabase as any;
    const { data: ch } = await client.from("challenges").select("*").order("start_date", { ascending: false }).limit(200);
    setItems(ch || []);
    if (user) {
      const { data: parts } = await client.from("challenge_participants").select("*").eq("user_id", user.id);
      const map: Record<string, Participant> = {};
      (parts || []).forEach((p: any) => { map[p.challenge_id] = p; });
      setMine(map);
    }
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [user?.id]);

  const now = new Date();
  const filtered = items.filter(c => {
    const isActive = new Date(c.end_date) >= now;
    if (tab === "Active" && !isActive) return false;
    if (tab === "My Challenges" && !mine[c.id]) return false;
    if (tab === "History" && (isActive && mine[c.id]?.status !== "completed")) return false;
    if (scope !== "all" && c.scope !== scope) return false;
    return true;
  });

  const handleJoin = async (id: string) => {
    const { error } = await joinChallenge(id);
    if (error) return toast.error(error.message);
    toast.success("Joined challenge");
    load();
  };
  const handleLeave = async (id: string) => {
    const { error } = await leaveChallenge(id);
    if (error) return toast.error(error.message);
    toast.success("Left challenge");
    load();
  };

  const suggestions = useMemo(() => buildSuggestions(profile, items, mine), [profile, items, mine]);

  const activeCount = items.filter(c => new Date(c.end_date) >= now).length;
  const joinedCount = Object.keys(mine).length;
  const completedCount = Object.values(mine).filter(m => m.status === "completed").length;

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Hero */}
      <div className="relative overflow-hidden">
        <div className="absolute -top-24 -right-16 w-72 h-72 bg-electric-purple/20 blur-[110px] rounded-full pointer-events-none" />
        <div className="absolute -top-32 left-0 w-72 h-72 bg-primary/20 blur-[110px] rounded-full pointer-events-none" />
        <div className="relative px-5 pt-14 pb-5">
          <p className="text-[11px] uppercase tracking-widest text-energy font-semibold flex items-center gap-1.5">
            <Trophy size={12} /> Compete
          </p>
          <h1 className="text-3xl font-display font-bold mt-1 tracking-tight">Challenges</h1>
          <p className="text-sm text-muted-foreground mt-1">Take on challenges, unlock trophies & badges for your Trophy Room.</p>
          <div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2">
            <p className="text-[11px] leading-relaxed text-amber-200/90">
              <span className="font-bold text-amber-200">Disclaimer:</span> Challenges are community goals for motivation and bragging rights — they are <span className="font-semibold">not personalised training prescriptions</span>. Train responsibly, respect any injury or recovery guidance from your coach or clinician, and skip anything that doesn’t fit your programme or health status. Brand challenges are paid partnerships and are always labelled; the brand’s products are not part of your training plan, and nothing in a brand challenge is medical or professional advice.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2 mt-4">
            {[
              { label: "Active", value: activeCount, color: "text-primary" },
              { label: "Joined", value: joinedCount, color: "text-energy" },
              { label: "Won", value: completedCount, color: "text-success" },
            ].map(s => (
              <div key={s.label} className="bg-card/60 backdrop-blur border border-border rounded-xl px-3 py-2 text-center">
                <p className={`text-xl font-display font-bold ${s.color}`}>{s.value}</p>
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Sponsored slot — renders nothing unless there is an active sponsor AND
          the athlete is 18+. The database refuses it for minors too. */}
      <SponsoredSlot placement="challenge" sport={profile?.sport ?? null} className="px-5 mb-4" />

      {/* Personalised suggestions */}
      {suggestions.length > 0 && (
        <div className="px-5 mb-4">
          <p className="text-[11px] uppercase tracking-widest text-primary font-semibold flex items-center gap-1.5 mb-2">
            <Sparkles size={11} /> Suggested for you
          </p>
          <div className="grid gap-2">
            {suggestions.map((s, i) => (
              <motion.button key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
                onClick={() => { setPrefill(s); setCreating(true); }}
                className="text-left bg-gradient-to-r from-card to-primary/5 border border-primary/20 rounded-xl p-3 hover:border-primary/60 hover:shadow-glow transition-all">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-lg bg-primary/15 flex items-center justify-center text-lg shrink-0">{s.icon}</div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate">{s.title}</p>
                      <p className="text-[11px] text-muted-foreground truncate">{s.reason}</p>
                    </div>
                  </div>
                  <span className="flex items-center gap-1 text-[10px] text-energy font-semibold shrink-0 bg-energy/10 border border-energy/30 rounded-full px-2 py-0.5">
                    <Medal size={10}/> Trophy
                  </span>
                </div>
              </motion.button>
            ))}
          </div>
        </div>
      )}


      <div className="px-5 flex gap-1.5 mb-3 overflow-x-auto no-scrollbar">
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-full text-xs font-semibold whitespace-nowrap border transition-all ${
              tab === t ? "bg-gradient-to-r from-primary to-electric-purple text-primary-foreground border-transparent shadow-glow" : "bg-card border-border text-muted-foreground hover:border-primary/40"
            }`}>
            {t}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1 text-xs shrink-0">
          <Filter size={12} className="text-muted-foreground" />
          <select value={scope} onChange={e => setScope(e.target.value as any)} className="bg-card border border-border rounded-lg px-2 py-1">
            {SCOPES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      <div className="px-5 flex items-center justify-between mb-3">
        <p className="text-xs text-muted-foreground">{filtered.length} challenges</p>
        <button onClick={() => setCreating(true)} className="flex items-center gap-1 text-xs font-semibold text-primary hover:text-electric-purple transition-colors">
          <Plus size={14} /> Create
        </button>
      </div>

      {loading ? <p className="px-5 text-sm text-muted-foreground">Loading…</p> : filtered.length === 0 ? (
        <div className="px-5 py-16 text-center">
          <Target className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No challenges here yet.</p>
        </div>
      ) : (
        <div className="px-5 space-y-3">
          {filtered.map((c, i) => {
            const p = mine[c.id];
            const pct = Math.min(100, Math.round(((p?.progress || 0) / Number(c.target_value || 1)) * 100));
            const daysLeft = Math.max(0, Math.ceil((new Date(c.end_date).getTime() - now.getTime()) / 86400000));
            const done = p?.status === "completed";
            return (
              <motion.div key={c.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
                className={`relative overflow-hidden bg-card border rounded-2xl p-4 transition-all ${
                  done ? "border-primary/50 shadow-glow" : "border-border hover:border-primary/30"
                }`}>
                {done && <div className="absolute top-0 right-0 w-24 h-24 bg-primary/10 blur-2xl rounded-full pointer-events-none" />}
                <div className="relative flex items-start justify-between gap-2">
                  <button onClick={() => nav(`/challenges/${c.id}`)} className="text-left flex-1 min-w-0 flex items-start gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0 ${
                      done ? "bg-primary/20" : "bg-muted"
                    }`}>{c.icon || "🏆"}</div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <h3 className="font-display font-bold truncate">{c.title}</h3>
                        {done && <CheckCircle2 size={14} className="text-primary shrink-0" />}
                      </div>
                      {c.sponsor_name && (
                        <span className="mt-1 inline-flex items-center rounded-full border border-border bg-muted/60 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">
                          {c.sponsor_disclosure?.trim() || "Sponsored"} · {c.sponsor_name}
                        </span>
                      )}
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{c.description}</p>
                    </div>
                  </button>
                  <div className="text-right shrink-0">
                    <p className="text-[9px] uppercase tracking-widest text-muted-foreground">Reward</p>
                    <p className="text-xs font-bold text-energy flex items-center gap-1 mt-0.5"><Medal size={11}/> Trophy</p>
                  </div>
                </div>

                <div className="relative flex flex-wrap items-center gap-x-3 gap-y-1 mt-3 text-[11px] text-muted-foreground">
                  <span className="uppercase tracking-wide font-semibold text-foreground/70">{c.scope}</span>
                  {c.sport && <span>· {c.sport}</span>}
                  <span className="flex items-center gap-1"><Clock size={10} /> {daysLeft}d left</span>
                  <span className="flex items-center gap-1"><Users size={10} /> {c.participant_count}</span>
                </div>

                <div className="relative mt-3">
                  <div className="flex items-center justify-between text-[11px] mb-1">
                    <span className="text-muted-foreground">Progress · {pct}%</span>
                    <span className="font-semibold">{(p?.progress || 0).toFixed(1)} / {c.target_value} {c.target_unit}</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.8, ease: "easeOut" }}
                      className={`h-full rounded-full ${done ? "bg-gradient-to-r from-primary to-electric-purple" : "bg-gradient-to-r from-energy to-primary"}`} />
                  </div>
                </div>

                <div className="relative flex gap-2 mt-3">
                  {p ? (
                    <>
                      <button onClick={() => nav(`/challenges/${c.id}`)}
                        className="flex-1 py-2 rounded-lg bg-gradient-to-r from-primary to-electric-purple text-primary-foreground text-xs font-semibold shadow-glow">
                        {done ? "View trophy" : "Log progress"}
                      </button>
                      {!done && <button onClick={() => handleLeave(c.id)} className="px-3 py-2 rounded-lg border border-border text-xs hover:border-destructive/40 hover:text-destructive transition-colors">Leave</button>}
                    </>
                  ) : (
                    <button onClick={() => handleJoin(c.id)}
                      className="flex-1 py-2 rounded-lg bg-gradient-to-r from-primary to-electric-purple text-primary-foreground text-xs font-semibold shadow-glow">
                      Join challenge
                    </button>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {creating && <CreateChallengeModal onClose={() => { setCreating(false); setPrefill(null); }} onCreated={() => { setCreating(false); setPrefill(null); load(); }} userId={user?.id || ""} prefill={prefill} />}
    </div>
  );
};

// --- Personalised suggestions ---
type Suggestion = {
  title: string; icon: string; reason: string;
  type: string; scope: string; sport: string | null; target_value: number; target_unit: string;
};

const SUGGESTION_BANK: Record<string, Suggestion[]> = {
  running: [
    { title: "30km week", icon: "🏃", reason: "Base-building block for your sport", type: "distance", scope: "weekly", sport: "running", target_value: 30, target_unit: "km" },
    { title: "5 quality sessions", icon: "🔥", reason: "Frequency over volume", type: "count", scope: "weekly", sport: "running", target_value: 5, target_unit: "sessions" },
  ],
  cycling: [
    { title: "150km ride week", icon: "🚴", reason: "Aerobic base for cyclists", type: "distance", scope: "weekly", sport: "cycling", target_value: 150, target_unit: "km" },
  ],
  swimming: [
    { title: "6km pool volume", icon: "🏊", reason: "Consistent technique volume", type: "distance", scope: "weekly", sport: "swimming", target_value: 6, target_unit: "km" },
  ],
  football: [
    { title: "4 skill sessions", icon: "⚽", reason: "Ball-work reps compound fast", type: "count", scope: "weekly", sport: "football", target_value: 4, target_unit: "sessions" },
  ],
  basketball: [
    { title: "500 shots week", icon: "🏀", reason: "Shooting volume tied to accuracy", type: "count", scope: "weekly", sport: "basketball", target_value: 500, target_unit: "shots" },
  ],
  gym: [
    { title: "4 gym sessions", icon: "🏋️", reason: "Strength baseline block", type: "count", scope: "weekly", sport: "gym", target_value: 4, target_unit: "sessions" },
  ],
  weightlifting: [
    { title: "4 lifting sessions", icon: "🏋️", reason: "Strength baseline block", type: "count", scope: "weekly", sport: "weightlifting", target_value: 4, target_unit: "sessions" },
  ],
};

const GOAL_SUGGESTIONS: Record<string, Suggestion> = {
  endurance: { title: "300 aerobic minutes", icon: "❤️", reason: "Matches your endurance goal", type: "duration", scope: "weekly", sport: null, target_value: 300, target_unit: "minutes" },
  strength: { title: "12 strength sessions", icon: "💪", reason: "Matches your strength goal", type: "count", scope: "monthly", sport: null, target_value: 12, target_unit: "sessions" },
  power: { title: "8 power sessions", icon: "⚡", reason: "Matches your power goal", type: "count", scope: "monthly", sport: null, target_value: 8, target_unit: "sessions" },
  "fat loss": { title: "Log 21 clean days", icon: "🥗", reason: "Consistency for fat loss", type: "count", scope: "monthly", sport: null, target_value: 21, target_unit: "days" },
  "muscle gain": { title: "16 lifting sessions", icon: "🏋️", reason: "Volume for hypertrophy", type: "count", scope: "monthly", sport: null, target_value: 16, target_unit: "sessions" },
  recovery: { title: "20 recovery check-ins", icon: "🧘", reason: "Track readiness daily", type: "count", scope: "monthly", sport: null, target_value: 20, target_unit: "check-ins" },
};

const FALLBACK: Suggestion[] = [
  { title: "Move every day", icon: "🔥", reason: "Streak-builder for any athlete", type: "count", scope: "weekly", sport: null, target_value: 7, target_unit: "days" },
  { title: "10 workouts this month", icon: "🎯", reason: "Solid monthly base", type: "count", scope: "monthly", sport: null, target_value: 10, target_unit: "workouts" },
];

function buildSuggestions(profile: any, items: Challenge[], mine: Record<string, Participant>): Suggestion[] {
  const sport = (profile?.sport || "").toLowerCase();
  const goals: string[] = (profile?.goals || []).map((g: string) => g.toLowerCase());
  const list: Suggestion[] = [];

  const sportKey = Object.keys(SUGGESTION_BANK).find(k => sport.includes(k));
  if (sportKey) list.push(...SUGGESTION_BANK[sportKey]);

  for (const g of goals) {
    const key = Object.keys(GOAL_SUGGESTIONS).find(k => g.includes(k));
    if (key) list.push(GOAL_SUGGESTIONS[key]);
  }

  if (list.length === 0) list.push(...FALLBACK);

  // Deduplicate + filter out titles already present as joined challenges
  const joinedTitles = new Set(Object.keys(mine).map(id => items.find(c => c.id === id)?.title));
  const seen = new Set<string>();
  return list.filter(s => {
    if (joinedTitles.has(s.title)) return false;
    if (seen.has(s.title)) return false;
    seen.add(s.title);
    return true;
  }).slice(0, 3);
}

const CreateChallengeModal = ({ onClose, onCreated, userId, prefill }: { onClose: () => void; onCreated: () => void; userId: string; prefill?: any }) => {
  const [title, setTitle] = useState(prefill?.title ?? "");
  const [type, setType] = useState(prefill?.type ?? "distance");
  const [scope, setScope] = useState(prefill?.scope ?? "weekly");
  const [sport, setSport] = useState(prefill?.sport ?? "");
  const [target, setTarget] = useState(prefill?.target_value ? String(prefill.target_value) : "25");
  const [unit, setUnit] = useState(prefill?.target_unit ?? "km");

  const save = async () => {
    if (!title) return toast.error("Title required");
    const days = scope === "weekly" ? 7 : scope === "monthly" ? 30 : 14;
    const end = new Date(); end.setDate(end.getDate() + days);
    const { error } = await (supabase as any).from("challenges").insert({
      creator_id: userId, title, description: `${type} challenge`, type, sport: sport || null, scope,
      target_value: Number(target), target_unit: unit, start_date: localDateKey(),
      end_date: localDateKey(end), reward_points: 0, reward_credits: 0, icon: prefill?.icon ?? "🏁",
    });
    if (error) return toast.error(error.message);
    toast.success("Challenge created");
    onCreated();
  };


  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card w-full max-w-md rounded-2xl border border-border p-5" onClick={e => e.stopPropagation()}>
        <h3 className="font-display font-bold mb-3">New challenge</h3>
        <div className="space-y-2 text-sm">
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Title" className="w-full bg-muted rounded-lg px-3 py-2" />
          <div className="grid grid-cols-2 gap-2">
            <select value={type} onChange={e => setType(e.target.value)} className="bg-muted rounded-lg px-3 py-2">
              <option value="distance">Distance</option>
              <option value="duration">Duration</option>
              <option value="count">Activity count</option>
              <option value="sport">Sport-specific</option>
            </select>
            <select value={scope} onChange={e => setScope(e.target.value)} className="bg-muted rounded-lg px-3 py-2">
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="custom">Custom</option>
            </select>
            <input value={target} onChange={e => setTarget(e.target.value)} placeholder="Target" className="bg-muted rounded-lg px-3 py-2" />
            <input value={unit} onChange={e => setUnit(e.target.value)} placeholder="Unit" className="bg-muted rounded-lg px-3 py-2" />
            <input value={sport} onChange={e => setSport(e.target.value)} placeholder="Sport (optional)" className="col-span-2 bg-muted rounded-lg px-3 py-2" />
          </div>
        </div>
        <div className="flex gap-2 mt-4">
          <button onClick={onClose} className="flex-1 py-2 rounded-lg border border-border text-sm">Cancel</button>
          <button onClick={save} className="flex-1 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold">Create</button>
        </div>
      </div>
    </div>
  );
};

export default Challenges;
