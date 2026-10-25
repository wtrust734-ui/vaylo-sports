// ============================================================================
// INJURY REHAB PLAN — the mobility plan that actually gets created
// ----------------------------------------------------------------------------
// Creating an injury plan used to mean a provider call that could fail, be
// refused for credits, or return an answer the parser could not read — and
// when it failed the athlete was left with the free generic scaffold and no
// way to get a plan. This module builds the plan on the device instead:
// deterministic, instant, offline, and free, so the button always produces
// something the athlete can start today.
//
// What it is NOT: a training plan. The training plan is the sessions in
// Train → Training. This is the mobility/rehab work that runs alongside it —
// range, activation and gentle strength for the injured area, with a pain rule
// on every item and the training week explicitly worked around.
//
// Safety is structural, not decorative:
//   * a report that carries serious signals (severity 8+, inability to bear
//     weight, numbness, a pop at onset, night pain, fever …) gets NO plan from
//     this builder — the caller points the athlete at a clinician instead,
//     which is the same gate `hasSeriousSymptomSignals` already applies,
//   * every item carries what has to be pain-free before it is done,
//   * no diagnosis, no tissue names, no timeline to recovery,
//   * the red flags and the "have a professional supervise this" line are
//     always part of the stored text.
// ============================================================================

import {
  genericScaffoldFor,
  hasSeriousSymptomSignals,
  type InjuryPlan,
  type InjuryPlanItem,
  type InjuryPlanWeek,
} from "./injuryPlan";

type Movement = {
  /** The drill, in plain words. */
  name: string;
  /** How the dose is expressed. */
  kind: "reps" | "hold" | "time";
};

type SiteProgram = {
  mobility: Movement;
  activation: Movement;
  strength: Movement;
  /** The sport-specific pattern that comes back last. */
  sport: string;
};

/**
 * Seven well-known body areas plus a general fallback. Every drill here is a
 * common rehab/mobility movement, not a prescription for a specific diagnosis —
 * the plan is a scaffold for a qualified professional to supervise, which the
 * stored text says in its first line.
 */
const PROGRAMS: Record<string, SiteProgram> = {
  Knee: {
    mobility: { name: "Heel slides", kind: "reps" },
    activation: { name: "Quad set, then a straight-leg raise", kind: "reps" },
    strength: { name: "Sit-to-stand to a pain-free depth", kind: "reps" },
    sport: "Easy jogging or stationary bike",
  },
  Hamstring: {
    mobility: { name: "Gentle supine hamstring slides (no aggressive stretching)", kind: "reps" },
    activation: { name: "Glute bridge", kind: "reps" },
    strength: { name: "Single-leg bridge, then a light Romanian deadlift", kind: "reps" },
    sport: "Build-up running speed",
  },
  Calf: {
    mobility: { name: "Knee-to-wall ankle dorsiflexion", kind: "reps" },
    activation: { name: "Double-leg heel raise", kind: "reps" },
    strength: { name: "Single-leg heel raise", kind: "reps" },
    sport: "Hopping and skipping",
  },
  Achilles: {
    mobility: { name: "Ankle range to the wall (no forced stretch)", kind: "reps" },
    activation: { name: "Isometric calf hold", kind: "hold" },
    strength: { name: "Heavy-slow heel raise off a step", kind: "reps" },
    sport: "Pogo hops and push-off running",
  },
  "Foot/Ankle": {
    mobility: { name: "Ankle circles and ankle alphabet", kind: "reps" },
    activation: { name: "Single-leg balance", kind: "time" },
    strength: { name: "Calf raise with banded ankle eversion", kind: "reps" },
    sport: "Cutting, hopping and uneven ground",
  },
  Hip: {
    mobility: { name: "90/90 hip rotations", kind: "reps" },
    activation: { name: "Side-lying abduction and clamshell", kind: "reps" },
    strength: { name: "Glute bridge, progressing to a split squat", kind: "reps" },
    sport: "Lunging and sprinting",
  },
  "Lower Back": {
    mobility: { name: "Cat-cow plus an easy walk", kind: "time" },
    activation: { name: "Bird-dog and dead bug", kind: "reps" },
    strength: { name: "Hip hinge with a light load", kind: "reps" },
    sport: "Loaded bending and rotation at speed",
  },
  Shoulder: {
    mobility: { name: "Pendulum swings and wall slides", kind: "reps" },
    activation: { name: "Scapular retraction plus a serratus reach", kind: "reps" },
    strength: { name: "Banded external rotation, then a light incline press", kind: "reps" },
    sport: "Overhead throwing or pressing",
  },
  Elbow: {
    mobility: { name: "Wrist flexion and extension range", kind: "reps" },
    activation: { name: "Isometric grip and wrist hold", kind: "hold" },
    strength: { name: "Eccentric wrist extension, then a light curl", kind: "reps" },
    sport: "Grip-heavy pulling and racket work",
  },
  Wrist: {
    mobility: { name: "Wrist circles and gentle flexion/extension", kind: "reps" },
    activation: { name: "Isometric wrist hold", kind: "hold" },
    strength: { name: "Light dumbbell wrist curls", kind: "reps" },
    sport: "Handstand, pressing and floor contact",
  },
  Other: {
    mobility: { name: "Gentle pain-free range of motion for the area", kind: "reps" },
    activation: { name: "Pain-free isometric hold for the area", kind: "hold" },
    strength: { name: "Light progressive loading of the area", kind: "reps" },
    sport: "The sport movement that first provoked it",
  },
};

/** Week 1 settles, week 2 loads, week 3 returns to sport. */
const DOSE: Record<Movement["kind"], [string, string, string]> = {
  reps: ["2 × 8 slow reps", "2 × 10 slow reps", "3 × 10 slow reps"],
  hold: ["3 × 20 s holds", "3 × 30 s holds", "4 × 30 s holds"],
  time: ["2 × 30 s", "2 × 45 s", "3 × 45 s"],
};

const painRuleFor = (phase: "mobility" | "activation" | "strength"): string => {
  if (phase === "mobility") return "Only through a range that stays pain-free — never push into the sharp end.";
  if (phase === "activation") return "Stop the set if this reproduces the pain; a dull stretch is the limit.";
  return "Next-morning pain must not be worse than before — if it is, repeat last week rather than adding load.";
};

const WEEK_FOCUS = [
  "Settle the area and keep pain-free range",
  "Load it gently without flaring it",
  "Rebuild the sport pattern",
] as const;

const WEEK_PROGRESS = [
  "Day-to-day movement is comfortable and the next morning is no worse than before.",
  "The strength work is pain-free and next-morning pain is not climbing.",
  "The sport-specific movement is pain-free during the session AND the next morning. If it is not, repeat this week.",
] as const;

export type RehabPlanInput = {
  bodyPart: string;
  /** 1–10, as logged. */
  severity: number;
  notes?: string | null;
  sport?: string | null;
  /** The athlete's current training week, so the plan works around it. */
  trainingDaysPerWeek?: number | null;
};

export type RehabPlanResult =
  | { plan: InjuryPlan; reason?: undefined }
  | { plan: null; reason: string };

/**
 * Build a three-week mobility/rehab plan for one injury.
 *
 * Pure and deterministic: the same report produces the same plan, so the
 * athlete can see exactly what their answers changed.
 */
export function buildInjuryRehabPlan(input: RehabPlanInput): RehabPlanResult {
  const severity = Math.max(1, Math.min(10, Math.round(Number(input.severity) || 1)));
  const notes = (input.notes ?? "").trim();

  if (hasSeriousSymptomSignals({ severity, reported: notes })) {
    return {
      plan: null,
      reason:
        "This report needs a clinician before a rehab plan is written — the severity or the symptoms you described are not something an app should programme around. Get it assessed, then log what the clinician says.",
    };
  }

  const program = PROGRAMS[input.bodyPart] ?? PROGRAMS.Other;
  const scaffold = genericScaffoldFor(input.bodyPart);
  const sport = (input.sport ?? "").trim();
  const trainingDays = Math.round(Number(input.trainingDaysPerWeek) || 0);
  const site = input.bodyPart.toLowerCase();

  const trainingLine =
    trainingDays > 0
      ? `Against your ${trainingDays}-day training week: keep those sessions, and put these drills before them or on the days between — never instead of them.`
      : "Keep your training plan's sessions, and put these drills before them or on the days between — never instead of them.";

  const weeks: InjuryPlanWeek[] = [0, 1, 2].map((index) => {
    const items: InjuryPlanItem[] = [
      {
        label: "Every day",
        work: `${program.mobility.name} — ${DOSE[program.mobility.kind][index]}`,
        painRule: painRuleFor("mobility"),
      },
      {
        label: "Before your training session",
        work: `${program.activation.name} — ${DOSE[program.activation.kind][index]} as part of the warm-up`,
        painRule: painRuleFor("activation"),
      },
      {
        label: trainingDays > 0 ? "On your non-training days" : "Strength days",
        work: `${program.strength.name} — ${DOSE[program.strength.kind][index]}`,
        painRule: painRuleFor("strength"),
      },
    ];

    if (index === 2) {
      items.push({
        label: "End of a training day",
        work: `${program.sport}, starting at an easy effort and building only while the pain rules hold`,
        painRule: "Stop the moment the pain rises above 3/10 or changes character; retry after two comfortable days.",
      });
    }

    return {
      week: index + 1,
      focus: WEEK_FOCUS[index],
      items,
      progressWhen: WEEK_PROGRESS[index],
      stopIf: "Pain rises above 3/10 during the drill, sharp pain appears, or the area is worse the next morning.",
    };
  });

  const summaryParts = [
    `A three-week mobility and rehab plan for your ${site}${sport ? `, built around your ${sport} training` : ""}.`,
    trainingLine,
  ];
  if (notes) {
    summaryParts.push(
      `Your note is part of the brief: "${notes.replace(/\s+/g, " ").slice(0, 200)}${notes.length > 200 ? "…" : ""}".`,
    );
  }
  if (severity >= 7) {
    summaryParts.push(
      `At ${severity}/10, keep everything to the pain-free end and have a qualified professional review this before you progress past week 1.`,
    );
  }

  return {
    plan: {
      summary: summaryParts.join(" "),
      weeks,
      redFlags: scaffold?.redFlags ?? [
        "Pain that keeps getting worse rather than settling",
        "Numbness, tingling or weakness spreading from the area",
        "A hot, swollen or visibly deformed site",
        "Fever, or feeling generally unwell with the pain",
      ],
      seeAProfessional:
        "If the pain is worsening, waking you at night, or not improving after two weeks of this plan, see a qualified physiotherapist or doctor before progressing.",
      disclaimer:
        "General mobility scaffold, not medical advice or a diagnosis — have a qualified physiotherapist or doctor supervise it, especially before returning to sport.",
    },
  };
}
