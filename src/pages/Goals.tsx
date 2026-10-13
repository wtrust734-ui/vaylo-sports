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
import GoalSetupWizard from "@/components/goals/GoalSetupWizard";
import {
  dailyActionRows,
  emptyDraft,
  planWrites,
  processGoalRow,
  reviewDraft,
  type GoalDraft,
  type GoalIntent,
} from "@/lib/goalSetup";
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
  // The setup quiz. Held here rather than inside the wizard so the answers
  // survive the screen re-rendering under it (load() runs after every tick).
  const [goalDraft, setGoalDraft] = useState<GoalDraft | null>(null);
  const [creatingGoal, setCreatingGoal] = useState(false);
  // The free-text path, kept behind a click: the quiz is the front door, but
  // "just describe it" still has to be possible.
  const [showDescribe, setShowDescribe] = useState(false);
  const [showProcess, setShowProcess] = useState<string | null>(null);
  const [showAction, setShowAction] = useState<string | null>(null);
  const [aiFeedback, setAiFeedback] = useState<string>("");
  const [aiLoading, setAiLoading] = useState(false);
  // Gates every destructive mutation on this page. Without it a double-tap on
  // the (already-confirmed) delete fired two DELETEs and the second reloaded
  // against rows that no longer existed.
  const [deleting, setDeleting] = useState(false);
  // The page used to render everything it owns at once — a metrics hero, three
  // numbered sections, a roadmap open inside every goal and the paid review —
  // which is what made it read as a wall rather than a plan. Each block below
  // is folded until it is asked for, and the composer opens by itself for an
  // athlete who has nothing yet.
  const [expandedGoal, setExpandedGoal] = useState<string | null>(null);
  const [expandedProcess, setExpandedProcess] = useState<string | null>(null);
  const [showStats, setShowStats] = useState(false);
  const [showReview, setShowReview] = useState(false);

  // A first-time athlete has nothing to read, so the composer *is* the page for
  // them: opening it unprompted is the difference between "add your first goal"
  // and an empty screen with a button on it.
  useEffect(() => {
    if (!loading && outcomes.length === 0 && processes.length === 0) {
      setGoalDraft((current) => current ?? emptyDraft("both"));
    }
  }, [loading, outcomes.length, processes.length]);

  const openWizard = (intent: GoalIntent) => {
    setShowDescribe(false);
    setGoalDraft(emptyDraft(intent));
  };

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

  /**
   * Write what the quiz decided.
   *
   * Three tables in one order, because the id of the first is what the second
   * hangs off: a "both" goal creates the target, then the weekly habits under
   * it, then each habit's daily actions. A habit-only goal writes
   * `outcome_goal_id: null` — the column has always been nullable, and that is
   * precisely the case the UI had no door for: a weekly habit used to be
   * addable only from inside a target's card.
   *
   * Each step reports its own failure and stops there rather than rolling on:
   * half a goal (a target with none of the habits that close its gap, say) is
   * worse than a clear error, because the athlete can see exactly what did and
   * did not get saved.
   *
   * Nothing here costs credits. Goals are the athlete's own record; the paid
   * Weekly Coach Review is a separate button further down this screen.
   */
  const createGoal = async (draft: GoalDraft) => {
    if (!user || creatingGoal) return;
    // The same review the quiz's last step showed. The screen does not trust a
    // "Create" tap to mean the answers were valid.
    if (!reviewDraft(draft).ok) return;
    setCreatingGoal(true);
    try {
      const plan = planWrites(user.id, draft);
      let outcomeGoalId: string | null = null;

      if (plan.goal) {
        const { data, error } = await supabase
          .from("outcome_goals")
          .insert(plan.goal)
          .select("id")
          .single();
        if (error || !data) { toast.error(error?.message ?? "Couldn't save the target."); return; }
        outcomeGoalId = data.id;
      }

      for (const { habit, actions } of plan.habits) {
        const { data, error } = await supabase
          .from("process_goals")
          .insert(processGoalRow(user.id, habit, outcomeGoalId))
          .select("id")
          .single();
        if (error || !data) { toast.error(error?.message ?? "Couldn't save the habit."); return; }

        const rows = dailyActionRows(user.id, actions).map((row) => ({
          ...row,
          process_goal_id: data.id,
        }));
        if (rows.length) {
          const { error: actionError } = await supabase.from("daily_actions").insert(rows);
          if (actionError) toast.error(actionError.message);
        }
      }

      const habitCount = plan.habits.length;
      toast.success(
        plan.goal && habitCount
          ? "Target set, with its habits underneath."
          : plan.goal
            ? "Target set."
            : "Habit set — it does not need a target above it.",
      );
      setGoalDraft(null);
      await load();
    } finally {
      setCreatingGoal(false);
    }
  };

  const goalCost = FEATURE_COSTS.weekly_coach_review;
  const activeGoalCount = outcomes.filter(g => g.status !== "completed").length;
  // One line of state instead of a hero card: what is left to do today, and how
  // the goals are going.
  const summaryLine = actions.length
    ? `${todayDone} of ${actions.length} done today · ${streak}-day streak`
    : outcomes.length
      ? `${activeGoalCount} goal${activeGoalCount === 1 ? "" : "s"} in progress · no daily actions yet`
      : "No goals yet — add one and the week builds itself around it.";

  return (
    <div className="min-h-screen pb-32 px-5 pt-[var(--vaylo-screen-top)] max-w-3xl mx-auto space-y-5">
      {/* The header carries the page's single primary action. Nothing the page
          could do before is gone; it is just not all on screen at once. */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-display font-bold text-gradient-electric">Goals</h1>
          <p className="text-sm text-muted-foreground mt-1">{summaryLine}</p>
        </div>
        {/* Two ways in, both explicit. The quiz is the primary one because it
            answers the questions the old form asked the athlete to supply
            (where are you now, where do you want to be, by when); the
            sentence box stays for when a sentence is simply easier. */}
        <div className="flex shrink-0 items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            aria-expanded={showDescribe}
            onClick={() => { setGoalDraft(null); setShowDescribe(v => !v); }}
          >
            <Sparkles size={14} className="mr-1" /> Describe it
          </Button>
          <Button
            size="sm"
            aria-expanded={!!goalDraft}
            onClick={() => { setShowDescribe(false); setGoalDraft(goalDraft ? null : emptyDraft("both")); }}
          >
            <Plus size={14} className="mr-1" /> New goal
          </Button>
        </div>
      </div>

      {/* The guided setup. It asks what the athlete wants and works out the
          shape — a target, a weekly habit, or both — where the form it
          replaces asked for five numbers they were supposed to already know. */}
      {goalDraft && (
        <Reveal>
          <GoalSetupWizard
            draft={goalDraft}
            onDraftChange={setGoalDraft}
            busy={creatingGoal}
            onCreate={createGoal}
            onClose={() => setGoalDraft(null)}
          />
        </Reveal>
      )}

      {/* "Just describe it": the same goal, read out of a sentence. Kept
          reachable rather than removed — it is the fastest path for an athlete
          who already knows exactly what they want, and the parser is offline
          and deterministic. */}
      {showDescribe && !goalDraft && (
        <Reveal>
          <Card className="p-4 space-y-3">
            <p className="flex items-center gap-2 text-[12px] text-muted-foreground">
              <HelpCircle size={12} aria-hidden />
              Write it as you would say it — the numbers are read out of the sentence.
            </p>
            <NaturalLanguageGoalInput onCreated={load} />
            <button
              type="button"
              onClick={() => { setShowDescribe(false); setGoalDraft(emptyDraft("both")); }}
              className="text-xs font-semibold text-primary hover:underline"
            >
              Or set it up step by step
            </button>
          </Card>
        </Reveal>
      )}
      {/* Today first: ticking today's actions is what this page is opened to do,
          and it is the one next action the athlete has. */}
      <Reveal delay={0.05}>
        <section className="space-y-3">
          <SectionHeading title="Today" hint={actions.length ? `${todayDone} of ${actions.length} done` : undefined} />
          {streakAtRisk && (
            <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/15 p-3 text-sm font-medium text-destructive">
              <AlertTriangle size={16} aria-hidden /> You are about to lose your {streak}-day streak. Close it out today.
            </div>
          )}
          <Card className="p-2">
            {actions.length === 0 ? (
              <EmptyHint text="No daily actions yet — open a habit below and add one." />
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
        </section>
      </Reveal>

      {/* Your goals. A card shows how far along it is and folds the rest —
          description, roadmap, milestone inputs, status and delete — away until
          it is opened, so a long list stays readable at a glance. */}
      <Reveal delay={0.05}>
        <section className="space-y-3">
          <SectionHeading title="Your goals" hint={outcomes.length ? `${activeGoalCount} in progress` : undefined} />
          {outcomes.length === 0 && <EmptyHint text="Set your first long-term target — the New goal button above." />}
          {outcomes.map(g => {
            const pct = outcomeProgress(g);
            const linkedProcs = processes.filter(p => p.outcome_goal_id === g.id);
            const open = expandedGoal === g.id;
            const roadmap = roadmapById.get(g.id);
            return (
              <Card key={g.id} className="p-4">
                <button
                  type="button"
                  aria-expanded={open}
                  aria-label={`${open ? "Hide" : "Show"} details for ${g.title}`}
                  onClick={() => setExpandedGoal(open ? null : g.id)}
                  className="w-full text-start"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold truncate">{g.title}</h3>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {Number(g.current_value ?? 0)} / {Number(g.target_value ?? 0)} {g.metric_unit}
                        {g.deadline ? ` · by ${g.deadline}` : ""}
                      </p>
                    </div>
                    <Badge variant="outline" className="text-xs shrink-0">{g.category}</Badge>
                    <ChevronDown size={16} className={`shrink-0 text-muted-foreground transition ${open ? "rotate-180" : ""}`} aria-hidden />
                  </div>
                  <div className="mt-3 flex items-center gap-3">
                    <Progress value={pct} className="h-2 flex-1" />
                    <span className="text-xs font-semibold shrink-0">{pct}%</span>
                  </div>
                </button>

                {open && (
                  <div className="mt-3 space-y-3">
                    {g.description && <p className="text-xs text-muted-foreground">{g.description}</p>}
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <Mini label="Deadline" value={g.deadline ?? "—"} />
                      {/* `requiredRate` assumes a bigger-is-better metric, so a
                          target time prints an em dash. The roadmap knows both
                          directions, and two different answers on one card is a
                          contradiction the athlete can see. */}
                      <Mini
                        label="Required"
                        value={
                          roadmap?.progress.requiredRate && roadmap.progress.requiredRate !== "—"
                            ? roadmap.progress.requiredRate
                            : requiredRate(g)
                        }
                      />
                      <Mini label="Habits" value={String(linkedProcs.length)} />
                    </div>
                    {roadmap && (
                      <GoalRoadmapPanel goal={g} roadmap={roadmap} onSaved={load} />
                    )}
                    <div className="flex flex-wrap justify-between items-center gap-2">
                      <Button size="sm" variant="outline" onClick={() => setShowProcess(g.id)}>
                        <Plus size={12} className="mr-1" /> Weekly habit
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
                  </div>
                )}
              </Card>
            );
          })}
        </section>
      </Reveal>

      {/* This week's habits, folded to the one number that matters — how much of
          the week's target is done — with the actions it is made of inside. */}
      <Reveal delay={0.1}>
        <section className="space-y-3">
          <SectionHeading title="This week's habits" />
          {processes.length === 0 && (
            <Card className="space-y-2 p-4 text-center">
              <p className="text-sm text-muted-foreground">
                No weekly habits yet. A habit is worth setting up on its own — it does not need a
                target above it.
              </p>
              <Button size="sm" variant="outline" onClick={() => openWizard("habit")}>
                <Plus size={12} className="mr-1" /> Set a weekly habit
              </Button>
            </Card>
          )}
          {processes.map(pg => {
            const w = weeklyCompletionForProcess(pg, actions, logs);
            const linkedActions = actions.filter(a => a.process_goal_id === pg.id);
            const open = expandedProcess === pg.id;
            return (
              <Card key={pg.id} className="p-4">
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setExpandedProcess(open ? null : pg.id)}
                  className="w-full text-start"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold truncate">{pg.title}</h3>
                      <p className="text-xs text-muted-foreground">{w.done}/{w.target} this week</p>
                    </div>
                    <span className={`text-lg font-bold shrink-0 ${w.pct === 100 ? "text-success" : w.pct < 50 ? "text-destructive" : "text-foreground"}`}>{w.pct}%</span>
                    <ChevronDown size={16} className={`shrink-0 text-muted-foreground transition ${open ? "rotate-180" : ""}`} aria-hidden />
                  </div>
                  <Progress value={w.pct} className="h-1.5 mt-2" />
                </button>
                {open && (
                  <div className="mt-3 space-y-2">
                    {linkedActions.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No daily actions yet.</p>
                    ) : (
                      <ul className="space-y-1">
                        {linkedActions.map(a => (
                          <li key={a.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Circle size={8} className="shrink-0" aria-hidden />
                            {a.title}
                          </li>
                        ))}
                      </ul>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => setShowAction(pg.id)}>
                      <Plus size={12} className="mr-1" /> Daily action
                    </Button>
                  </div>
                )}
              </Card>
            );
          })}
        </section>
      </Reveal>

      {/* Consistency used to be a hero card at the top. It is three numbers the
          athlete checks occasionally, not the point of the screen, so it folds
          away with the arithmetic that explains it. */}
      <Reveal delay={0.2}>
        <section className="space-y-2">
          <button
            type="button"
            aria-expanded={showStats}
            onClick={() => setShowStats(v => !v)}
            className="w-full flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-start"
          >
            <Target size={16} className="shrink-0 text-primary" aria-hidden />
            <span className="text-sm font-semibold">Consistency</span>
            <span className="ms-auto truncate text-xs text-muted-foreground">{reliability}% reliable · {streak}-day streak</span>
            <ChevronDown size={16} className={`shrink-0 text-muted-foreground transition ${showStats ? "rotate-180" : ""}`} aria-hidden />
          </button>
          {showStats && (
            <Card className="p-4 space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <Stat label="Reliability" value={reliability} suffix="%" className={reliabilityColor} />
                <Stat label="Streak" value={streak} suffix="d" icon={<Flame size={14} className="text-energy" />} />
                <Stat label="Today" value={todayPct} suffix="%" className={todayPct === 100 ? "text-success" : todayPct === 0 ? "text-destructive" : "text-warning"} />
              </div>
              {reliability < 60 && actions.length > 0 && (
                <div className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm font-medium text-warning">
                  <TrendingUp size={16} aria-hidden /> Consistency below target. This will cost you results.
                </div>
              )}
              <p className="text-[12px] text-muted-foreground">
                Reliability is the share of your daily actions completed over the last 30 days. The streak counts consecutive days with every action ticked.
              </p>
            </Card>
          )}
        </section>
      </Reveal>

      {/* The review is a paid call and a wall of prose, so it is the last thing
          on the page and it stays closed until it is asked for. The run button
          now has its own line — the row it used to share clipped on a 320px
          screen (see ui-audit on /goals). */}
      <Reveal delay={0.25}>
        <Card className="p-4 border-primary/30 bg-gradient-to-br from-primary/10 to-card">
          <button
            type="button"
            aria-expanded={showReview}
            onClick={() => setShowReview(v => !v)}
            className="w-full flex flex-wrap items-center gap-x-2 gap-y-1.5 text-start"
          >
            <Sparkles size={18} className="shrink-0 text-primary" aria-hidden />
            <h3 className="font-semibold">Weekly Coach Review</h3>
            <span className="inline-flex shrink-0 items-center gap-1 text-[12px] font-bold text-energy bg-energy/10 border border-energy/20 rounded-full px-2 py-0.5"><Coins size={11} aria-hidden /> {goalCost} credits</span>
            <ChevronDown size={16} className={`ms-auto shrink-0 text-muted-foreground transition ${showReview ? "rotate-180" : ""}`} aria-hidden />
          </button>
          {showReview && (
            <div className="mt-3 space-y-2">
              <p className="text-[12px] text-muted-foreground">Each review costs {goalCost} credits. Your goals, streak and today's completion are analysed — PBs and recovery are included when available.</p>
              <Button size="sm" onClick={runAiReview} disabled={aiLoading}>
                {aiLoading ? "Analyzing…" : `Run Review · ${goalCost} cr`}
              </Button>
              {aiFeedback ? (
                <div className="prose prose-sm prose-invert max-w-none text-sm">
                  <ReactMarkdown>{aiFeedback}</ReactMarkdown>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Direct, honest feedback on your consistency and goals.</p>
              )}
            </div>
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

/* Section headings. The page used to number its blocks ("1 · Outcome", "2 ·
 * Weekly habits", "3 · Today"), which made three ordinary things to look at
 * read like a form to fill in. The order is visible on screen; it does not need
 * a legend. */
const SectionHeading = ({ title, hint }: { title: string; hint?: string }) => (
  <div className="flex items-baseline justify-between gap-2">
    <h2 className="text-sm uppercase tracking-[0.2em] font-semibold text-muted-foreground">{title}</h2>
    {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
  </div>
);

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
