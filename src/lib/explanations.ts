// ============================================================================
// EXPLANATIONS — one structured "why" for every recommendation Vaylo makes
// ----------------------------------------------------------------------------
// Phases 1–5 each learned to justify themselves in their own module: the
// availability allocator returns a sentence, the recovery rules return
// `evidence[]` with a source, the rebuild returns a paragraph, the roadmap
// returns `influences[]`. Every one of those strings is grounded in the
// athlete's own record, and every one of them was rendered by hand — or, on
// four of the five surfaces that show a recommendation, not rendered at all.
//
// The consequence was readable in the product: `WeeklySummary` told an athlete
// to "Block two non-negotiable training windows this week" with no visible
// reason, and `MetricsHub` showed a bare "Injury risk: HIGH". A recommendation
// with no reason is an instruction; the specification for this phase is that it
// should be an argument the athlete can check.
//
// So this module is the single shape every recommendation is rendered from:
//
//     recommendation   → `headline`
//     why              → `why[]`      (2–5 bullets, each with its source)
//     what this means  → `rationale`
//
// It builds nothing new about training. Each adapter below COMPOSES the engine
// that already decided — `recoveryAdjust`, `adaptivePlan`, `lifeEvents`,
// `sessionLoad`, `roadmap` — so a screen cannot explain a decision differently
// from how the decision was made. Pure: no I/O, no clock reads, no React.
//
// Three rules are enforced here rather than trusted to each caller:
//
//   1. NO INVENTED DATA. Every bullet is a string an engine produced from rows
//      the athlete owns, or a number the app computed from their sessions.
//      There is no code path from here to a sentence about training that nobody
//      logged.
//   2. NO MEDICAL CERTAINTY. `findMedicalCertainty` scans the copy this module
//      can emit, and the test suite runs every adapter over a matrix of inputs
//      through it. The product is a sports-performance tool: it may say "your
//      load is well above the four weeks before it", never "you have a 37%
//      injury risk", and never a diagnosis.
//   3. SAY SO WHEN THE DATA IS THIN. `insufficient` is a first-class result.
//      A change recommended on one bullet is marked low-confidence, and a
//      session the rules declined to touch carries the specification's own
//      sentence rather than a confident default.
// ============================================================================

import {
  NOT_ENOUGH_INFORMATION,
  type AdjustmentDecision,
  type Evidence,
  type WeekDecision,
} from "./recoveryAdjust";
import { weekNote, type BreakFacts, type ProgressionStep, type ReturnFocus } from "./adaptivePlan";
import type { AvailabilityAssessment, LifeEvent, SessionAdjustment } from "./lifeEvents";
import { formatDay, formatPeriod } from "./lifeEvents";
import { PROGRESS_LABELS, type RoadmapProgressStatus } from "./roadmap";

// ---------------------------------------------------------------------------
// The shape
// ---------------------------------------------------------------------------

export type ExplanationTone = "positive" | "info" | "watch" | "safety";

/** How much the recommendation trusts itself. `none` means it declined to call. */
export type ExplanationConfidence = "high" | "medium" | "low" | "none";

export type ExplanationKind =
  /** One session — today's, or a specific day under review. */
  | "session"
  /** The week as a whole. */
  | "week"
  /** The plan was changed because of availability. */
  | "plan_change"
  /** Coming back from a break. */
  | "return"
  /** Goal or competition proximity. */
  | "goal"
  /** Analytics: how consistently training is happening. */
  | "consistency"
  /** Analytics: whether recent workload is appropriate. */
  | "workload";

/**
 * Which of the athlete's own records a reason came from.
 *
 * The first five are `recoveryAdjust`'s own provenance type, reused rather than
 * re-declared so a rule cannot label its evidence one way and be displayed
 * another. The rest name the records the analytics layer reads.
 */
export type ReasonSource =
  | Evidence["source"]
  | "goal"
  | "history"
  | "import";

export interface ExplanationReason {
  /** The athlete-facing sentence. Cites real numbers only. */
  text: string;
  /** Where it came from, for the secondary line under the bullet. */
  source: ReasonSource;
}

export interface RecommendationExplanation {
  /** Stable id, for list keys and for tests. */
  id: string;
  kind: ExplanationKind;
  /** The recommendation, in one line. */
  headline: string;
  /** 2–5 bullets. Fewer only when the record genuinely holds fewer. */
  why: ExplanationReason[];
  /** "What this means" — the consequence, not a restatement. */
  rationale: string;
  tone: ExplanationTone;
  confidence: ExplanationConfidence;
  /** True when the app declined to make a confident call. */
  insufficient: boolean;
  /** Bullets dropped to stay inside `MAX_WHY`. Reported, never silently lost. */
  omitted: number;
  /** `headline` plus the first reason — for a collapsed row or a banner. */
  summary: string;
}

/**
 * The ceiling on bullets.
 *
 * The specification asks for 2–5. Five is a ceiling because a screen that lists
 * nine reasons has stopped explaining and started defending itself, and the
 * reader takes the first two anyway. What is dropped is counted, so the UI can
 * say "+3 more" instead of pretending the list was complete.
 */
export const MAX_WHY = 5;

/**
 * How many bullets a confident *change* needs.
 *
 * A recommendation to train differently, resting on one fact, is a guess with a
 * citation. This is not a reason to withhold it — the athlete is better served
 * by a cautious suggestion than by silence — so it is a reason to label it.
 */
export const MIN_WHY_FOR_CONFIDENCE = 2;

/** Re-exported so a caller can render the specification's sentence verbatim. */
export const INSUFFICIENT_SENTENCE = NOT_ENOUGH_INFORMATION;

/** What to check that would change an answer, said once. */
export const WHAT_WOULD_HELP =
  "A recovery check-in and a few logged sessions are all it takes.";

const SOURCE_LABELS: Record<ReasonSource, string> = {
  recovery: "your recovery check-ins",
  load: "your logged sessions",
  plan: "your plan",
  calendar: "your availability",
  break: "your break",
  goal: "your goal",
  history: "your training history",
  import: "your imported training",
};

/** Human name for where a reason came from — the "based on" line. */
export const reasonSourceLabel = (source: ReasonSource): string =>
  SOURCE_LABELS[source] ?? "your training record";

const CONFIDENCE_LABELS: Record<ExplanationConfidence, string> = {
  high: "Well supported",
  medium: "Supported",
  low: "Thin evidence",
  none: "Not enough information",
};

export const confidenceLabel = (confidence: ExplanationConfidence): string =>
  CONFIDENCE_LABELS[confidence] ?? "Supported";

// ---------------------------------------------------------------------------
// Medical certainty — the line this product does not cross
// ---------------------------------------------------------------------------

/**
 * Phrases that assert a medical outcome.
 *
 * `% risk`, `chance of`, `diagnose`, `overtraining syndrome` and any claim to
 * predict injury. `recoveryAdjust` states the same rule in its own header; this
 * is the enforceable version, and `explanations.test.ts` runs every string the
 * adapters can produce through it.
 */
export const MEDICAL_CERTAINTY_PHRASES: readonly RegExp[] = [
  /injury risk/i,
  /risk of injury/i,
  /chance of injury/i,
  /\d+\s*%\s*(?:chance|risk|likely)/i,
  /diagnos/i,
  /overtraining syndrome/i,
  /you (?:are|will be) injured/i,
  /predispos/i,
];

/** Every medical-certainty phrase in `text`, for tests and for review. */
export function findMedicalCertainty(text: string): string[] {
  return MEDICAL_CERTAINTY_PHRASES.filter((re) => re.test(text)).map((re) => String(re));
}

// ---------------------------------------------------------------------------
// The builder — every adapter goes through this, so the invariants hold once
// ---------------------------------------------------------------------------

interface BuildInput {
  id: string;
  kind: ExplanationKind;
  headline: string;
  why: readonly ExplanationReason[];
  rationale: string;
  tone: ExplanationTone;
  /** Set for the cases where the app declined to call it. */
  insufficient?: boolean;
  /**
   * True for prose, not bullets: the sentence the rules already assembled is
   * used as the only "reason" so a caller that wants the paragraph keeps it.
   */
  confidenceOverride?: ExplanationConfidence;
}

function confidenceFor(
  why: readonly ExplanationReason[],
  tone: ExplanationTone,
  insufficient: boolean,
): ExplanationConfidence {
  if (insufficient) return "none";
  // A hard constraint is a fact about the athlete's life, not an inference, and
  // it needs no support to be right.
  if (tone === "safety") return "high";
  if (why.length >= 3) return "high";
  if (why.length >= MIN_WHY_FOR_CONFIDENCE) return "medium";
  return "low";
}

/**
 * Builds the final object, trimming to `MAX_WHY` and counting the remainder.
 *
 * Duplicate bullet text is collapsed first. Two engines can legitimately reach
 * the same conclusion — the recovery read and the availability allocator both
 * notice a holiday — and showing the athlete the same sentence twice reads as
 * a glitch rather than as emphasis.
 */
export function buildExplanation(input: BuildInput): RecommendationExplanation {
  const seen = new Set<string>();
  const unique: ExplanationReason[] = [];
  for (const reason of input.why) {
    const key = reason.text.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(reason);
  }
  const kept = unique.slice(0, MAX_WHY);
  const omitted = Math.max(0, unique.length - kept.length);
  const insufficient = input.insufficient ?? false;
  const confidence =
    input.confidenceOverride ?? confidenceFor(kept, input.tone, insufficient);

  return {
    id: input.id,
    kind: input.kind,
    headline: input.headline,
    why: kept,
    rationale: input.rationale,
    tone: input.tone,
    confidence,
    insufficient,
    omitted,
    summary: kept.length ? `${input.headline} ${kept[0].text}` : input.headline,
  };
}

/**
 * A reason for a recommendation that no engine attached evidence to.
 *
 * Deliberately a statement about the RECORD rather than about the athlete's
 * body: "nothing you have logged argues for a change" cannot be wrong when it
 * is shown, and it is the honest inverse of a recommendation to leave things
 * alone.
 */
const NO_OBJECTION: ExplanationReason = {
  text: "Nothing you have logged argues for changing this.",
  source: "history",
};

/** The tone an action should be presented in. */
function toneForAction(action: AdjustmentDecision["action"]): ExplanationTone {
  switch (action) {
    case "blocked":
      return "safety";
    case "reduce":
    case "swap":
    case "move":
      return "watch";
    case "recover":
      return "info";
    case "proceed":
    case "preserve":
      return "positive";
    default:
      return "info";
  }
}

/** What each kind of recommendation means, in one sentence the athlete keeps. */
export const EXPLANATION_RATIONALE: Record<ExplanationKind, string> = {
  session:
    "This is a suggestion from what you have logged. Your plan stays exactly what you approved until you change it.",
  week:
    "Spreading the reduction across the sessions that can take it keeps the week useful, rather than telling you to do less everywhere.",
  plan_change:
    "We rebuilt around the sessions that matter instead of trying to make up everything you missed. That is why nothing was moved into next week.",
  return:
    "Coming back gradually is what makes the return stick. This is the standard rebuild, not a comment on your fitness.",
  goal:
    "Basing the week around the session that matters most is the cheapest way to protect the thing you are training for.",
  consistency:
    "Regular training is the input you control. Weekly volume matters less than whether the weeks keep happening.",
  workload:
    "The point of a rising load is that it is followed by an easier week. If the recent weeks already look heavy, the easier week is now.",
};

// ---------------------------------------------------------------------------
// Adapter: one session, from the Phase 3 recovery rules
// ---------------------------------------------------------------------------

/**
 * The "why" for a single session decision.
 *
 * The decision object already carries the recommendation, the evidence and the
 * uncertainty sentence; this only gives them the standard shape, so the
 * Training screen's "Why" list and the analytics screen's recommendation are
 * the same words.
 */
export function explainDecision(decision: AdjustmentDecision): RecommendationExplanation {
  const why: ExplanationReason[] = decision.evidence.map((e) => ({
    text: e.text,
    source: e.source,
  }));

  if (decision.action === "insufficient") {
    return buildExplanation({
      id: `session:${decision.date}`,
      kind: "session",
      headline: decision.headline,
      why: [],
      rationale: decision.uncertainty ?? INSUFFICIENT_SENTENCE,
      tone: "info",
      insufficient: true,
    });
  }

  if (decision.action === "blocked") {
    return buildExplanation({
      id: `session:${decision.date}`,
      kind: "session",
      headline: decision.headline,
      why,
      rationale: decision.blockedBy
        ? `${decision.blockedBy} takes priority here, so this is not a judgement about your readiness.`
        : EXPLANATION_RATIONALE.session,
      tone: "safety",
    });
  }

  return buildExplanation({
    id: `session:${decision.date}`,
    kind: "session",
    headline: decision.headline,
    why: why.length ? why : [NO_OBJECTION],
    rationale: EXPLANATION_RATIONALE.session,
    tone: toneForAction(decision.action),
  });
}

// ---------------------------------------------------------------------------
// Adapter: the week, from the Phase 3 week decision
// ---------------------------------------------------------------------------

/**
 * The "why" for the week-level reduction.
 *
 * Assembled from the same decisions `decideForWeek` averaged, so the number in
 * the headline and the bullets under it cannot disagree. The paragraphs the
 * rules also produce (`WeekDecision.explanation`) stay available for callers
 * that want prose; this is the structured form of the same thing.
 */
export function explainWeek(week: WeekDecision): RecommendationExplanation | null {
  if (week.volumeReductionPct === null) {
    if (!week.uncertainty) return null;
    return buildExplanation({
      id: "week:reduce",
      kind: "week",
      headline: "This week is left exactly as planned.",
      why: [],
      rationale: week.uncertainty,
      tone: "info",
      insufficient: true,
    });
  }

  const changed = week.decisions.filter(
    (d) => d.action === "reduce" || d.action === "swap" || d.action === "move" || d.action === "recover",
  );
  const why: ExplanationReason[] = changed.flatMap((d) =>
    d.evidence.map((e) => ({ text: e.text, source: e.source })),
  );
  why.push({
    text:
      changed.length === 1
        ? "One session is affected; the rest of your week is unchanged."
        : `${changed.length} sessions are affected; nothing has been moved to another day.`,
    source: "plan",
  });

  return buildExplanation({
    id: "week:reduce",
    kind: "week",
    headline: `Consider reducing this week's volume by about ${week.volumeReductionPct}%.`,
    why,
    rationale: EXPLANATION_RATIONALE.week,
    tone: "watch",
  });
}

// ---------------------------------------------------------------------------
// Adapter: the plan changed because of availability (Phase 1)
// ---------------------------------------------------------------------------

/**
 * The "why" for a plan adjustment caused by a life event.
 *
 * `assessAvailability` already returns the sentence and the list of cancelled
 * sessions, including which of them were key sessions. The reason for the
 * change is the athlete's own event, named with its dates — this does not
 * speculate about what the break will cost them, because that number does not
 * exist.
 */
export function explainAvailability(
  event: LifeEvent,
  assessment: AvailabilityAssessment,
): RecommendationExplanation | null {
  const cancelled = assessment.cancelled.length;
  const optionalWindow = assessment.adjustments.some((a) => a.reason === "optional_window");
  if (cancelled === 0 && !optionalWindow) return null;

  const range =
    event.start_date === event.end_date
      ? `on ${formatDay(event.start_date)}`
      : `from ${formatPeriod(event.start_date, event.end_date)}`;
  const span = assessment.adjustments.length;

  const why: ExplanationReason[] = [
    {
      text: `You added ${event.event_type === "holiday" ? "a holiday" : "an availability window"} ${range}.`,
      source: "calendar",
    },
  ];
  if (cancelled > 0) {
    why.push({
      text:
        cancelled === 1
          ? `1 session in those dates was cancelled rather than missed.`
          : `${cancelled} sessions in those dates were cancelled rather than missed.`,
      source: "plan",
    });
  }
  if (assessment.lostKeySessions.length > 0) {
    const titles = assessment.lostKeySessions.map((s: SessionAdjustment) => s.title).slice(0, 3);
    why.push({
      text:
        assessment.lostKeySessions.length === 1
          ? `The session that carried your key work was one of them (${titles[0]}).`
          : `${assessment.lostKeySessions.length} of them carried key work (${titles.join(", ")}).`,
      source: "plan",
    });
  }
  if (optionalWindow && cancelled === 0) {
    why.push({
      text: "Training was marked optional, so nothing was removed and nothing counts against you.",
      source: "calendar",
    });
  }
  if (span > 0) {
    why.push({
      text: `Your plan held ${span} session${span === 1 ? "" : "s"} across those dates.`,
      source: "plan",
    });
  }

  const headline =
    cancelled === 0
      ? "Your plan is unchanged for those dates."
      : assessment.explanation ??
        `Your plan was adjusted because of ${event.event_type} ${range}.`;

  return buildExplanation({
    id: `availability:${event.id}`,
    kind: "plan_change",
    headline,
    why,
    rationale: EXPLANATION_RATIONALE.plan_change,
    tone: cancelled > 0 ? "watch" : "info",
  });
}

// ---------------------------------------------------------------------------
// Adapter: coming back from a break (Phase 2)
// ---------------------------------------------------------------------------

/** What each week back is for, in the athlete's words rather than the rules'. */
const FOCUS_LABELS: Record<ReturnFocus, string> = {
  rebuild: "rebuilding your base",
  restore: "restoring your usual load",
  resume: "getting back to full training",
  compete: "staying fresh for competition",
  // A planned break reshapes the weeks AROUND it too, so the same progression
  // record can carry a week that is not a return week at all. Both are named
  // here rather than left to a default, because the sentence is read by the
  // athlete and "rebuilding your base" over a holiday week would be wrong.
  preload: "banking a little extra before your break",
  holiday: "easy movement while you are away",
  paused: "no training while you are away",
};

export interface RebuildExplanationInput {
  facts: BreakFacts;
  /** The whole progression, so "Week 2 of 3" is a real fraction. */
  steps: readonly ProgressionStep[];
  /** Which week back the athlete is in now, 1-based. */
  weekBack: number;
  creditedDays: number;
  youth: boolean;
  medical: boolean;
  competingSoon: boolean;
}

/**
 * The "why" for a return-from-break progression.
 *
 * The specification's example is the headline: "Week 1 of 3 — focus on
 * rebuilding base". The bullets are the break itself, how much of it was
 * already credited because the athlete kept training, and the two situations
 * that change the advice — a competition in the window and a break recorded as
 * illness or injury.
 *
 * `medical` and `youth` are the reason this returns a `safety` tone and why the
 * rationale carries the "not a treatment plan" line: those two cases are where
 * a training app is most likely to be mistaken for medical advice.
 */
export function explainRebuild(input: RebuildExplanationInput): RecommendationExplanation {
  const { facts, steps, weekBack, creditedDays: credited, youth, medical, competingSoon } = input;
  const total = Math.max(1, steps.length);
  const back = Math.max(1, Math.min(weekBack, total));
  const step = steps[back - 1] ?? steps[steps.length - 1];
  const noun =
    facts.eventType === "illness" || facts.eventType === "injury"
      ? facts.eventType === "illness"
        ? "illness"
        : "an injury"
      : facts.eventType === "holiday"
        ? "a holiday"
        : "a break";
  const range =
    facts.startDate === facts.endDate
      ? `on ${formatDay(facts.startDate)}`
      : `from ${formatDay(facts.startDate)} to ${formatDay(facts.endDate)}`;

  const why: ExplanationReason[] = [
    {
      text: `You were away for ${facts.days} day${facts.days === 1 ? "" : "s"} ${range} (${noun}).`,
      source: "break",
    },
  ];
  if (step) {
    why.push({
      text: `This week is programmed at about ${step.volumePct}% of your usual volume, with intensity capped at ${step.intensityPct}%.`,
      source: "plan",
    });
  }
  if (credited >= 1) {
    why.push({
      text: `You kept training during ${Math.floor(credited)} of those days, so they are already accounted for.`,
      source: "history",
    });
  }
  if (competingSoon) {
    why.push({
      text: "You have a competition in this window, so the week around it stays light.",
      source: "calendar",
    });
  }
  if (youth) {
    why.push({
      text: "You are still developing, so this rebuild is deliberately gentle.",
      source: "plan",
    });
  }

  const detailed = step ? weekNote(step) : "";
  const rationale = [
    EXPLANATION_RATIONALE.return,
    medical
      ? "This is a conservative rebuild, not a treatment plan. Follow your doctor's or physiotherapist's guidance, and stop if something hurts."
      : null,
    youth
      ? "Staying healthy matters more than getting back to full training quickly."
      : null,
  ]
    .filter(Boolean)
    .join(" ");

  void detailed; // the sentence stays on the Training screen; the bullets are its parts

  return buildExplanation({
    id: `return:${facts.eventId}:${back}`,
    kind: "return",
    headline: `Return-from-break progression: Week ${back} of ${total} — ${FOCUS_LABELS[step?.focus ?? "rebuild"]}.`,
    why,
    rationale,
    tone: medical ? "safety" : "info",
  });
}

// ---------------------------------------------------------------------------
// Adapter: goal and competition proximity (Phase 4)
// ---------------------------------------------------------------------------

export interface GoalProximityInput {
  goalTitle: string;
  /** Days until the target date. Null when the goal has no date. */
  daysRemaining: number | null;
  /** The existing goal percentage, for context. */
  percent: number;
  status: RoadmapProgressStatus;
  /** The next milestone, when the roadmap has one. */
  nextMilestone?: { title: string; targetDate: string | null } | null;
  /** Milestones already reached, for the "3 of 5" line. */
  achievedMilestones?: number;
  totalMilestones?: number;
  /** The nearest competition, when one is within the key-session window. */
  competition?: { title: string; days: number } | null;
  /** How many days ahead counts as "key". */
  keyWindowDays?: number;
}

/** Inside this many days, a competition is what the week is organised around. */
export const KEY_SESSION_WINDOW_DAYS = 7;

/**
 * The "why" for a recommendation driven by what the athlete is training for.
 *
 * Returns null when there is nothing to say — no deadline, no milestone and no
 * competition — because "your goal is important" is not information, and a
 * screen that says it every day teaches the athlete to skip the section.
 */
export function explainGoalProximity(
  input: GoalProximityInput,
): RecommendationExplanation | null {
  const window = input.keyWindowDays ?? KEY_SESSION_WINDOW_DAYS;
  const competitionSoon = input.competition != null && input.competition.days >= 0 && input.competition.days <= window;
  const goalSoon = input.daysRemaining != null && input.daysRemaining >= 0 && input.daysRemaining <= window;

  if (!competitionSoon && !goalSoon && !input.nextMilestone) return null;

  const why: ExplanationReason[] = [];
  if (competitionSoon && input.competition) {
    why.push({
      text:
        input.competition.days === 0
          ? `${input.competition.title} is today.`
          : `${input.competition.title} is in ${input.competition.days} day${input.competition.days === 1 ? "" : "s"}.`,
      source: "calendar",
    });
  }
  if (input.daysRemaining != null) {
    why.push({
      text:
        input.daysRemaining === 0
          ? `${input.goalTitle} is due today.`
          : `${input.goalTitle} is ${input.daysRemaining} day${input.daysRemaining === 1 ? "" : "s"} away, and you are ${input.percent}% of the way there.`,
      source: "goal",
    });
  }
  if (input.totalMilestones && input.totalMilestones > 0) {
    why.push({
      text: `${input.achievedMilestones ?? 0} of ${input.totalMilestones} milestones reached.`,
      source: "goal",
    });
  }
  if (input.nextMilestone) {
    why.push({
      text: input.nextMilestone.targetDate
        ? `Next milestone: ${input.nextMilestone.title} (${formatDay(input.nextMilestone.targetDate)}).`
        : `Next milestone: ${input.nextMilestone.title}.`,
      source: "goal",
    });
  }
  why.push({
    text: `Your roadmap for this goal is ${PROGRESS_LABELS[input.status]?.toLowerCase() ?? "unmeasured"}.`,
    source: "goal",
  });

  const headline = competitionSoon
    ? "Key session coming up — the week is organised around it."
    : goalSoon
      ? "The target date is close — the week is organised around it."
      : "Your next milestone is the thing to aim at right now.";

  return buildExplanation({
    id: "goal:proximity",
    kind: "goal",
    headline,
    why,
    rationale: EXPLANATION_RATIONALE.goal,
    tone: "info",
  });
}

// ---------------------------------------------------------------------------
// Adapters for the analytics layer
// ---------------------------------------------------------------------------

export interface WorkloadExplanationInput {
  recentDays: number;
  recentLoad: number;
  recentSessions: number;
  /** Load in the window before it. Null when the record does not reach back. */
  priorLoad: number | null;
  /** Recent load ÷ prior load, day-count-normalised. Null when incomparable. */
  ratio: number | null;
  band: "high" | "steady" | "low" | "unknown";
  /** True when a rebuild is already in force, so light weeks are expected. */
  inReturnProgression?: boolean;
  /** True when the athlete is still developing — gentler framing. */
  youth?: boolean;
}

/**
 * The "why" for "your recent workload is appropriate / elevated / light".
 *
 * Refuses to be confident from one week of data: with no comparable prior
 * window the result is `insufficient`, and the athlete is told what the app
 * cannot see rather than given a verdict on a number that has nothing to be
 * compared against.
 */
export function explainWorkload(input: WorkloadExplanationInput): RecommendationExplanation {
  if (input.ratio === null || input.priorLoad === null) {
    return buildExplanation({
      id: "workload",
      kind: "workload",
      headline: "Not enough history to judge your workload yet.",
      why: [
        {
          text: `You have logged ${input.recentSessions} session${input.recentSessions === 1 ? "" : "s"} in the last ${input.recentDays} days, carrying ${input.recentLoad} load.`,
          source: "load",
        },
        {
          text: "There is no earlier period in your record to compare that with.",
          source: "history",
        },
      ],
      rationale:
        "A workload only means something next to the weeks before it. Keep logging and this will have an answer.",
      tone: "info",
      insufficient: true,
    });
  }

  const percent = Math.round(Math.abs(input.ratio - 1) * 100);
  const why: ExplanationReason[] = [
    {
      text: `The last ${input.recentDays} days carry ${input.recentLoad} load across ${input.recentSessions} session${input.recentSessions === 1 ? "" : "s"}.`,
      source: "load",
    },
    {
      text: `The ${input.recentDays} days before that carried ${input.priorLoad}.`,
      source: "load",
    },
  ];

  let headline: string;
  let tone: ExplanationTone = "positive";
  if (input.band === "high") {
    headline = `Your recent workload is about ${percent}% higher than the weeks before it.`;
    tone = "watch";
    why.push({
      text: input.inReturnProgression
        ? "You are already rebuilding after a break, so some of this is expected."
        : "Nothing in your plan accounts for a jump of that size.",
      source: "plan",
    });
  } else if (input.band === "low") {
    headline = `Your recent workload is about ${percent}% lower than the weeks before it.`;
    why.push({
      text: input.inReturnProgression
        ? "You are rebuilding after a break, so this is the plan working rather than a drop."
        : "A week like this is worth noticing only if it turns into several.",
      source: "plan",
    });
  } else {
    headline = "Your recent workload is close to the weeks before it.";
    why.push({
      text: "A steady recent load is what makes a hard week safe to prescribe.",
      source: "plan",
    });
  }

  if (input.youth) {
    why.push({
      text: "You are still developing, so steady beats spiky — big changes week to week are the thing to avoid.",
      source: "plan",
    });
  }

  return buildExplanation({
    id: "workload",
    kind: "workload",
    headline,
    why,
    rationale: EXPLANATION_RATIONALE.workload,
    tone,
  });
}

export interface ConsistencyExplanationInput {
  /** Sessions inside planned sessions the athlete was available for. */
  completed: number;
  planned: number;
  percent: number;
  targetPerWeek: number;
  weeksConsidered: number;
  weeksMeetingTarget: number;
  /** Sessions the athlete was away for, excluded from the denominator. */
  excusedByBreak?: number;
  youth?: boolean;
}

/**
 * The "why" for the consistency number.
 *
 * The denominator excludes anything a recorded break removed, the same rule
 * `countsTowardCompletion` enforces: an athlete who was on holiday did not miss
 * those sessions, and reporting them as misses is the mistake this product
 * already fixed once.
 */
export function explainConsistency(
  input: ConsistencyExplanationInput,
): RecommendationExplanation {
  if (input.planned === 0) {
    return buildExplanation({
      id: "consistency",
      kind: "consistency",
      headline: "No planned sessions in this window to measure against.",
      why: [
        {
          text: "Consistency is measured against your plan, and there is nothing scheduled in the last four weeks.",
          source: "plan",
        },
      ],
      rationale:
        "Log training or build a plan and this becomes a real number rather than a percentage of nothing.",
      tone: "info",
      insufficient: true,
    });
  }

  const why: ExplanationReason[] = [
    {
      text: `You completed ${input.completed} of ${input.planned} planned sessions in the last ${input.weeksConsidered} weeks.`,
      source: "plan",
    },
    {
      text: `You hit ${input.targetPerWeek} or more sessions in ${input.weeksMeetingTarget} of those ${input.weeksConsidered} weeks.`,
      source: "history",
    },
  ];
  if (input.excusedByBreak && input.excusedByBreak > 0) {
    why.push({
      text: `${input.excusedByBreak} session${input.excusedByBreak === 1 ? "" : "s"} were removed by a break you recorded, so they are not counted either way.`,
      source: "calendar",
    });
  }

  const headline =
    input.percent >= 85
      ? `You completed ${input.percent}% of planned sessions.`
      : input.percent >= 60
        ? `You completed ${input.percent}% of planned sessions — the rhythm is mostly there.`
        : `You completed ${input.percent}% of planned sessions.`;

  const rationale = input.youth
    ? "Showing up regularly is the whole skill at your age. Volume can wait; a consistent month cannot."
    : EXPLANATION_RATIONALE.consistency;

  return buildExplanation({
    id: "consistency",
    kind: "consistency",
    headline,
    why,
    rationale,
    tone: input.percent >= 85 ? "positive" : "watch",
  });
}

// ---------------------------------------------------------------------------
// Ordering, for screens that show several recommendations at once
// ---------------------------------------------------------------------------

const TONE_WEIGHT: Record<ExplanationTone, number> = {
  safety: 0,
  watch: 1,
  info: 2,
  positive: 3,
};

/**
 * Most-actionable first.
 *
 * A hard constraint outranks a suggestion, a suggestion outranks context, and
 * something working outranks nothing. Sorting is stable, so two recommendations
 * of equal weight keep the order the caller assembled them in.
 */
export function sortExplanations(
  explanations: readonly RecommendationExplanation[],
): RecommendationExplanation[] {
  return [...explanations].sort((a, b) => TONE_WEIGHT[a.tone] - TONE_WEIGHT[b.tone]);
}

/** True when there is nothing for the athlete to read. */
export const hasAnythingToSay = (
  explanations: readonly RecommendationExplanation[],
): boolean => explanations.some((e) => e.why.length > 0 || e.insufficient);
