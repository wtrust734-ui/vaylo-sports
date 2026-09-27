import { getAiLocale } from "@/i18n";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import Reveal from "@/components/motion/Reveal";
import AnimatedNumber from "@/components/motion/AnimatedNumber";
import { toast } from "sonner";
import { Target, Flame, AlertTriangle, Check, X, Plus, Sparkles, Trash2, Users, TrendingUp, HelpCircle, Coins } from "lucide-react";
import { FEATURE_COSTS } from "@/config/credits";
import { getLocalPBs } from "@/lib/athleteDossier";
import {
  type OutcomeGoal, type ProcessGoal, type DailyAction, type ActionLog,
  outcomeProgress, requiredRate, reliabilityScore, currentStreak,
  weeklyCompletionForProcess, todayCompletionMap, toggleAction, isoDate,
} from "@/lib/goals";
import ReactMarkdown from "react-markdown";
import NaturalLanguageGoalInput from "@/components/goals/NaturalLanguageGoalInput";



const Goals = () => {
  const { user } = useAuth();
  const [outcomes, setOutcomes] = useState<OutcomeGoal[]>([]);
  const [processes, setProcesses] = useState<ProcessGoal[]>([]);
  const [actions, setActions] = useState<DailyAction[]>([]);
  const [logs, setLogs] = useState<ActionLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [showOutcome, setShowOutcome] = useState(false);
  const [showProcess, setShowProcess] = useState<string | null>(null);
  const [showAction, setShowAction] = useState<string | null>(null);
  const [aiFeedback, setAiFeedback] = useState<string>("");
  const [aiLoading, setAiLoading] = useState(false);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const [o, p, a, l] = await Promise.all([
      supabase.from("outcome_goals").select("*").eq("user_id", user.id).order("created_at"),
      supabase.from("process_goals").select("*").eq("user_id", user.id).order("created_at"),
      supabase.from("daily_actions").select("*").eq("user_id", user.id).eq("active", true),
      supabase.from("daily_action_logs").select("*").eq("user_id", user.id)
        .gte("log_date", isoDate(new Date(Date.now() - 30 * 86400000))),
    ]);
    setOutcomes(o.data ?? []);
    setProcesses(p.data ?? []);
    setActions(a.data ?? []);
    setLogs(l.data ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [user]);

  const reliability = useMemo(() => reliabilityScore(actions, logs), [actions, logs]);
  const streak = useMemo(() => currentStreak(actions, logs), [actions, logs]);
  const todayMap = useMemo(() => todayCompletionMap(actions, logs), [actions, logs]);
  const todayDone = actions.filter(a => todayMap[a.id]).length;
  const todayPct = actions.length ? Math.round((todayDone / actions.length) * 100) : 0;

  const reliabilityColor =
    reliability >= 75 ? "text-success" : reliability >= 50 ? "text-warning" : "text-destructive";

  const streakAtRisk = streak > 0 && actions.some(a => !todayMap[a.id]);

  const handleToggle = async (action: DailyAction) => {
    if (!user) return;
    const done = !todayMap[action.id];
    const { error } = await toggleAction(action.id, user.id, done);
    if (error) { toast.error("Failed to update"); return; }
    if (done) toast.success("Locked in.");
    load();
  };

  const runAiReview = async () => {
    setAiLoading(true);
    try {
      const stats = {
        reliability_score: reliability,
        current_streak: streak,
        today_completion_pct: todayPct,
        outcome_goals: outcomes.map(g => ({
          title: g.title, progress_pct: outcomeProgress(g),
          deadline: g.deadline, required_rate: requiredRate(g),
        })),
        weekly_process: processes.map(pg => {
          const w = weeklyCompletionForProcess(pg, actions, logs);
          return { title: pg.title, target: w.target, done: w.done, pct: w.pct };
        }),
      };
      const { data, error } = await supabase.functions.invoke("weekly-review", { body: { stats, userLocale: getAiLocale(), pbs: getLocalPBs().slice(0, 20).map((p) => ({ metric: p.metric, value: p.value, unit: p.unit, date: p.date })) } });
      if (error) throw error;
      const payload = (data ?? {}) as { error?: string; feedback?: string; balance?: number | null; cost?: number };
      if (payload.error && payload.error.includes("Not enough credits")) {
        toast.error(payload.error);
        return;
      }
      setAiFeedback(payload.feedback);
      if (payload.balance != null) toast.success(`Review complete${payload.cost ? ` — ${payload.cost} credits used` : ""}.`);
    } catch (e: any) {
      const msg = e?.message ?? "Failed";
      if (msg.includes("Not enough credits") || msg.includes("Insufficient") || e?.status === 402) {
        toast.error(msg.includes("credits") ? msg : "Not enough credits for Weekly Coach Review — need 3 credits.");
      } else {
        toast.error(msg);
      }
    } finally {
      setAiLoading(false);
    }
  };

  const goalCost = FEATURE_COSTS.weekly_coach_review;

  return (
    <div className="min-h-screen pb-32 pt-20 px-4 max-w-3xl mx-auto space-y-5">
      {/* One simple entry point — natural language is the primary way to add a goal */}
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest text-muted-foreground">
        <HelpCircle size={12} /> How goals work: <span className="text-foreground normal-case font-medium">Set a long-term target → add a weekly habit → tick daily actions.</span>
      </div>
      <NaturalLanguageGoalInput onCreated={load} />
      {/* Hero */}
      <Reveal>
        <Card className="p-5 bg-gradient-to-br from-primary/15 via-card to-card border-primary/30">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Accountability</p>
              <h1 className="text-2xl font-display font-bold text-gradient-electric">Goals & Pressure</h1>
            </div>
            <Target className="text-primary" size={28} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Reliability" value={reliability} suffix="%" className={reliabilityColor} />
            <Stat label="Streak" value={streak} suffix="d" icon={<Flame size={14} className="text-energy" />} />
            <Stat label="Today" value={todayPct} suffix="%" className={todayPct === 100 ? "text-success" : todayPct === 0 ? "text-destructive" : "text-warning"} />
          </div>
          {streakAtRisk && (
            <div className="mt-4 p-3 rounded-lg bg-destructive/15 border border-destructive/40 flex items-center gap-2 text-sm text-destructive font-medium">
              <AlertTriangle size={16} /> You are about to lose your {streak}-day streak. Close it out today.
            </div>
          )}
          {reliability < 60 && actions.length > 0 && (
            <div className="mt-3 p-3 rounded-lg bg-warning/10 border border-warning/40 flex items-center gap-2 text-sm text-warning font-medium">
              <TrendingUp size={16} /> Consistency below target. This will cost you results.
            </div>
          )}
        </Card>
      </Reveal>

      {/* 1 · Outcome goals — the destination */}
      <Reveal delay={0.05}>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm uppercase tracking-[0.2em] font-semibold text-muted-foreground">1 · Outcome — where you want to get to</h2>
          <Button size="sm" variant="ghost" onClick={() => setShowOutcome(true)}><Plus size={14} className="mr-1" /> New</Button>
        </div>
        <div className="space-y-3">
          {outcomes.length === 0 && <EmptyHint text="Set your first long-term target." />}
          {outcomes.map(g => {
            const pct = outcomeProgress(g);
            const linkedProcs = processes.filter(p => p.outcome_goal_id === g.id);
            return (
              <Card key={g.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold truncate">{g.title}</h3>
                    {g.description && <p className="text-xs text-muted-foreground mt-0.5">{g.description}</p>}
                  </div>
                  <Badge variant="outline" className="text-xs">{g.category}</Badge>
                </div>
                <div className="mt-3">
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-muted-foreground">{Number(g.current_value ?? 0)} / {Number(g.target_value ?? 0)} {g.metric_unit}</span>
                    <span className="font-semibold">{pct}%</span>
                  </div>
                  <Progress value={pct} className="h-2" />
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                  <Mini label="Deadline" value={g.deadline ?? "—"} />
                  <Mini label="Required" value={requiredRate(g)} />
                  <Mini label="Process goals" value={String(linkedProcs.length)} />
                </div>
                <div className="mt-3 flex flex-wrap justify-between items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => setShowProcess(g.id)}>
                    <Plus size={12} className="mr-1" /> Process goal
                  </Button>
                  <div className="flex items-center gap-1">
                    {g.status !== "completed" && (
                      <>
                        <Button size="sm" variant="ghost" className="text-success hover:text-success"
                          onClick={async () => {
                            const { error } = await supabase.from("outcome_goals").update({ status: "completed", current_value: g.target_value }).eq("id", g.id);
                            if (error) { toast.error(error.message); return; }
                            toast.success("Goal hit. Lock in.");
                            load();
                          }}>
                          <Check size={14} className="mr-1" /> Hit it
                        </Button>
                        <Button size="sm" variant="ghost" className="text-energy hover:text-energy"
                          onClick={async () => {
                            const { error } = await supabase.from("outcome_goals").update({ status: "partial" }).eq("id", g.id);
                            if (error) { toast.error(error.message); return; }
                            toast.success("Logged as close — review what blocked you.");
                            load();
                          }}>
                          Got close
                        </Button>
                      </>
                    )}
                    {g.status === "completed" && (
                      <Badge variant="outline" className="text-success border-success/40">Completed ✓</Badge>
                    )}
                    {g.status === "partial" && (
                      <Badge variant="outline" className="text-energy border-energy/40">Close call</Badge>
                    )}
                    <button
                      className="text-xs text-muted-foreground hover:text-destructive transition ml-1"
                      onClick={async () => {
                        const { error } = await supabase.from("outcome_goals").delete().eq("id", g.id);
                        if (error) { toast.error(error.message); return; }
                        load();
                      }}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      </Reveal>

      {/* 2 · Weekly process goals — the habit that gets you there */}
      <Reveal delay={0.1}>
        <h2 className="text-sm uppercase tracking-[0.2em] font-semibold text-muted-foreground mb-2">2 · Weekly habits — what you'll do each week</h2>
        <div className="space-y-3">
          {processes.length === 0 && <EmptyHint text="No weekly process goals yet." />}
          {processes.map(pg => {
            const w = weeklyCompletionForProcess(pg, actions, logs);
            const linkedActions = actions.filter(a => a.process_goal_id === pg.id);
            return (
              <Card key={pg.id} className="p-4">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-semibold">{pg.title}</h3>
                    <p className="text-xs text-muted-foreground">{w.done}/{w.target} this week</p>
                  </div>
                  <span className={`text-lg font-bold ${w.pct === 100 ? "text-success" : w.pct < 50 ? "text-destructive" : "text-foreground"}`}>{w.pct}%</span>
                </div>
                <Progress value={w.pct} className="h-1.5 mt-2" />
                <div className="mt-3 flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">{linkedActions.length} daily action{linkedActions.length !== 1 ? "s" : ""}</p>
                  <Button size="sm" variant="ghost" onClick={() => setShowAction(pg.id)}>
                    <Plus size={12} className="mr-1" /> Action
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      </Reveal>

      {/* 3 · Daily actions — today's checklist */}
      <Reveal delay={0.15}>
        <h2 className="text-sm uppercase tracking-[0.2em] font-semibold text-muted-foreground mb-2">3 · Today — tick what you did</h2>
        <Card className="p-2">
          {actions.length === 0 ? (
            <EmptyHint text="Add a daily action to a process goal." />
          ) : (
            <div className="divide-y divide-border">
              {actions.map(a => {
                const done = !!todayMap[a.id];
                return (
                  <button
                    key={a.id}
                    onClick={() => handleToggle(a)}
                    className={`w-full flex items-center gap-3 px-3 py-3 text-start transition ${
                      done ? "bg-success/5" : ""
                    }`}>
                    <div className={`w-7 h-7 rounded-md flex items-center justify-center border-2 transition ${
                      done ? "bg-success border-success text-success-foreground" : "border-destructive/60 text-destructive"
                    }`}>
                      {done ? <Check size={16} /> : <X size={14} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium ${done ? "line-through text-muted-foreground" : ""}`}>{a.title}</p>
                    </div>
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        const { error } = await supabase.from("daily_actions").update({ active: false }).eq("id", a.id);
                        if (error) { toast.error(error.message); return; }
                        load();
                      }}
                      className="text-muted-foreground hover:text-destructive">
                      <Trash2 size={14} />
                    </button>
                  </button>
                );
              })}
            </div>
          )}
        </Card>
      </Reveal>

      {/* AI Coach — 3 credits per review */}
      <Reveal delay={0.2}>
        <Card className="p-4 border-primary/30 bg-gradient-to-br from-primary/10 to-card">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Sparkles size={18} className="text-primary" />
              <h3 className="font-semibold">Weekly Coach Review</h3>
              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-energy bg-energy/10 border border-energy/20 rounded-full px-2 py-0.5"><Coins size={11} /> {goalCost} credits</span>
            </div>
            <Button size="sm" onClick={runAiReview} disabled={aiLoading}>
              {aiLoading ? "Analyzing…" : `Run Review · ${goalCost} cr`}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground mb-2">Each review costs {goalCost} credits. Your goals, streak and today’s completion are analysed — PBs and recovery are included when available.</p>
          {aiFeedback ? (
            <div className="prose prose-sm prose-invert max-w-none text-sm">
              <ReactMarkdown>{aiFeedback}</ReactMarkdown>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Direct, honest feedback on your consistency and goals.</p>
          )}
        </Card>
      </Reveal>

      {/* Accountability partners hint */}
      <Reveal delay={0.25}>
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-1">
            <Users size={16} className="text-primary" />
            <h3 className="font-semibold text-sm">Accountability Partners</h3>
          </div>
          <p className="text-xs text-muted-foreground mb-3">Friends can see your goal progress, weekly consistency and missed actions. Add partners from Friends.</p>
          <Button size="sm" variant="outline" onClick={() => (window.location.href = "/friends")}>Manage Friends</Button>
        </Card>
      </Reveal>

      {/* Dialogs */}
      <OutcomeDialog open={showOutcome} onClose={() => setShowOutcome(false)} userId={user?.id} onSaved={load} />
      <ProcessDialog open={!!showProcess} outcomeId={showProcess} onClose={() => setShowProcess(null)} userId={user?.id} onSaved={load} />
      <ActionDialog open={!!showAction} processId={showAction} onClose={() => setShowAction(null)} userId={user?.id} onSaved={load} />
    </div>
  );
};

const Stat = ({ label, value, suffix, className, icon }: any) => (
  <div className="text-center">
    <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-1 flex items-center justify-center gap-1">{icon}{label}</p>
    <p className={`text-2xl font-display font-bold ${className ?? ""}`}>
      <AnimatedNumber value={value} />{suffix}
    </p>
  </div>
);

const Mini = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-md bg-muted/30 p-2">
    <p className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</p>
    <p className="text-xs font-medium truncate">{value}</p>
  </div>
);

const EmptyHint = ({ text }: { text: string }) => (
  <div className="p-6 text-center text-sm text-muted-foreground">{text}</div>
);

const OutcomeDialog = ({ open, onClose, userId, onSaved }: any) => {
  const [f, setF] = useState({ title: "", category: "performance", target_value: "", metric_unit: "", deadline: "", current_value: "0" });
  const submit = async () => {
    if (!f.title || !userId) return;
    const { error } = await supabase.from("outcome_goals").insert({
      user_id: userId, title: f.title, category: f.category,
      target_value: f.target_value ? Number(f.target_value) : null,
      current_value: Number(f.current_value || 0),
      metric_unit: f.metric_unit || null,
      deadline: f.deadline || null,
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Outcome goal added");
    setF({ title: "", category: "performance", target_value: "", metric_unit: "", deadline: "", current_value: "0" });
    onSaved(); onClose();
  };
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>New Outcome Goal</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Input placeholder="Title (e.g. Sub-18 5K)" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} />
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="Current" value={f.current_value} onChange={e => setF({ ...f, current_value: e.target.value })} />
            <Input placeholder="Target" value={f.target_value} onChange={e => setF({ ...f, target_value: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="Unit (kg, sec, km)" value={f.metric_unit} onChange={e => setF({ ...f, metric_unit: e.target.value })} />
            <Input type="date" value={f.deadline} onChange={e => setF({ ...f, deadline: e.target.value })} />
          </div>
          <Button className="w-full" onClick={submit}>Create</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

const ProcessDialog = ({ open, outcomeId, onClose, userId, onSaved }: any) => {
  const [title, setTitle] = useState("");
  const [target, setTarget] = useState("3");
  const submit = async () => {
    if (!title || !userId) return;
    const { error } = await supabase.from("process_goals").insert({
      user_id: userId, outcome_goal_id: outcomeId, title, weekly_target: Number(target) || 3,
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Process goal added");
    setTitle(""); setTarget("3");
    onSaved(); onClose();
  };
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>Weekly Process Goal</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Input placeholder="e.g. 4 quality runs / week" value={title} onChange={e => setTitle(e.target.value)} />
          <Input type="number" placeholder="Weekly target (e.g. 4)" value={target} onChange={e => setTarget(e.target.value)} />
          <Button className="w-full" onClick={submit}>Create</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

const ActionDialog = ({ open, processId, onClose, userId, onSaved }: any) => {
  const [title, setTitle] = useState("");
  const submit = async () => {
    if (!title || !userId) return;
    const { error } = await supabase.from("daily_actions").insert({
      user_id: userId, process_goal_id: processId, title,
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Daily action added");
    setTitle("");
    onSaved(); onClose();
  };
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>Daily Action</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Input placeholder="e.g. 30-min run" value={title} onChange={e => setTitle(e.target.value)} />
          <Button className="w-full" onClick={submit}>Create</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default Goals;
