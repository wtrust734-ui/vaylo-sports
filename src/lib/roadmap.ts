// ============================================================================
// GOAL → DEVELOPMENT ROADMAP
// ----------------------------------------------------------------------------
// A goal says where an athlete wants to get to. A roadmap says what is between
// here and there: which phase they are in, which areas of their development
// matter right now, the milestones on the way, whether the pace is actually
// working, and what to do next.
//
// This EXTENDS the goals system. `outcome_goals` already stores the target
// (`target_value`), where the athlete is (`current_value`), where they started
// (`start_value`) and when they want it by (`deadline`). The roadmap columns
// added in `20261005210000_goal_roadmap_and_guardians.sql` — `current_level`,
// `phase`, `development_areas`, `milestones`, `progress_status`,
// `roadmap_updated_at` — are the middle of that journey, on the same row. There
// is no second goals table and there is no second progress number: the
// percentage below is `outcomeProgress()` from `src/lib/goals.ts`, unchanged.
//
// THE ROADMAP IS DERIVED, NOT AUTHORED. Everything here is a pure function of
// the goal plus what the athlete has already recorded, so it moves on its own
// when a session is logged, a competition is added, a break is recorded or a
// plan is rebuilt:
//
//   • life events        (Phase 1) a break in place, or one just finished
//   • plan rebuilds      (Phase 2) the return-from-break progression in force
//   • recovery read      (Phase 3) today's recovery band and adjustment action
//   • competitions       the next event, and how close it is
//   • consistency        planned vs completed over the last four weeks
//
// Stored values are respected when they exist. An athlete (or a later AI pass)
// can write a phase, a current level or a set of milestones, and those win over
// anything derived here; the derived value is the fallback, not an override.
// ============================================================================

import type { OutcomeGoal } from "./goals";
import { outcomeProgress } from "./goals";
import { localDateKey } from "./dates";
import type { ActivityLevel, AllowTraining, LifeEventType } from "./lifeEvents";
import type { PlanAdjustmentRecord } from "./adaptivePlan";
import type { AdjustmentAction } from "./recoveryAdjust";
import type { PlanWeekLike } from "./planSchedule";
import { classifySport } from "./sessionLoad";
import { daysBetween } from "./adaptivePlan";

// ---------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------

/** The closed set the database also enforces (`outcome_goals_phase_allowed`). */
export type DevelopmentPhase = "base" | "build" | "specific" | "competition" | "transition";

export const DEVELOPMENT_PHASES: readonly DevelopmentPhase[] = [
  "base",
  "build",
  "specific",
  "competition",
  "transition",
];

export const isDevelopmentPhase = (value: unknown): value is DevelopmentPhase =>
  typeof value === "string" && (DEVELOPMENT_PHASES as readonly string[]).includes(value);

export const PHASE_LABELS: Record<DevelopmentPhase, string> = {
  base: "Base",
  build: "Build",
  specific: "Sport-specific",
  competition: "Competition",
  transition: "Transition",
};

export const PHASE_BLURBS: Record<DevelopmentPhase, string> = {
  base: "Widen the foundation — aerobic capacity, technique, mobility. Nothing is sharp yet and nothing needs to be.",
  build: "Raise the load steadily. This is where the biggest gains are won and where most overuse injuries are earned.",
  specific: "Make training look like the event: the paces, the demands, the decisions.",
  competition: "Stay sharp and taper. Fresher is faster.",
  transition: "Step back, review what worked, and let the body absorb the season.",
};

// ---------------------------------------------------------------------------
// Milestones and progress
// ---------------------------------------------------------------------------

export type MilestoneStatus = "achieved" | "upcoming" | "missed";

export const MILESTONE_STATUSES: readonly MilestoneStatus[] = ["achieved", "upcoming", "missed"];

export interface RoadmapMilestone {
  id: string;
  title: string;
  /** Local calendar day, `YYYY-MM-DD`. Null when it has no date yet. */
  targetDate: string | null;
  status: MilestoneStatus;
  note?: string | null;
}

export type RoadmapProgressStatus = "on_track" | "ahead" | "behind" | "unknown";

export const ROADMAP_PROGRESS_STATUSES: readonly RoadmapProgressStatus[] = [
  "on_track",
  "ahead",
  "behind",
  "unknown",
];

export const PROGRESS_LABELS: Record<RoadmapProgressStatus, string> = {
  on_track: "On track",
  ahead: "Ahead",
  behind: "Behind",
  unknown: "Unmeasured",
};

/** Where the percentage came from, so the UI can be honest about it. */
export type ProgressSource = "computed" | "stored" | "unmeasurable";

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/**
 * An `outcome_goals` row including the roadmap columns.
 *
 * Every roadmap column is optional here because the client has to keep working
 * against a database that has not run the migration yet — and because a goal
 * created five minutes ago has none of them.
 */
export interface RoadmapGoalRow extends OutcomeGoal {
  created_at?: string | null;
  updated_at?: string | null;
  current_level?: string | null;
  phase?: string | null;
  development_areas?: unknown;
  milestones?: unknown;
  progress_status?: string | null;
  roadmap_updated_at?: string | null;
}

/** The subset of a life event the roadmap reasons about. */
export interface RoadmapLifeEventLike {
  id?: string;
  start_date: string;
  end_date: string;
  event_type: LifeEventType;
  activity_level: ActivityLevel;
  allow_training: AllowTraining;
}

export interface RoadmapCompetitionLike {
  title: string;
  /** Local calendar day, `YYYY-MM-DD`. */
  date: string;
  sport?: string | null;
}

export type RecoveryBand = "good" | "moderate" | "low" | "unknown";

export interface RoadmapRecoveryLike {
  band: RecoveryBand;
  /** The Phase 3 decision for today, when there is one. */
  action?: AdjustmentAction | null;
}

export interface RoadmapConsistencyLike {
  completed: number;
  planned: number;
  percent: number | null;
}

export interface RoadmapContext {
  /** Local calendar day, `YYYY-MM-DD`. Defaults to today. */
  today?: string;
  age?: number | null;
  /** The athlete's sports, from their profile. */
  sports?: string[];
  lifeEvents?: RoadmapLifeEventLike[];
  /** `training_plans.plan_data`, so a rebuild in force can be seen. */
  weeks?: PlanWeekLike[];
  /** `activeAdjustments(training_plans.plan_adjustments)`. */
  adjustments?: PlanAdjustmentRecord[];
  recovery?: RoadmapRecoveryLike | null;
  competitions?: RoadmapCompetitionLike[];
  consistency?: RoadmapConsistencyLike | null;
  /** How many days a life event stays "recent" for. Defaults to 28. */
  recentBreakDays?: number;
}

// ---------------------------------------------------------------------------
// Influences — what is currently shaping this goal
// ---------------------------------------------------------------------------

export type RoadmapInfluenceKind =
  | "life_event"
  | "return_from_break"
  | "recovery"
  | "competition"
  | "consistency";

export type InfluenceTone = "positive" | "info" | "watch";

export interface RoadmapInfluence {
  kind: RoadmapInfluenceKind;
  label: string;
  detail: string;
  tone: InfluenceTone;
}

export interface GoalRoadmap {
  goalId: string;
  title: string;
  category: string;
  phase: DevelopmentPhase;
  phaseSource: "stored" | "derived";
  currentLevel: string;
  target: string;
  developmentAreas: string[];
  areasSource: "stored" | "derived";
  milestones: RoadmapMilestone[];
  milestonesSource: "stored" | "derived";
  progress: {
    status: RoadmapProgressStatus;
    source: ProgressSource;
    percent: number;
    daysRemaining: number | null;
    requiredRate: string;
    summary: string;
  };
  priorities: string[];
  nextActions: string[];
  influences: RoadmapInfluence[];
  updatedAt: string | null;
  staleDays: number | null;
  isStale: boolean;
}

// ---------------------------------------------------------------------------
// Reading stored values
// ---------------------------------------------------------------------------

/** A roadmap is a summary, not a document — the same cap the CHECK enforces. */
export const MAX_DEVELOPMENT_AREAS = 8;
export const MAX_MILESTONES = 20;

const str = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

/**
 * A number, or null when there is not one.
 *
 * `Number(null)` is 0 and `Number("")` is 0, and either would turn "no target"
 * into "the target is zero" — which on a time goal reads as a spectacular
 * improvement rather than missing data.
 */
const numeric = (value: unknown): number | null => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

/** Coerce a stored `development_areas` value into a clean, bounded list. */
export function parseDevelopmentAreas(value: unknown): string[] {
  let raw: unknown = value;
  if (typeof raw === "string") {
    // Tolerate a JSON string: an import or a hand-written row can hold one, and
    // silently dropping the athlete's own areas would be worse than parsing it.
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = [value];
    }
  }
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const entry of raw) {
    const label = str(entry);
    if (!label) continue;
    if (out.some((a) => a.toLowerCase() === label.toLowerCase())) continue;
    out.push(label.slice(0, 60));
    if (out.length >= MAX_DEVELOPMENT_AREAS) break;
  }
  return out;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** `YYYY-MM-DD`, or null. Anything else is dropped rather than shown wrong. */
export function asIsoDate(value: unknown): string | null {
  const s = str(value);
  if (!s) return null;
  const head = s.slice(0, 10);
  return ISO_DATE.test(head) ? head : null;
}

/**
 * Coerce a stored `milestones` value into the shape this module reasons about.
 * Malformed entries are dropped; a milestone with no title is not a milestone.
 */
export function parseStoredMilestones(value: unknown): RoadmapMilestone[] {
  let raw: unknown = value;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];
  const out: RoadmapMilestone[] = [];
  raw.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") return;
    const row = entry as Record<string, unknown>;
    const title = str(row.title);
    if (!title) return;
    const status = MILESTONE_STATUSES.includes(row.status as MilestoneStatus)
      ? (row.status as MilestoneStatus)
      : null;
    out.push({
      id: str(row.id) ?? `m${index + 1}`,
      title: title.slice(0, 160),
      targetDate: asIsoDate(row.targetDate ?? row.target_date),
      status: status ?? "upcoming",
      note: str(row.note),
    });
    if (out.length >= MAX_MILESTONES) return;
  });
  return out.slice(0, MAX_MILESTONES);
}

// ---------------------------------------------------------------------------
// Deriving development areas
// ---------------------------------------------------------------------------

/** Areas that follow from what the goal is actually about. */
const CATEGORY_AREAS: Record<string, string[]> = {
  performance: ["aerobic capacity", "threshold work", "pace control"],
  speed: ["speed reserve", "acceleration mechanics", "recovery between efforts"],
  strength: ["max strength", "power", "movement quality"],
  endurance: ["aerobic base", "sustained output", "fuelling"],
  skill: ["technique", "decision making", "consistency under pressure"],
  technique: ["technique", "movement quality", "repeatability"],
  consistency: ["weekly rhythm", "sleep", "load management"],
  recovery: ["sleep", "fuelling", "load management"],
  weight: ["fuelling", "strength maintenance", "recovery"],
  health: ["sleep", "load management", "mobility"],
  mental: ["routine", "focus under pressure", "reflection"],
  team: ["communication", "positional awareness", "work rate"],
};

/** Areas that follow from the sport — classified by the Phase 3 sport reader. */
const SPORT_AREAS: Record<string, string[]> = {
  running: ["aerobic capacity", "running economy", "pace control"],
  cycling: ["aerobic capacity", "cadence and gearing", "sustained power"],
  swimming: ["stroke efficiency", "aerobic capacity", "turns and pacing"],
  strength: ["max strength", "power", "technique under load"],
  field: ["change of direction", "repeated-sprint ability", "positional awareness"],
  court: ["change of direction", "footwork", "repeated-sprint ability"],
  unknown: [],
};

/**
 * The development areas for a goal when none were stored.
 *
 * Category first, then the sport, because a goal's category is the athlete's own
 * statement of what the goal is about and the sport only refines it. Bounded at
 * `MAX_DEVELOPMENT_AREAS` so this can never produce a list the database would
 * refuse to store.
 */
export function deriveDevelopmentAreas(goal: RoadmapGoalRow, context: RoadmapContext = {}): string[] {
  const out: string[] = [];
  const add = (label: string) => {
    if (out.length >= MAX_DEVELOPMENT_AREAS) return;
    if (out.some((a) => a.toLowerCase() === label.toLowerCase())) return;
    out.push(label);
  };

  const category = str(goal.category)?.toLowerCase() ?? "";
  for (const area of CATEGORY_AREAS[category] ?? []) add(area);

  const sports = (context.sports ?? []).filter((s) => typeof s === "string" && s.trim().length);
  for (const sport of sports) {
    const kind = classifySport(sport, null);
    for (const area of SPORT_AREAS[kind] ?? []) add(area);
  }

  if (!out.length) {
    // A goal with no category and no sport still deserves an answer, and "work
    // out what this needs" is more honest than inventing a training block.
    add("the basics of this goal");
  }
  return out.slice(0, MAX_DEVELOPMENT_AREAS);
}

// ---------------------------------------------------------------------------
// Deriving the phase
// ---------------------------------------------------------------------------

const DAYS_TO_COMPETITION_PEAK = 14;
const DAYS_TO_COMPETITION_SPECIFIC = 42;

/**
 * The phase a goal is in when nobody has said otherwise.
 *
 * Competition proximity wins, because a date on a calendar is a harder fact
 * than an inferred training block. A break that pauses training forces
 * `transition`: an athlete who is ill or injured is not in a build phase,
 * whatever the calendar says.
 */
export function derivePhase(
  goal: RoadmapGoalRow,
  context: RoadmapContext = {},
  percent = 0,
  daysRemaining: number | null = null,
): DevelopmentPhase {
  const today = context.today ?? localDateKey(new Date());

  if (pauseInPlace(context.lifeEvents ?? [], today)) return "transition";

  const next = nextCompetition(context.competitions ?? [], today);
  if (next) {
    const until = daysBetween(today, next.date);
    if (until != null && until <= DAYS_TO_COMPETITION_PEAK) return "competition";
    if (until != null && until <= DAYS_TO_COMPETITION_SPECIFIC) return "specific";
  }

  // A goal whose deadline has passed and which is not finished is in the part
  // of the story where the question is what to carry forward, not what to add.
  if (daysRemaining != null && daysRemaining <= 0 && percent < 100) return "transition";

  if (percent >= 70) return "specific";
  if (daysRemaining != null && daysRemaining <= 56) return "build";
  if (percent >= 35) return "build";
  return "base";
}

/** True when a life event stops training outright. Mirrors `pausesTraining`. */
const stopsTraining = (event: RoadmapLifeEventLike): boolean => event.allow_training === "no";

function pauseInPlace(events: RoadmapLifeEventLike[], today: string): RoadmapLifeEventLike | null {
  return (
    events.find(
      (e) =>
        e &&
        typeof e.start_date === "string" &&
        typeof e.end_date === "string" &&
        e.start_date <= today &&
        e.end_date >= today &&
        stopsTraining(e),
    ) ?? null
  );
}

function nextCompetition(
  competitions: RoadmapCompetitionLike[],
  today: string,
): RoadmapCompetitionLike | null {
  const upcoming = competitions
    .filter((c) => c && asIsoDate(c.date) && asIsoDate(c.date)! >= today)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return upcoming[0] ?? null;
}

// ---------------------------------------------------------------------------
// Milestones
// ---------------------------------------------------------------------------

export const MILESTONE_CHECKPOINTS: readonly number[] = [25, 50, 75, 100];

const addDaysIso = (iso: string, days: number): string => {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, (m ?? 1) - 1, d ?? 1);
  date.setDate(date.getDate() + days);
  return localDateKey(date);
};

/** Interpolate a calendar day between two dates. */
function interpolateDate(from: string, to: string, fraction: number): string {
  const span = daysBetween(from, to);
  if (span == null || span <= 0) return to;
  const offset = Math.round(span * Math.min(1, Math.max(0, fraction)));
  return addDaysIso(from, offset);
}

/** The value the athlete would be at, at a given percentage of the target. */
function valueAtPercent(goal: RoadmapGoalRow, percent: number): number | null {
  const start = numeric(goal.start_value) ?? 0;
  const target = numeric(goal.target_value);
  if (target == null || target === start) return null;
  const value = start + ((target - start) * percent) / 100;
  // Two decimals at most, and no trailing zeroes: "10.5 km", not "10.50 km".
  return Math.round(value * 100) / 100;
}

const formatValue = (value: number | null, unit: string | null): string | null => {
  if (value == null || !Number.isFinite(value)) return null;
  const rounded = Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0$/, "");
  const clean = unit ? `${rounded} ${unit}` : rounded;
  return clean.trim();
};

/** True for the generated checkpoint ids (`cp25`, `cp50`, …). */
export const isDerivedMilestoneId = (id: string): boolean => /^cp\d+$/.test(id);

/**
 * Milestones for a goal.
 *
 * A milestone the athlete wrote wins — those are their own words. Where there is
 * none, the checkpoints are derived from the goal itself, split evenly across
 * the time between when the goal was set and its deadline, because a target
 * date with nothing between now and then is a wish rather than a plan.
 */
export function goalMilestones(
  goal: RoadmapGoalRow,
  context: RoadmapContext = {},
  percent = 0,
): { milestones: RoadmapMilestone[]; source: "stored" | "derived" } {
  const today = context.today ?? localDateKey(new Date());
  const stored = parseStoredMilestones(goal.milestones);
  // A milestone the athlete wrote wins over anything generated here. Generated
  // checkpoints are identified by their `cpNN` id and are ALWAYS recomputed,
  // even when a previous run has since written them to the row: they are
  // derived from the deadline, so trusting a copy would freeze the roadmap the
  // first time the athlete moved their own target date. This is also why the
  // write-back can safely persist them for the guardian view to read.
  const authored = stored.filter((m) => !isDerivedMilestoneId(m.id));
  if (authored.length) {
    return {
      // Restate the status from today's numbers: a milestone the athlete has
      // clearly passed should not read "upcoming" only because nobody edited
      // the row, and one whose date has gone by is missed rather than pending.
      milestones: authored.map((m) => ({ ...m, status: restateMilestone(m, percent, today) })),
      source: "stored",
    };
  }

  const deadline = asIsoDate(goal.deadline);
  const created = asIsoDate(goal.created_at) ?? today;
  const unit = str(goal.metric_unit);

  const milestones: RoadmapMilestone[] = MILESTONE_CHECKPOINTS.map((checkpoint) => {
    const value = valueAtPercent(goal, checkpoint);
    const valueText = formatValue(value, unit);
    const title =
      checkpoint === 100
        ? `Reach the target${valueText ? ` — ${valueText}` : ""}`
        : valueText
          ? `Reach ${valueText}`
          : `${checkpoint}% of the way`;
    const targetDate = deadline ? interpolateDate(created, deadline, checkpoint / 100) : null;
    const milestone: RoadmapMilestone = {
      id: `cp${checkpoint}`,
      title,
      targetDate,
      status: "upcoming",
    };
    return { ...milestone, status: restateMilestone(milestone, percent, today) };
  });

  return { milestones, source: "derived" };
}

/** Recompute a milestone's status from the current percentage and today. */
export function restateMilestone(
  milestone: RoadmapMilestone,
  percent: number,
  today: string,
): MilestoneStatus {
  if (milestone.status === "achieved") return "achieved";
  // A derived checkpoint encodes its own threshold in its id (`cp50`).
  const fromId = /^cp(\d+)$/.exec(milestone.id);
  const threshold = fromId ? Number(fromId[1]) : null;
  if (threshold != null && percent >= threshold) return "achieved";
  if (milestone.targetDate && milestone.targetDate < today) return "missed";
  return "upcoming";
}

/** The next milestone still ahead of the athlete, or null. */
export function nextMilestone(milestones: readonly RoadmapMilestone[]): RoadmapMilestone | null {
  const pending = milestones
    .filter((m) => m.status !== "achieved")
    .sort((a, b) => {
      const ad = a.targetDate ?? "9999-12-31";
      const bd = b.targetDate ?? "9999-12-31";
      return ad < bd ? -1 : ad > bd ? 1 : 0;
    });
  return pending[0] ?? null;
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

const AHEAD_MARGIN = 5;

export interface RoadmapProgress {
  status: RoadmapProgressStatus;
  source: ProgressSource;
  percent: number;
  daysRemaining: number | null;
  requiredRate: string;
  summary: string;
}

/**
 * Whether the pace is working.
 *
 * `percent` is the app's existing goal percentage, not a second one. The status
 * compares it against where a straight line from "when the goal was set" to the
 * deadline would put them, which is the only comparison that means anything
 * without inventing a performance model.
 */
export function goalProgress(
  goal: RoadmapGoalRow,
  context: RoadmapContext = {},
): RoadmapProgress {
  const today = context.today ?? localDateKey(new Date());
  const percent = outcomeProgress(goal);
  const target = numeric(goal.target_value);
  const deadline = asIsoDate(goal.deadline);
  const daysRemaining = deadline ? daysBetween(today, deadline) : null;
  const rate = roadmapRate(goal, today);

  if (target == null || target === 0) {
    return {
      status: "unknown",
      source: "unmeasurable",
      percent,
      daysRemaining,
      requiredRate: rate,
      summary:
        "This goal has no number attached, so there is no percentage to track. The milestones below are the progress.",
    };
  }

  if (!deadline) {
    return {
      status: "unknown",
      source: "unmeasurable",
      percent,
      daysRemaining: null,
      requiredRate: rate,
      summary: `You're ${percent}% of the way there. Add a target date and this roadmap can pace itself.`,
    };
  }

  if (percent >= 100) {
    return {
      status: "ahead",
      source: "computed",
      percent,
      daysRemaining,
      requiredRate: rate,
      summary: `Done — you reached ${formatValue(target, str(goal.metric_unit)) ?? "the target"}.`,
    };
  }

  const created = asIsoDate(goal.created_at);
  const span = created ? daysBetween(created, deadline) : null;
  const elapsed = created ? daysBetween(created, today) : null;
  const expected =
    span != null && span > 0 && elapsed != null
      ? Math.min(100, Math.max(0, (elapsed / span) * 100))
      : null;

  if (daysRemaining != null && daysRemaining <= 0) {
    return {
      status: "behind",
      source: "computed",
      percent,
      daysRemaining,
      requiredRate: rate,
      summary: `The target date has passed and you're ${percent}% of the way there. Reset the date or carry this forward as the next goal.`,
    };
  }

  let status: RoadmapProgressStatus;
  let source: ProgressSource = "computed";
  if (expected == null) {
    const stored = ROADMAP_PROGRESS_STATUSES.includes(goal.progress_status as RoadmapProgressStatus)
      ? (goal.progress_status as RoadmapProgressStatus)
      : null;
    // Without a start date there is no line to be ahead of or behind, so the
    // last stored reading is the honest answer rather than a guess.
    status = stored ?? "unknown";
    source = stored ? "stored" : "unmeasurable";
  } else if (percent >= expected + AHEAD_MARGIN) {
    status = "ahead";
  } else if (percent <= expected - AHEAD_MARGIN) {
    status = "behind";
  } else {
    status = "on_track";
  }

  const days = daysRemaining;
  // A rate of "—" must not become "which needs about —": when the number is not
  // there, the sentence says what happened without inventing a pace.
  const pace = rate === "—" ? "" : `, which needs about ${rate}`;
  const summary =
    status === "ahead"
      ? `Ahead of pace: ${percent}% of the way there with ${days} days left.`
      : status === "behind"
        ? `Behind pace: ${percent}% with ${days} days left${pace}.`
        : status === "on_track"
          ? `On track: ${percent}% of the way there with ${days} days left.`
          : `You're ${percent}% of the way there with ${days} days left.`;

  return { status, source, percent, daysRemaining, requiredRate: rate, summary };
}

// ---------------------------------------------------------------------------
// Influences, priorities, next actions
// ---------------------------------------------------------------------------

const EVENT_LABELS: Record<string, string> = {
  illness: "Illness",
  injury: "Injury",
  holiday: "Holiday",
  travel: "Travel",
  exams: "Exams",
  competition: "Competition",
  wellbeing: "A deliberate break",
  busy: "A busy period",
  family: "Family",
  other: "A break",
  private: "A break",
};

export const RETURN_INFLUENCE_DAYS = 21;

function influencesFor(context: RoadmapContext): RoadmapInfluence[] {
  const today = context.today ?? localDateKey(new Date());
  const out: RoadmapInfluence[] = [];
  const recentWindow = context.recentBreakDays ?? 28;

  const active = pauseInPlace(context.lifeEvents ?? [], today);
  if (active) {
    out.push({
      kind: "life_event",
      label: "Training is paused",
      detail: `${EVENT_LABELS[active.event_type] ?? "A break"} is recorded until ${active.end_date}. Sessions in this window are cancelled rather than missed.`,
      tone: "watch",
    });
  } else {
    const recent = (context.lifeEvents ?? [])
      .filter((e) => e && typeof e.end_date === "string" && e.end_date < today && stopsTraining(e))
      .filter((e) => {
        const since = daysBetween(e.end_date, today);
        return since != null && since <= recentWindow;
      })
      .sort((a, b) => (a.end_date < b.end_date ? 1 : -1))[0];
    if (recent) {
      out.push({
        kind: "life_event",
        label: "Recently back from a break",
        detail: `${EVENT_LABELS[recent.event_type] ?? "A break"} finished on ${recent.end_date}. The plan was rebuilt rather than resumed, and this goal is being paced against that.`,
        tone: "info",
      });
    }
  }

  // A rebuild still inside its return window is the single most important thing
  // to say about a plan: the numbers below are deliberately below the ceiling.
  const rebuild = (context.adjustments ?? [])
    .filter((a) => a && a.break && typeof a.createdAt === "string")
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
  if (rebuild) {
    const since = daysBetween(rebuild.break.endDate, today);
    if (since != null && since <= RETURN_INFLUENCE_DAYS) {
      out.push({
        kind: "return_from_break",
        label: "Easing back in",
        detail: rebuild.headline || "The plan is in a return-from-break progression.",
        tone: "info",
      });
    }
  }

  const weekInReturn = (context.weeks ?? []).find((w) => w && w.returnFromBreak);
  if (weekInReturn && weekInReturn.returnFromBreak) {
    const meta = weekInReturn.returnFromBreak;
    out.push({
      kind: "return_from_break",
      label: `Return week ${meta.weekBack}`,
      detail: `Week ${weekInReturn.week} is running at ${meta.volumePct}% of the usual volume — ${meta.focus || "rebuilding"}.`,
      tone: "info",
    });
  }

  const band = context.recovery?.band;
  if (band === "low") {
    out.push({
      kind: "recovery",
      label: "Recovery is low",
      detail: "Your recent check-ins put recovery in the low band, so today's session was adjusted down rather than pushed through.",
      tone: "watch",
    });
  } else if (band === "moderate") {
    out.push({
      kind: "recovery",
      label: "Recovery is moderate",
      detail: "Recovery is holding, but not with room to spare. Intensity is the first thing to cut, not frequency.",
      tone: "info",
    });
  } else if (band === "good") {
    out.push({
      kind: "recovery",
      label: "Recovery is good",
      detail: "Sleep, fatigue and readiness are all in a good place. This is a week you can spend.",
      tone: "positive",
    });
  }

  const next = nextCompetition(context.competitions ?? [], today);
  if (next) {
    const until = daysBetween(today, next.date);
    if (until != null && until <= DAYS_TO_COMPETITION_SPECIFIC) {
      out.push({
        kind: "competition",
        label: until <= DAYS_TO_COMPETITION_PEAK ? "Competing soon" : "Competition coming up",
        detail: `${next.title} on ${next.date}${until != null ? ` — ${until} day${until === 1 ? "" : "s"} away` : ""}.`,
        tone: until <= DAYS_TO_COMPETITION_PEAK ? "watch" : "info",
      });
    }
  }

  const consistency = context.consistency;
  if (consistency && consistency.planned > 0 && (consistency.percent ?? 100) < 50) {
    out.push({
      kind: "consistency",
      label: "Fewer sessions than planned",
      detail: `${consistency.completed} of ${consistency.planned} planned sessions were completed recently. A goal moves on the sessions that happen.`,
      tone: "watch",
    });
  }

  return out;
}

/** What to concentrate on. Three at most — a list of seven is not a priority. */
export function roadmapPriorities(
  roadmap: Omit<GoalRoadmap, "priorities" | "nextActions">,
): string[] {
  const out: string[] = [];
  const kinds = new Set(roadmap.influences.map((i) => i.kind));
  const labels = new Map(roadmap.influences.map((i) => [i.label, i]));

  if (labels.has("Training is paused")) {
    out.push("Come back gradually — follow the rebuilt weeks rather than the original plan.");
  } else if (kinds.has("return_from_break")) {
    out.push("Rebuild before you push. The return weeks are deliberately below your ceiling.");
  }
  if (labels.has("Competing soon") || labels.has("Competition coming up")) {
    out.push("Sharpen for the next competition, then taper into it.");
  }
  if (roadmap.progress.status === "behind") {
    out.push(`Lift the weekly rate to about ${roadmap.progress.requiredRate} to reach the target on time.`);
  }
  if ((roadmap.influences.find((i) => i.kind === "recovery")?.tone ?? "") === "watch") {
    out.push("Protect sleep and recovery this week before adding load.");
  }
  if (kinds.has("consistency")) {
    out.push("Get the weekly habit back before adding volume.");
  }
  if (out.length < 3) out.push(PHASE_BLURBS[roadmap.phase]);

  return out.slice(0, 3);
}

/** The next concrete things to do. Four at most, and each one actionable. */
export function roadmapNextActions(
  goal: RoadmapGoalRow,
  roadmap: Omit<GoalRoadmap, "priorities" | "nextActions">,
): string[] {
  const out: string[] = [];

  // Gaps come first. A roadmap that cannot pace itself is more worth fixing
  // than the next thing to do this week, and at four actions the other two
  // would otherwise crowd it out entirely.
  const target = numeric(goal.target_value);
  if (target == null || target === 0) {
    out.push("Add a target number so progress can be measured against something.");
  }
  if (!asIsoDate(goal.deadline)) {
    out.push("Add a target date so this roadmap can pace itself.");
  }

  const next = nextMilestone(roadmap.milestones);
  if (next) {
    out.push(`Next milestone: ${next.title}${next.targetDate ? ` — by ${next.targetDate}` : ""}.`);
  }
  if (roadmap.progress.status === "behind" && roadmap.progress.requiredRate !== "—") {
    out.push(`Weekly rate needed: ${roadmap.progress.requiredRate}.`);
  }
  if (roadmap.developmentAreas.length) {
    out.push(`Focus this week: ${roadmap.developmentAreas[0]}.`);
  }
  if (roadmap.developmentAreas.length > 1) {
    out.push(`Secondary focus: ${roadmap.developmentAreas[1]}.`);
  }

  return out.slice(0, 4);
}

// ---------------------------------------------------------------------------
// Building a roadmap
// ---------------------------------------------------------------------------

export const STALE_ROADMAP_DAYS = 14;

/** Build the roadmap for one goal. Pure: same inputs, same output, always. */
export function buildGoalRoadmap(goal: RoadmapGoalRow, context: RoadmapContext = {}): GoalRoadmap {
  const today = context.today ?? localDateKey(new Date());

  const progress = goalProgress(goal, context);
  const derivedPhase = derivePhase(goal, context, progress.percent, progress.daysRemaining);
  const storedPhase = isDevelopmentPhase(goal.phase) ? goal.phase : null;
  // A stored phase is overridden while a break is in place: presenting "build"
  // to an athlete who is ill would be the app arguing with their own record.
  const phase = pauseInPlace(context.lifeEvents ?? [], today) ? "transition" : (storedPhase ?? derivedPhase);

  const storedAreas = parseDevelopmentAreas(goal.development_areas);
  const { milestones, source: milestonesSource } = goalMilestones(goal, context, progress.percent);

  const updatedAt = str(goal.roadmap_updated_at);
  const staleDays = updatedAt ? daysBetween(updatedAt.slice(0, 10), today) : null;

  const base = {
    goalId: goal.id,
    title: goal.title,
    category: goal.category,
    phase,
    phaseSource: storedPhase && phase === storedPhase ? ("stored" as const) : ("derived" as const),
    currentLevel: str(goal.current_level) ?? "Not recorded yet",
    target: targetText(goal),
    developmentAreas: storedAreas.length ? storedAreas : deriveDevelopmentAreas(goal, context),
    areasSource: storedAreas.length ? ("stored" as const) : ("derived" as const),
    milestones,
    milestonesSource,
    progress,
    influences: influencesFor(context),
    updatedAt,
    staleDays,
    isStale: staleDays != null && staleDays >= STALE_ROADMAP_DAYS,
  };

  const withCopy = {
    ...base,
    priorities: [] as string[],
    nextActions: [] as string[],
  };
  withCopy.priorities = roadmapPriorities(withCopy);
  withCopy.nextActions = roadmapNextActions(goal, withCopy);
  return withCopy;
}

/** `"18:00"` or `"72 kg"` — the target, read the way the athlete wrote it. */
/**
 * How fast the athlete needs to move to hit the target on time.
 *
 * The goals module's `requiredRate` assumes bigger is better, which is right
 * for a weight and wrong for a 5K time: a runner who is behind needs to *drop*
 * seconds per week, and the sign-agnostic number below is the one that can be
 * printed in a sentence. Same arithmetic, both directions.
 */
export function roadmapRate(goal: RoadmapGoalRow, today: string): string {
  const target = numeric(goal.target_value);
  const deadline = asIsoDate(goal.deadline);
  if (target == null || !deadline) return "—";
  const current = numeric(goal.current_value) ?? 0;
  const daysLeft = daysBetween(today, deadline);
  if (daysLeft == null || daysLeft <= 0) return "—";
  const remaining = Math.abs(target - current);
  if (remaining === 0) return "—";
  const perWeek = (remaining / daysLeft) * 7;
  const rounded = perWeek >= 10 ? perWeek.toFixed(1) : perWeek.toFixed(2);
  const unit = str(goal.metric_unit);
  return `${rounded}${unit ? ` ${unit}` : ""}/wk`;
}

export function targetText(goal: RoadmapGoalRow): string {
  const target = numeric(goal.target_value);
  const unit = str(goal.metric_unit);
  if (target == null) return goal.title;
  const value = String(target);
  return unit ? `${value} ${unit}` : value;
}

/** Build roadmaps for a list of goals, preserving the input order. */
export function buildRoadmaps(
  goals: readonly RoadmapGoalRow[],
  context: RoadmapContext = {},
): GoalRoadmap[] {
  return goals.map((g) => buildGoalRoadmap(g, context));
}

// ---------------------------------------------------------------------------
// Writing it back
// ---------------------------------------------------------------------------

export interface RoadmapPatch {
  phase: DevelopmentPhase;
  development_areas: string[];
  milestones: RoadmapMilestone[];
  progress_status: RoadmapProgressStatus;
  roadmap_updated_at: string;
}

const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

const sameMilestones = (a: readonly RoadmapMilestone[], b: readonly RoadmapMilestone[]): boolean =>
  a.length === b.length &&
  a.every((m, i) => m.id === b[i].id && m.title === b[i].title && m.status === b[i].status && m.targetDate === b[i].targetDate);

/**
 * The columns to persist for a roadmap, or null when nothing has changed.
 *
 * Persisting matters for two reasons: the guardian overview reads `phase`,
 * `progress_status` and `milestones` from the row rather than rebuilding them
 * server-side, and a roadmap nobody has to recompute is a roadmap that survives
 * an offline session. Returning null when the derived values match what is
 * already stored is what keeps that from being a write on every render.
 */
export function roadmapPatch(
  roadmap: GoalRoadmap,
  stored: RoadmapGoalRow,
  now: string = new Date().toISOString(),
): RoadmapPatch | null {
  const storedAreas = parseDevelopmentAreas(stored.development_areas);
  const storedMilestones = parseStoredMilestones(stored.milestones);
  const storedStatus = ROADMAP_PROGRESS_STATUSES.includes(stored.progress_status as RoadmapProgressStatus)
    ? (stored.progress_status as RoadmapProgressStatus)
    : null;

  const unchanged =
    stored.phase === roadmap.phase &&
    sameList(storedAreas, roadmap.developmentAreas) &&
    sameMilestones(storedMilestones, roadmap.milestones) &&
    storedStatus === roadmap.progress.status;

  if (unchanged) return null;

  return {
    phase: roadmap.phase,
    development_areas: roadmap.developmentAreas,
    milestones: roadmap.milestones,
    progress_status: roadmap.progress.status,
    roadmap_updated_at: now,
  };
}
