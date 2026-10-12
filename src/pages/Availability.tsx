import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight, Bandage, CalendarClock, CalendarRange, CircleEllipsis, GraduationCap, HeartHandshake,
  Info, Lock, Luggage, Plane, Plus, ShieldCheck, Thermometer, Trash2, Trophy, Users, X,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useLifeEvents, type LifeEventInput } from "@/hooks/useLifeEvents";
import { useToast } from "@/hooks/use-toast";
import { ageBand } from "@/lib/age";
import {
  activeAdjustments,
  classifyBreak,
  rebuildRefusalNote,
  returnProgression,
  type PlanAdjustmentRecord,
} from "@/lib/adaptivePlan";
import { ageFromDateOfBirth } from "@/lib/adaptivePlanning";
import { localDateKey } from "@/lib/dates";
import { flattenPlan, type DatedSession, type TrainingPlanLike } from "@/lib/planSchedule";
import {
  ACTIVITY_LEVELS, ALLOW_TRAINING_OPTIONS, LIFE_EVENT_TYPES, YOUTH_BREAK_NOTE,
  asPlannedSession, assessAvailability, availabilityKind, eventOnDate, formatPeriod,
  lifeEventType, sortEvents, spanDays, type ActivityLevel, type AllowTraining, type LifeEvent, type LifeEventType,
} from "@/lib/lifeEvents";

/**
 * AVAILABILITY — the athlete's life, on the calendar
 *
 * Three jobs, in this order of importance:
 *
 *   1. Let an athlete say "I'm away" in a few taps, with no explanation. The
 *      form never requires a note and never asks why.
 *   2. Show the consequence honestly: which sessions this affects, and that
 *      they are not counted against the athlete. Nothing is moved.
 *   3. Show the periods on a calendar band, so unavailability is visible at a
 *      glance rather than buried in a list.
 *
 * What this screen does with a break long enough to matter: it saves it, marks
 * the sessions it cancels, and hands the plan to the adaptive rebuild — which
 * re-cuts the weeks *after* the break rather than stacking the missed work into
 * them. That rebuild is a pure function of the stored plan, so it is the same
 * on every device, it works with no signal, and what it did is stated here in
 * one sentence and detailed, with an undo, on the Training screen.
 *
 * What this screen still refuses to do: move anything. Not one session changes
 * its day because of a break. That is the behaviour the whole feature exists to
 * avoid, and it is asserted in `src/lib/adaptivePlan.test.ts`.
 */

const ICONS: Record<string, typeof Plane> = {
  Plane, Luggage, GraduationCap, Trophy, Thermometer, Bandage,
  HeartHandshake, CalendarClock, Users, CircleEllipsis, Lock,
};

/** How many weeks the band shows. Eight is two months — enough to see a break coming. */
const BAND_WEEKS = 8;

/** "Monday" of the week containing `date`. */
const mondayOf = (date: Date): Date => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
};

const addDays = (date: Date, days: number): Date => {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
};

/** Tailwind classes per availability kind. One map, so the band and the chips agree. */
const KIND_STYLE = {
  paused: "bg-destructive/25 border-destructive/40 text-destructive-foreground",
  optional: "bg-energy/20 border-energy/40",
  training: "bg-primary/15 border-primary/35",
} as const;

/**
 * The form's opening state: the catalogue's own defaults for a holiday, so the
 * screen can never drift from the type it has selected. A holiday opens on "no
 * training" on purpose — saving that cancels the sessions it covers and hands
 * the plan to the adaptive rebuild (harder the week before, nothing programmed
 * during it, a graded return after), which is what an athlete means by marking
 * a holiday.
 */
const HOLIDAY_DEFAULTS = lifeEventType("holiday");

const Availability = () => {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const { events, loading, error, saving, create, update, remove, applyToPlan } = useLifeEvents();

  const [plan, setPlan] = useState<TrainingPlanLike | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const isMinor = ageBand(profile?.date_of_birth) === "minor";

  const today = new Date();
  const [form, setForm] = useState<LifeEventInput>(() => ({
    start_date: localDateKey(today),
    end_date: localDateKey(addDays(today, 6)),
    event_type: "holiday",
    activity_level: HOLIDAY_DEFAULTS.defaultActivity,
    allow_training: HOLIDAY_DEFAULTS.defaultAllowTraining,
    note: "",
  }));

  // The dated schedule, so "what changed?" is computed from the athlete's real
  // plan rather than asserted. Empty when there is no plan yet, in which case
  // the panel says so instead of inventing a number.
  //
  // A function rather than an inline effect because saving a break can rebuild
  // the plan, and the per-break summary below has to read the rebuild it just
  // caused rather than the one from before it.
  const loadPlan = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("training_plans")
      .select("id, created_at, week_current, duration_weeks, plan_data, plan_adjustments")
      .eq("user_id", user.id)
      .eq("active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setPlan((data as TrainingPlanLike | null) ?? null);
  }, [user]);

  useEffect(() => {
    void loadPlan();
  }, [loadPlan]);

  /** Rebuilds on this plan, by the break that caused them. */
  const rebuildByEvent = useMemo(() => {
    const map = new Map<string, PlanAdjustmentRecord>();
    for (const record of activeAdjustments(plan?.plan_adjustments)) map.set(record.lifeEventId, record);
    return map;
  }, [plan?.plan_adjustments]);

  const sessions: DatedSession[] = useMemo(
    () => (plan ? flattenPlan(plan) : []),
    [plan],
  );

  /** Per event: what it did to the plan, and the sentence explaining it. */
  const impact = useMemo(() => {
    const map = new Map<string, { cancelled: number; key: number; explanation: string | null }>();
    for (const event of events) {
      const result = assessAvailability(sessions.map((s) => asPlannedSession(s)), event);
      map.set(event.id, {
        cancelled: result.cancelled.length,
        key: result.lostKeySessions.length,
        explanation: result.explanation,
      });
    }
    return map;
  }, [events, sessions]);

  const band = useMemo(() => {
    const firstMonday = mondayOf(today);
    return Array.from({ length: BAND_WEEKS }, (_, w) =>
      Array.from({ length: 7 }, (_, d) => addDays(firstMonday, w * 7 + d)),
    );
    // Recompute only when the day itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localDateKey(today)]);

  const chooseType = (type: LifeEventType) => {
    const def = LIFE_EVENT_TYPES.find((t) => t.id === type)!;
    setForm((prev) => ({
      ...prev,
      event_type: type,
      // Defaults are a starting point the athlete can always change; they are
      // never applied silently at save time.
      allow_training: def.defaultAllowTraining,
      activity_level: def.defaultActivity,
    }));
  };

  const resetForm = () => {
    setEditingId(null);
    setShowForm(false);
    setForm({
      start_date: localDateKey(new Date()),
      end_date: localDateKey(addDays(new Date(), 6)),
      event_type: "holiday",
      activity_level: HOLIDAY_DEFAULTS.defaultActivity,
      allow_training: HOLIDAY_DEFAULTS.defaultAllowTraining,
      note: "",
    });
  };

  const beginEdit = (event: LifeEvent) => {
    setEditingId(event.id);
    setShowForm(true);
    setForm({
      start_date: event.start_date,
      end_date: event.end_date,
      event_type: event.event_type,
      activity_level: event.activity_level,
      allow_training: event.allow_training,
      note: event.note ?? "",
    });
  };

  const invalidRange = form.end_date < form.start_date;

  /**
   * What the rebuild will do, shown before the athlete commits to it.
   *
   * Computed from the form's own dates with the same two pure functions the
   * save uses, so the preview cannot disagree with the outcome. Only shown for
   * breaks the app will actually rebuild around — "no training" and longer than
   * three days — because previewing a change that will not happen is noise.
   */
  const rebuildPreview = useMemo(() => {
    if (form.allow_training !== "no" || invalidRange) return null;
    const category = classifyBreak(spanDays(form.start_date, form.end_date));
    if (category === "none") return null;
    // The same two modifiers the save will apply, so the preview cannot promise
    // a fuller week than the athlete gets: poor recovery is the one input it
    // cannot know from here, and it only ever makes the week lighter.
    const steps = returnProgression(category, {
      age: ageFromDateOfBirth(profile?.date_of_birth),
      medical: form.event_type === "illness" || form.event_type === "injury",
    });
    if (!steps.length) return null;
    return {
      weeks: steps.length,
      volumes: steps.map((s) => `${s.volumePct}%`).join(" → "),
    };
  }, [form.allow_training, form.event_type, form.start_date, form.end_date, invalidRange, profile?.date_of_birth]);

  const save = async () => {
    if (invalidRange) {
      toast({ title: "Check the dates", description: "The end date can't be before the start date.", variant: "destructive" });
      return;
    }
    const outcome = editingId ? await update(editingId, form) : await create(form);
    // `=== false` rather than `!outcome.ok` deliberately. This project compiles
    // with `strict: false`, and with `strictNullChecks` off TypeScript does not
    // discriminate a union on the truthiness of a boolean-literal field — it
    // does discriminate on an explicit comparison. Written the shorter way the
    // narrowing silently stops working and `outcome.error` fails to typecheck.
    if (outcome.ok === false) {
      toast({ title: "Couldn't save that", description: outcome.error, variant: "destructive" });
      return;
    }

    // The break is saved. Recording what it does to the calendar is a second
    // step, and it is allowed to be a quiet one: the athlete's break exists
    // either way.
    const applied = await applyToPlan(outcome.event);
    if (applied.rebuild) await loadPlan();

    // A rebuild outranks the session count when both happened. "We rebuilt your
    // next week" is the bigger news than "six sessions are marked", and the
    // per-break panel below still carries the second one.
    const rebuilt = applied.rebuild?.applied ? applied.rebuild.explanation : null;

    // A rebuild the engine declined is an answer too, and a different one from
    // "your break changed nothing": it says whether the break was too short to
    // need a rebuild or whether the plan had nothing left inside it to rebuild.
    // Reported alongside the session count, never instead of it.
    const declined =
      applied.rebuild && !applied.rebuild.applied && !applied.rebuild.error && applied.rebuild.reason
        ? rebuildRefusalNote(applied.rebuild.reason)
        : null;
    const summary = rebuilt ?? [applied.explanation, declined].filter((part): part is string => !!part).join(" ");

    toast({
      title: editingId ? "Break updated" : "Break added",
      // The explanation is the "what changed?" answer, so it is the description
      // rather than a second toast. It names the period and says plainly that
      // nothing was moved and nothing counts against the athlete.
      description: outcome.queued
        ? "Saved on your device — it will sync when you're back online."
        : summary || "Nothing needed changing on your plan.",
      duration: 8000,
    });

    // Said separately and plainly: the break is saved, the plan rebuild is not,
    // and the athlete should not have to guess whether their plan moved.
    if (applied.rebuild && !applied.rebuild.applied && applied.rebuild.error) {
      toast({
        title: "Your plan wasn't rebuilt",
        description: `${applied.rebuild.error} Your break was still saved.`,
        variant: "destructive",
      });
    }
    resetForm();
  };

  const removeEvent = async (event: LifeEvent) => {
    const { ok, error: removeError } = await remove(event.id);
    if (!ok) {
      toast({ title: "Couldn't remove that", description: removeError, variant: "destructive" });
      return;
    }
    // Said plainly, because the alternative (silently rewriting the sessions it
    // cancelled) would be the app editing training history on the athlete's
    // behalf.
    toast({
      title: "Break removed",
      description:
        "Sessions it had marked unavailable keep that record — nothing in your history changed. If it rebuilt your plan, that stays too, and you can undo it from your Training screen.",
      duration: 8000,
    });
  };

  const definition = LIFE_EVENT_TYPES.find((t) => t.id === form.event_type)!;

  return (
    <div className="min-h-screen app-mesh bg-background pb-32">
      <div className="px-5 pt-[var(--vaylo-screen-top)] pb-4">
        <p className="text-[12px] uppercase tracking-widest text-primary font-semibold flex items-center gap-1.5">
          <CalendarRange size={12} /> Availability
        </p>
        <h1 className="text-2xl font-display font-bold mt-1">Your life &amp; training</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Holidays, exams, illness or a break — record them so your plan reflects your life instead of fighting it.
        </p>
        {/* Phase 7: this screen used to be a dead end, which is how six phases
            start feeling like six features. Saving a break here changes the plan
            and the analytics, so both are one tap away from the screen that
            caused the change. */}
        <div className="mt-3 flex flex-wrap gap-2">
          <Link
            to="/training"
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-semibold"
          >
            See it in your plan
            <ArrowRight size={14} aria-hidden />
          </Link>
          <Link
            to="/insights"
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-semibold"
          >
            Your insights
            <ArrowRight size={14} aria-hidden />
          </Link>
        </div>
      </div>

      {/* Continuous education, not a one-off banner: the athlete meets this on
          every visit, because it is the single most load-bearing idea here. */}
      <div className="px-5 mb-5">
        <div className="rounded-2xl border border-primary/25 bg-primary/[0.06] p-4 flex gap-3">
          <ShieldCheck size={16} className="text-primary shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold">A break is part of training</p>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              Time away is never counted as a failure, and nothing is crammed into the days after it.
              {isMinor ? ` ${YOUTH_BREAK_NOTE}` : ""}
            </p>
          </div>
        </div>
      </div>

      {/* ---------------------------------------------------------------- form */}
      <div className="px-5 mb-6">
        {!showForm ? (
          <motion.button
            whileTap={{ scale: 0.98 }}
            onClick={() => setShowForm(true)}
            className="w-full flex items-center justify-center gap-2 bg-gradient-primary text-primary-foreground font-semibold py-3 rounded-xl shadow-glow"
          >
            <Plus size={18} /> Add a break or change availability
          </motion.button>
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            className="rounded-[22px] border border-white/[0.07] bg-card/60 backdrop-blur-xl shadow-card p-4 space-y-4"
          >
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">{editingId ? "Edit this break" : "What's happening?"}</p>
              <button onClick={resetForm} aria-label="Close" className="p-1.5 text-muted-foreground hover:text-foreground">
                <X size={16} />
              </button>
            </div>

            {/* Type — no option requires an explanation. */}
            <div className="grid grid-cols-2 gap-2">
              {LIFE_EVENT_TYPES.map((t) => {
                const Icon = ICONS[t.icon] ?? CircleEllipsis;
                const active = form.event_type === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => chooseType(t.id)}
                    aria-pressed={active}
                    className={`flex items-start gap-2 rounded-xl border p-2.5 text-start transition-colors ${
                      active
                        ? "bg-primary/15 border-primary text-primary"
                        : "bg-card border-border text-foreground hover:border-primary/30"
                    }`}
                  >
                    <Icon size={14} className="mt-0.5 shrink-0" />
                    <span className="min-w-0">
                      <span className="block text-xs font-semibold">{t.label}</span>
                      <span className="block text-[11px] text-muted-foreground leading-tight">{t.hint}</span>
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-muted-foreground">
                From
                <input
                  type="date"
                  value={form.start_date}
                  onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/25"
                />
              </label>
              <label className="text-xs text-muted-foreground">
                To
                <input
                  type="date"
                  value={form.end_date}
                  onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                  className={`mt-1 w-full rounded-xl border bg-white/[0.04] px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/25 ${
                    invalidRange ? "border-destructive" : "border-white/[0.08]"
                  }`}
                />
              </label>
            </div>
            {invalidRange && (
              <p className="text-xs text-destructive">The end date can't be before the start date.</p>
            )}

            <div>
              <p className="text-xs text-muted-foreground mb-1.5">How active will you be?</p>
              <div className="grid grid-cols-4 gap-1.5">
                {ACTIVITY_LEVELS.map((level) => (
                  <button
                    key={level.id}
                    type="button"
                    aria-pressed={form.activity_level === level.id}
                    onClick={() => setForm({ ...form, activity_level: level.id as ActivityLevel })}
                    className={`rounded-lg border py-2 text-[11px] font-medium transition-colors ${
                      form.activity_level === level.id
                        ? "bg-primary/15 border-primary text-primary"
                        : "bg-card border-border text-muted-foreground"
                    }`}
                  >
                    {level.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs text-muted-foreground mb-1.5">Do you want training these days?</p>
              <div className="space-y-1.5">
                {ALLOW_TRAINING_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={form.allow_training === option.id}
                    onClick={() => setForm({ ...form, allow_training: option.id as AllowTraining })}
                    className={`w-full text-start rounded-xl border p-2.5 transition-colors ${
                      form.allow_training === option.id
                        ? "bg-primary/15 border-primary"
                        : "bg-card border-border"
                    }`}
                  >
                    <span className={`block text-xs font-semibold ${form.allow_training === option.id ? "text-primary" : ""}`}>
                      {option.label}
                    </span>
                    <span className="block text-[11px] text-muted-foreground">{option.hint}</span>
                  </button>
                ))}
              </div>
            </div>

            <label className="block text-xs text-muted-foreground">
              Note <span className="text-muted-foreground/70">— optional, and stays private</span>
              <textarea
                rows={2}
                value={form.note ?? ""}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
                placeholder="Anything you want to remember. You never have to explain."
                className="mt-1 w-full rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-primary/25 resize-none"
              />
            </label>

            <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-3">
              <p className="text-[11px] uppercase tracking-wider text-primary font-semibold flex items-center gap-1.5">
                <Info size={11} /> What this will do
              </p>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                {form.allow_training === "no"
                  ? `Sessions in these dates will be marked unavailable and left out of your completion percentage. They are not moved to later days.${definition.id === "holiday" || definition.id === "travel" ? " The week before is loaded a little harder, so nothing is programmed while you are away." : ""}`
                  : form.allow_training === "optional"
                    ? "Your plan stays as it is. Sessions in these dates are marked optional and won't be counted against you if you skip them."
                    : "Your plan is untouched — these dates are just recorded so the app knows where you are."}
              </p>
              {rebuildPreview && (
                <p className="text-xs text-primary mt-1.5 leading-relaxed">
                  That is long enough to lose fitness, so your plan will be rebuilt for the return: about{" "}
                  {rebuildPreview.volumes} of your usual volume across the {rebuildPreview.weeks} week
                  {rebuildPreview.weeks === 1 ? "" : "s"} after it, keeping the sessions that matter most and
                  moving nothing into the days that follow.
                </p>
              )}
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={resetForm}
                className="px-4 py-2.5 rounded-xl border border-white/[0.08] bg-white/[0.04] text-sm text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
              <motion.button
                whileTap={{ scale: 0.98 }}
                disabled={saving || invalidRange}
                onClick={() => void save()}
                className="flex-1 bg-gradient-primary text-primary-foreground font-semibold py-2.5 rounded-xl shadow-glow disabled:opacity-50"
              >
                {saving ? "Saving…" : editingId ? "Save changes" : "Save break"}
              </motion.button>
            </div>
          </motion.div>
        )}
      </div>

      {/* ------------------------------------------------------------- calendar */}
      <div className="px-5 mb-6">
        <h2 className="text-sm font-semibold text-muted-foreground mb-2">Next {BAND_WEEKS} weeks</h2>
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-3">
          <div className="grid grid-cols-7 gap-1 mb-1">
            {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
              <span key={i} className="text-[10px] text-center text-muted-foreground">{d}</span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {band.flat().map((day) => {
              const key = localDateKey(day);
              const event = eventOnDate(events, key);
              const kind = event ? availabilityKind(event) : null;
              const isToday = key === localDateKey(new Date());
              return (
                <div
                  key={key}
                  title={event ? `${formatPeriod(event.start_date, event.end_date)}` : undefined}
                  className={`h-7 rounded-md border text-[10px] flex items-center justify-center ${
                    kind ? KIND_STYLE[kind] : "border-transparent bg-white/[0.02] text-muted-foreground"
                  } ${isToday ? "ring-1 ring-primary" : ""}`}
                >
                  {day.getDate()}
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-3 mt-3 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5"><span aria-hidden className="w-3 h-3 rounded-sm border border-destructive/40 bg-destructive/25" /> Paused</span>
            <span className="flex items-center gap-1.5"><span aria-hidden className="w-3 h-3 rounded-sm border border-energy/40 bg-energy/20" /> Optional</span>
            <span className="flex items-center gap-1.5"><span aria-hidden className="w-3 h-3 rounded-sm border border-primary/35 bg-primary/15" /> Away, still training</span>
          </div>
        </div>
      </div>

      {/* ----------------------------------------------------------- the breaks */}
      <div className="px-5">
        <h2 className="text-sm font-semibold text-muted-foreground mb-2">Your breaks</h2>

        {loading && <p className="text-sm text-muted-foreground text-center py-8">Loading…</p>}
        {error && (
          <div className="rounded-2xl border border-destructive/30 bg-destructive/[0.06] p-4 text-sm">
            <p className="font-semibold">Couldn't load your breaks</p>
            <p className="text-xs text-muted-foreground mt-1">{error}</p>
          </div>
        )}
        {!loading && !error && events.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">
            Nothing recorded. Add a break whenever your life needs one.
          </p>
        )}

        <div className="space-y-3">
          {sortEvents(events).map((event) => {
            const def = LIFE_EVENT_TYPES.find((t) => t.id === event.event_type)!;
            const Icon = ICONS[def.icon] ?? CircleEllipsis;
            const details = impact.get(event.id);
            const expanded = expandedId === event.id;
            const kind = availabilityKind(event);
            return (
              <motion.div
                key={event.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className={`rounded-2xl border bg-white/[0.04] backdrop-blur overflow-hidden ${
                  kind === "paused" ? "border-destructive/30" : "border-white/[0.07]"
                }`}
              >
                <button
                  type="button"
                  onClick={() => setExpandedId(expanded ? null : event.id)}
                  aria-expanded={expanded}
                  className="w-full text-start p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2.5 min-w-0">
                      <Icon size={16} className="text-primary mt-0.5 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold truncate">{def.label}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {formatPeriod(event.start_date, event.end_date)} · {spanDays(event.start_date, event.end_date)} day
                          {spanDays(event.start_date, event.end_date) === 1 ? "" : "s"}
                        </p>
                      </div>
                    </div>
                    <span className={`shrink-0 text-[10px] uppercase tracking-wider rounded-full px-2 py-0.5 border ${
                      kind === "paused"
                        ? "border-destructive/40 text-destructive"
                        : kind === "optional"
                          ? "border-energy/40 text-energy"
                          : "border-primary/40 text-primary"
                    }`}>
                      {kind === "paused" ? "Training paused" : kind === "optional" ? "Optional" : "Away"}
                    </span>
                  </div>
                </button>

                <AnimatePresence initial={false}>
                  {expanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="px-4 pb-4 space-y-3">
                        {details?.explanation && (
                          <div className="rounded-xl border border-primary/20 bg-primary/[0.06] p-3">
                            <p className="text-[11px] uppercase tracking-wider text-primary font-semibold">What changed</p>
                            <p className="text-xs mt-1 leading-relaxed">{details.explanation}</p>
                            {details.key > 0 && (
                              <p className="text-xs mt-1.5 text-muted-foreground">
                                {/* Agreement follows the number of key sessions, not the total.
                                    "1 of those were key session" was the first thing a real
                                    7-day break produced. */}
                                {details.key === 1
                                  ? "1 of those was a key session."
                                  : `${details.key} of those were key sessions.`}{" "}
                                Nothing has been rescheduled — no session changes its day.
                              </p>
                            )}
                          </div>
                        )}

                        {/* The rebuild, said next to the sessions it changed. This is the
                            difference between "six sessions were lost" and "and here is what
                            your plan looks like now". */}
                        {rebuildByEvent.get(event.id) && (
                          <div className="rounded-xl border border-info/25 bg-info/[0.06] p-3">
                            <p className="text-[11px] uppercase tracking-wider text-info font-semibold">
                              {rebuildByEvent.get(event.id)!.headline}
                            </p>
                            <p className="text-xs mt-1 leading-relaxed">
                              {rebuildByEvent.get(event.id)!.explanation}
                            </p>
                            <p className="text-xs mt-1.5 text-muted-foreground">
                              Week{rebuildByEvent.get(event.id)!.steps.length === 1 ? " " : "s "}
                              {rebuildByEvent.get(event.id)!.steps.map((s) => s.week).join(", ")} ·{" "}
                              {rebuildByEvent.get(event.id)!.steps.map((s) => `${s.volumePct}%`).join(" → ")} of your
                              usual volume
                            </p>
                          </div>
                        )}

                        {!details?.explanation && (
                          <p className="text-xs text-muted-foreground">
                            No planned sessions fall in these dates.
                          </p>
                        )}

                        {event.note && (
                          <p className="text-xs text-muted-foreground italic">“{event.note}”</p>
                        )}

                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => beginEdit(event)}
                            className="flex-1 rounded-xl border border-white/[0.08] bg-white/[0.04] py-2 text-xs font-semibold"
                          >
                            Edit dates
                          </button>
                          <button
                            type="button"
                            onClick={() => void removeEvent(event)}
                            className="flex items-center justify-center gap-1.5 rounded-xl border border-destructive/30 bg-destructive/[0.08] px-3 py-2 text-xs font-semibold text-destructive"
                          >
                            <Trash2 size={13} /> Remove
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default Availability;
