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
import { Target, Flame, AlertTriangle, Check, X, Plus, Sparkles, Trash2, TrendingUp, HelpCircle, Coins, Compass, ChevronDown, CheckCircle2, Circle, MinusCircle, Flag } from "lucide-react";
import { FEATURE_COSTS } from "@/config/credits";
import { getLocalPBs } from "@/lib/athleteDossier";
import {
  type ProcessGoal, type DailyAction, type ActionLog,
  outcomeProgress, requiredRate, reliabilityScore, currentStreak,
  weeklyCompletionForProcess, todayCompletionMap, toggleAction, isoDate,
} from "@/lib/goals";
import { ageFromDob } from "@/lib/age";
import {
  PHASE_BLURBS, PHASE_LABELS, PROGRESS_LABELS,
  buildRoadmaps, type DevelopmentPhase, type GoalRoadmap, type RoadmapContext, type RoadmapGoalRow,
} from "@/lib/roadmap";
import { loadRoadmapContext, persistRoadmapPatches } from "@/lib/roadmapPlanning";
import ReactMarkdown from "react-markdown";
import NaturalLanguageGoalInput from "@/components/goals/NaturalLanguageGoalInput";
import { AI_NOT_READY_MESSAGE, isNotReadyMessage } from "@/lib/edgeErrors";
import { checkStreakAlert } from "@/lib/notificationTriggers";



const Goals = () => {
  const { user, profile } = useAuth();
  // The goal rows carry the roadmap columns as well as the goal itself: the
  // roadmap extends this table rather than adding a second one.
  const [outcomes, setOutcomes] = useState<RoadmapGoalRow[]>([]);
  // The record the roadmaps are derived from. Loading it separately means a
  // failed read leaves every goal working exactly as it did before.
  const [roadmapContext, setRoadmapContext] = useState<RoadmapContext>({});
  const [processes, setProcesses] = useState<ProcessGoal[]>([]);
  const [actions, setActions] = useState<DailyAction[]>([]);
  const [logs, setLogs] = useState<ActionLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [showOutcome, setShowOutcome] = useState(false);
  const [showProcess, setShowProcess] = useState<string | null>(null);
  const [showAction, setShowAction] = useState<string | null>(null);
  const [aiFeedback, setAiFeedback] = useState<string>("");
  const [aiLoading, setAiLoading] = useState(false);
  // Gates every destructive mutation on this page. Without it a double-tap on
  // the (already-confirmed) delete fired two DELETEs and the second reloaded
  // against rows that no longer existed.
  const [deleting, setDeleting] = useState(false);

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
    const loadedGoals = (o.data ?? []) as RoadmapGoalRow[];
    setOutcomes(loadedGoals);
    setProcesses(p.data ?? []);
    setActions(a.data ?? []);
    setLogs(l.data ?? []);
    setLoading(false);
    // In-app streak alert (fires at most once/day, respects prefs). Skipped
    // once everything is already done today — no risk, no nudge.
    const fetchedActions = a.data ?? [];
    const fetchedLogs = l.data ?? [];
    if (fetchedActions.length) {
      const todayKey = isoDate(new Date());
      const allDoneToday = fetchedActions.every((act) =>
        fetchedLogs.some((lg) => lg.action_id === act.id && lg.log_date === todayKey && lg.completed));
      if (!allDoneToday) {
        const stk = currentStreak(fetchedActions, fetchedLogs);
        if (stk > 0) {
          checkStreakAlert(user.id, fetchedActions, fetchedLogs, stk).catch(() => { /* never block the page */ });
        }
      }
    }
    // Not awaited: the goals are on screen and usable, and the roadmap is a
    // summary of them. It arrives a moment later, or not at all.
    loadRoadmap(loadedGoals);
  };

  /**
   * Read the athlete's record and turn it into a roadmap for every goal.
   *
   * The derived roadmap is written back to the goal rows so the parent view and
   * an offline session can both read it, and `persistRoadmapPatches` returns no
   * writes at all when nothing has moved — which is what makes this safe to run
   * after every load rather than only after an edit.
   */
  const loadRoadmap = async (goals: RoadmapGoalRow[]) => {
    if (!user) return;
    try {
      const context = await loadRoadmapContext({
        userId: user.id,
        sports: profile?.sport ? [profile.sport] : [],
        age: ageFromDob(profile?.date_of_birth ?? null),
      });
      setRoadmapContext(context);
      await persistRoadmapPatches(buildRoadmaps(goals, context), goals);
    } catch {
      /* a roadmap that cannot be read is a shorter roadmap, not an error */
    }
  };

  useEffect(() => { load(); }, [user]);

  const roadmaps = useMemo(() => buildRoadmaps(outcomes, roadmapContext), [outcomes, roadmapContext]);
  const roadmapById = useMemo(() => {
    const map = new Map<string, GoalRoadmap>();
    for (const r of roadmaps) map.set(r.goalId, r);
    return map;
  }, [roadmaps]);

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
    // toggleAction throws on failure — catch it here so a rejected promise
    // doesn't bypass the reload and leave the UI in a stale state.
    try {
      await toggleAction(action.id, user.id, done);
    } catch {
      toast.error("Failed to update — check your connection and try again.");
      return;
    }
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
      if (payload.error) {
        // A 200 can still carry an error string, and a provider key that has
        // not been set yet must not read as a fault in the review.
        if (isNotReadyMessage(payload.error)) { toast.error(AI_NOT_READY_MESSAGE); return; }
        if (payload.error.includes("Not enough credits")) {
          toast.error(payload.error);
          return;
        }
      }
      setAiFeedback(payload.feedback);
      if (payload.balance != null) toast.success(`Review complete${payload.cost ? ` — ${payload.cost} credits used` : ""}.`);
    } catch (e) {
      const msg = e?.message ?? "Failed";
      if (msg.includes("Not enough credits") || msg.includes("Insufficient") || e?.status === 402) {
        toast.error(msg.includes("credits") ? msg : "Not enough credits for Weekly Coach Review — need 3 credits.");
      } else {
        toast.error(isNotReadyMessage(msg) ? AI_NOT_READY_MESSAGE : msg);
      }
    } finally {
      setAiLoading(false);
    }
  };

  const goalCost = FEATURE_COSTS.weekly_coach_review;

  return (
    <div className="min-h-screen pb-32 px-5 pt-[var(--vaylo-screen-top)] max-w-3xl mx-auto space-y-5">
      {/* One simple entry point — natural language is the primary way to add a goal */}
      <div className="flex items-center gap-2 text-[12px] uppercase tracking-widest text-muted-foreground">
        <HelpCircle size={12} /> How goals work: <span className="text-foreground normal-case font-medium">Set a long-term target → add a weekly habit → tick daily actions.</span>
      </div>
      <NaturalLanguageGoalInput onCreated={load} />
      {/* Hero */}
      <Reveal>
        <Card className="p-5 bg-gradient-to-br from-primary/15 via-card to-card border-primary/30">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-[12px] uppercase tracking-[0.2em] text-muted-foreground">Accountability</p>
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
                  {/* `requiredRate` assumes a bigger-is-better metric, so a
                      target time prints an em dash. The roadmap knows both
                      directions, and two different answers on one card is a
                      contradiction the athlete can see. */}
                  <Mini
                    label="Required"
                    value={
                      roadmapById.get(g.id)?.progress.requiredRate && roadmapById.get(g.id)!.progress.requiredRate !== "—"
                        ? roadmapById.get(g.id)!.progress.requiredRate
                        : requiredRate(g)
                    }
                  />
                  <Mini label="Process goals" value={String(linkedProcs.length)} />
                </div>
                {roadmapById.get(g.id) && (
                  <GoalRoadmapPanel goal={g} roadmap={roadmapById.get(g.id)!} onSaved={load} />
                )}
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
                      aria-label={`Delete goal: ${g.title}`}
                      className="text-xs text-muted-foreground hover:text-destructive transition ml-1"
                      disabled={deleting}
                      onClick={async () => {
                        // The DB cascades this delete through process_goals,
                        // daily_actions and daily_action_logs, so the confirm
                        // must name the blast radius, not just the goal.
                        const confirmed = window.confirm(
                          `Delete the goal "${g.title}"? This also permanently deletes its weekly habits, daily actions and all logged history. This can't be undone.`
                        );
                        if (!confirmed || deleting) return;
                        setDeleting(true);
                        try {
                          const { error } = await supabase.from("outcome_goals").delete().eq("id", g.id);
                          if (error) { toast.error(error.message); return; }
                          load();
                        } finally {
                          setDeleting(false);
                        }
                      }}>
                      <Trash2 size={14} aria-hidden />
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
                // A <button> may not contain another <button> (invalid HTML;
                // screen readers skipped the delete control entirely). The row
                // is now a div: the toggle is a real checkbox-flavoured button
                // and the delete control is its sibling.
                return (
                  <div
                    key={a.id}
                    className={`w-full flex items-center gap-3 px-3 py-3 text-start transition ${
                      done ? "bg-success/5" : ""
                    }`}>
                    <button
                      role="checkbox"
                      aria-checked={done}
                      aria-label={`Mark "${a.title}" as ${done ? "not done" : "done"} today`}
                      onClick={() => handleToggle(a)}
                      className="flex flex-1 items-center gap-3 text-start min-w-0">
                      <span className={`w-7 h-7 rounded-md flex items-center justify-center border-2 transition shrink-0 ${
                        done ? "bg-success border-success text-success-foreground" : "border-destructive/60 text-destructive"
                      }`} aria-hidden>
                        {done ? <Check size={16} /> : <X size={14} />}
                      </span>
                      <span className={`text-sm font-medium min-w-0 ${done ? "line-through text-muted-foreground" : ""}`}>{a.title}</span>
                    </button>
                    <button
                      aria-label={`Stop tracking action: ${a.title}`}
                      disabled={deleting}
                      onClick={async () => {
                        if (deleting) return;
                        const confirmed = window.confirm(
                          `Stop tracking "${a.title}"? It disappears from today's checklist; your logged history stays in your stats. You can add a new action to the same habit later.`
                        );
                        if (!confirmed) return;
                        setDeleting(true);
                        try {
                          const { error } = await supabase.from("daily_actions").update({ active: false }).eq("id", a.id);
                          if (error) { toast.error(error.message); return; }
                          load();
                        } finally {
                          setDeleting(false);
                        }
                      }}
                      className="text-muted-foreground hover:text-destructive shrink-0">
                      <Trash2 size={14} aria-hidden />
                    </button>
                  </div>
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
              <span className="inline-flex items-center gap-1 text-[12px] font-bold text-energy bg-energy/10 border border-energy/20 rounded-full px-2 py-0.5"><Coins size={11} /> {goalCost} credits</span>
            </div>
            <Button size="sm" onClick={runAiReview} disabled={aiLoading}>
              {aiLoading ? "Analyzing…" : `Run Review · ${goalCost} cr`}
            </Button>
          </div>
          <p className="text-[12px] text-muted-foreground mb-2">Each review costs {goalCost} credits. Your goals, streak and today’s completion are analysed — PBs and recovery are included when available.</p>
          {aiFeedback ? (
            <div className="prose prose-sm prose-invert max-w-none text-sm">
              <ReactMarkdown>{aiFeedback}</ReactMarkdown>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Direct, honest feedback on your consistency and goals.</p>
          )}
        </Card>
      </Reveal>

      {/* An "Accountability Partners" card used to sit here.

          It promised that friends could see your goal progress, weekly
          consistency and missed actions, and offered a **Manage Friends**
          button that did `window.location.href = "/friends"`. Both halves were
          wrong at the same time:

            * /friends is now a redirect to the home screen — the friends
              surface was removed — so the button reloaded the app and landed
              the athlete back where they started. `window.location.href` also
              leaves the app entirely inside the Capacitor shell, the same
              full-page-navigation mistake the cookie notice documents.
            * Nothing in the app can send or accept a friend request any more.
              Four achievements ("Add your first friend", "Have 5 friends",
              "Popular", "Team Captain"), two challenges ("Social Butterfly",
              "Friend Network") and the friend-activity notification switch all
              described the removed feature too — see docs/RELEASE-AUDIT.md,
              section 3.

          The Friends screen came back on 2026-10-08 (docs/FRIENDS.md), along
          with the four friend achievements, the "Friend activity" switch and
          the notifications sentence. This card stays out: it promised that a
          partner could SEE your goal progress, and that is still not built —
          messaging is not goal sharing, and a card that advertises a feature
          which does not exist is worse than no card. */}

      {/* Dialogs */}
      <OutcomeDialog open={showOutcome} onClose={() => setShowOutcome(false)} userId={user?.id} onSaved={load} />
      <ProcessDialog open={!!showProcess} outcomeId={showProcess} onClose={() => setShowProcess(null)} userId={user?.id} onSaved={load} />
      <ActionDialog open={!!showAction} processId={showAction} onClose={() => setShowAction(null)} userId={user?.id} onSaved={load} />
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* The development roadmap, expanded inside the goal it belongs to            */
/* -------------------------------------------------------------------------- */
/* Deliberately not a separate screen. A roadmap is a way of reading one goal,
 * and putting it on its own page would mean the athlete has to hold the goal in
 * their head while reading about it. It lives here, collapsed by default, and
 * opens on the goal it describes.
 *
 * Everything it shows is derived (see `src/lib/roadmap.ts`). The only two
 * things the athlete can set here are their current level and the phase, and
 * both are the roadmap's inputs rather than its output. */

const PROGRESS_TONE: Record<string, string> = {
  ahead: "text-success border-success/40",
  on_track: "text-primary border-primary/40",
  behind: "text-energy border-energy/40",
  unknown: "text-muted-foreground border-border",
};

const INFLUENCE_TONE: Record<string, string> = {
  positive: "border-success/30 bg-success/5",
  info: "border-primary/25 bg-primary/5",
  watch: "border-energy/30 bg-energy/5",
};

const GoalRoadmapPanel = ({ goal, roadmap, onSaved }: {
  goal: RoadmapGoalRow;
  roadmap: GoalRoadmap;
  onSaved: () => void;
}) => {
  const [open, setOpen] = useState(false);
  const [level, setLevel] = useState(goal.current_level ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => { setLevel(goal.current_level ?? ""); }, [goal.current_level]);

  const save = async (patch: { current_level?: string | null; phase?: string | null }) => {
    if (saving) return;
    setSaving(true);
    try {
      const { error } = await supabase.from("outcome_goals").update(patch).eq("id", goal.id);
      if (error) { toast.error(error.message); return; }
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  const { progress } = roadmap;

  return (
    <div className="mt-3 rounded-lg border border-border/60 bg-muted/20">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 text-start"
      >
        <Compass size={14} className="text-primary shrink-0" aria-hidden />
        <span className="text-xs font-semibold">Development roadmap</span>
        <Badge variant="outline" className="text-[12px] py-0">{PHASE_LABELS[roadmap.phase]}</Badge>
        <Badge variant="outline" className={`text-[12px] py-0 ${PROGRESS_TONE[progress.status]}`}>
          {PROGRESS_LABELS[progress.status]}
        </Badge>
        <ChevronDown size={14} className={`ms-auto shrink-0 transition ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-3">
          <p className="text-[12px] text-muted-foreground">{PHASE_BLURBS[roadmap.phase]}</p>

          {/* Level → target: the two ends of the journey, in the athlete's words */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-md bg-background/60 p-2">
              <p className="text-[12px] uppercase tracking-wider text-muted-foreground">Where you are</p>
              <p className="font-medium">{roadmap.currentLevel}</p>
            </div>
            <div className="rounded-md bg-background/60 p-2">
              <p className="text-[12px] uppercase tracking-wider text-muted-foreground">Where you're going</p>
              <p className="font-medium">{roadmap.target}</p>
            </div>
          </div>

          {roadmap.isStale && (
            <div className="p-2 rounded-md bg-warning/10 border border-warning/30 text-[12px] text-warning flex items-center gap-2">
              <AlertTriangle size={12} aria-hidden /> This roadmap hasn't moved in {roadmap.staleDays} days. It updates as you log sessions and competitions.
            </div>
          )}

          <div>
            <p className="text-xs text-muted-foreground mb-1">{progress.summary}</p>
            <Progress value={progress.percent} className="h-2" />
            {progress.daysRemaining != null && (
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                <Mini label="Days left" value={String(Math.max(0, progress.daysRemaining))} />
                <Mini label="Needed per week" value={progress.requiredRate} />
              </div>
            )}
          </div>

          {roadmap.developmentAreas.length > 0 && (
            <div>
              <p className="text-[12px] uppercase tracking-wider text-muted-foreground mb-1">Development areas</p>
              <div className="flex flex-wrap gap-1">
                {roadmap.developmentAreas.map(area => (
                  <Badge key={area} variant="secondary" className="text-[12px] font-normal">{area}</Badge>
                ))}
              </div>
            </div>
          )}

          <div>
            <p className="text-[12px] uppercase tracking-wider text-muted-foreground mb-1">Milestones</p>
            <ol className="space-y-1">
              {roadmap.milestones.map(m => (
                <li key={m.id} className="flex items-start gap-2 text-xs">
                  {m.status === "achieved"
                    ? <CheckCircle2 size={13} className="text-success shrink-0 mt-0.5" aria-hidden />
                    : m.status === "missed"
                      ? <MinusCircle size={13} className="text-muted-foreground shrink-0 mt-0.5" aria-hidden />
                      : <Circle size={13} className="text-muted-foreground shrink-0 mt-0.5" aria-hidden />}
                  <span className={m.status === "achieved" ? "text-muted-foreground line-through" : ""}>
                    {m.title}
                    {m.targetDate && <span className="text-muted-foreground"> · {m.targetDate}</span>}
                    {m.status === "missed" && <span className="text-muted-foreground"> · not this time</span>}
                  </span>
                </li>
              ))}
            </ol>
          </div>

          {roadmap.influences.length > 0 && (
            <div>
              <p className="text-[12px] uppercase tracking-wider text-muted-foreground mb-1">What's shaping this</p>
              <div className="space-y-1">
                {roadmap.influences.map((influence, i) => (
                  <div key={`${influence.kind}-${i}`} className={`rounded-md border p-2 ${INFLUENCE_TONE[influence.tone]}`}>
                    <p className="text-xs font-semibold">{influence.label}</p>
                    <p className="text-[12px] text-muted-foreground">{influence.detail}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {roadmap.priorities.length > 0 && (
            <div>
              <p className="text-[12px] uppercase tracking-wider text-muted-foreground mb-1">Current priorities</p>
              <ul className="space-y-1">
                {roadmap.priorities.map(p => (
                  <li key={p} className="text-xs flex gap-2"><Flag size={12} className="text-primary shrink-0 mt-0.5" aria-hidden />{p}</li>
                ))}
              </ul>
            </div>
          )}

          {roadmap.nextActions.length > 0 && (
            <div>
              <p className="text-[12px] uppercase tracking-wider text-muted-foreground mb-1">Next actions</p>
              <ul className="space-y-1">
                {roadmap.nextActions.map(a => (
                  <li key={a} className="text-xs text-muted-foreground flex gap-2"><Check size={12} className="text-success shrink-0 mt-0.5" aria-hidden />{a}</li>
                ))}
              </ul>
            </div>
          )}

          {/* The two inputs the athlete owns. Everything else is derived. */}
          <div className="grid grid-cols-2 gap-2">
            <Input
              aria-label="Your current level toward this goal"
              placeholder="Current level (e.g. 4:32 1500m PB)"
              value={level}
              maxLength={200}
              onChange={e => setLevel(e.target.value)}
              onBlur={() => {
                const next = level.trim();
                if (next === (goal.current_level ?? "")) return;
                save({ current_level: next || null });
              }}
            />
            <select
              aria-label="Development phase"
              value={roadmap.phase}
              disabled={saving}
              onChange={e => save({ phase: e.target.value as DevelopmentPhase })}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              {(Object.keys(PHASE_LABELS) as DevelopmentPhase[]).map(p => (
                <option key={p} value={p}>{PHASE_LABELS[p]}</option>
              ))}
            </select>
          </div>
          <p className="text-[12px] text-muted-foreground">
            The roadmap updates itself from your sessions, competitions, recovery and breaks. Setting a level or a phase tells it where you think you are.
          </p>
        </div>
      )}
    </div>
  );
};

const Stat = ({ label, value, suffix, className, icon }: { label: string; value: number; suffix?: string; className?: string; icon?: React.ReactNode }) => (
  <div className="text-center">
    <p className="text-[12px] uppercase tracking-[0.18em] text-muted-foreground mb-1 flex items-center justify-center gap-1">{icon}{label}</p>
    <p className={`text-2xl font-display font-bold ${className ?? ""}`}>
      <AnimatedNumber value={value} />{suffix}
    </p>
  </div>
);

const Mini = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-md bg-muted/30 p-2">
    <p className="text-[12px] uppercase tracking-wider text-muted-foreground">{label}</p>
    <p className="text-xs font-medium truncate">{value}</p>
  </div>
);

const EmptyHint = ({ text }: { text: string }) => (
  <div className="p-6 text-center text-sm text-muted-foreground">{text}</div>
);

const OutcomeDialog = ({ open, onClose, userId, onSaved }: { open: boolean; onClose: () => void; userId?: string; onSaved: () => void }) => {
  const [f, setF] = useState({ title: "", category: "performance", target_value: "", metric_unit: "", deadline: "", current_value: "0" });
  const submit = async () => {
    if (!f.title || !userId) return;
    // Numeric goals are clamped to finite, non-negative values; an inverted
    // target (target < current) is refused rather than producing a negative
    // progress bar.
    const num = (v: string) => {
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 ? n : null;
    };
    const target = f.target_value ? num(f.target_value) : null;
    const current = num(f.current_value) ?? 0;
    if (target != null && current > target) {
      toast.error("Target must be greater than or equal to the current value.");
      return;
    }
    const { error } = await supabase.from("outcome_goals").insert({
      user_id: userId, title: f.title.slice(0, 120), category: f.category,
      target_value: target,
      current_value: current,
      metric_unit: f.metric_unit.slice(0, 20) || null,
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

const ProcessDialog = ({ open, outcomeId, onClose, userId, onSaved }: { open: boolean; outcomeId: string | null; onClose: () => void; userId?: string; onSaved: () => void }) => {
  const [title, setTitle] = useState("");
  const [target, setTarget] = useState("3");
  const submit = async () => {
    if (!title || !userId) return;
    // Weekly target is 1–14 (the progress math divides by it; 0 would divide
    // by zero and 500 would make the percentage meaningless).
    const parsed = parseInt(target, 10);
    const weeklyTarget = Number.isFinite(parsed) ? Math.max(1, Math.min(14, parsed)) : 3;
    const { error } = await supabase.from("process_goals").insert({
      user_id: userId, outcome_goal_id: outcomeId, title: title.slice(0, 120), weekly_target: weeklyTarget,
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

const ActionDialog = ({ open, processId, onClose, userId, onSaved }: { open: boolean; processId: string | null; onClose: () => void; userId?: string; onSaved: () => void }) => {
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
