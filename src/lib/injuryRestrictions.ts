// ============================================================================
// INJURY RESTRICTIONS — what a recorded injury says about an existing plan
// ----------------------------------------------------------------------------
// Injuries are recorded on /injury and feed two other things:
//
//   * plan CREATION — `generate-plan` receives active injuries in the dossier
//     and is instructed to avoid movements that aggravate them (see
//     `supabase/functions/_shared/athleteDossier.ts`), and
//   * plan DISPLAY — this module. A plan written BEFORE an injury existed has
//     sessions the athlete can no longer do, and nothing flagged them: the
//     screen rendered "Heavy Back Squat" exactly as the generator wrote it.
//
// What lives here is the conservative, explicit mapping from a recorded injury
// to what an already-written session is for the athlete reading it today. It is
// deliberately narrow:
//
//   * restrictions come from what the athlete REPORTED (site, severity, area),
//     never from a guess about what a knee injury "usually" means;
//   * the recoverable categories are the ones where a conservative rule is
//     genuinely safe — lower-limb site, training day, moderate severity — and
//     everything else is flagged, not transformed;
//   * every transform is visible in the UI as a REVIEWCHIP with the reason; the
//     athlete is told the session was adapted and why, never silently re-titled;
//   * a flagged-not-adapted session is an instruction to check with a
//     professional, not a suggestion;
//   * nothing here PRESCRIBES: the rules cap intensity and splice recovery
//     work in, and say so.
//
// Pure: no React, no Supabase.
// ============================================================================

/** The body parts the injury log stores, plus the free-text "Other" entries. */
export type InjuryRestriction = {
  id: string;
  status: string;
  bodyPart: string;
  /** 1–10, as recorded. */
  severity: number;
  notes: string | null;
};

/**
 * A status means "this injury still restricts training" only when it is not
 * resolved. Improving and reassess are states on the way to resolution — the
 * restriction stands in both of them, which is exactly the rule the safety
 * bar sets: a restriction is lifted when the athlete (in practice, a
 * professional) says so, not when the pain stops dominating a Tuesday.
 */
export const isRestrictingStatus = (status: string): boolean => status !== "resolved";

/**
 * Which activity a recorded injury makes unsafe to do as written.
 *
 * The mapping is by reported site, because that is all the record holds. The
 * categories are deliberately coarse and conservative: a "Knee" injury flags
 * running, sprinting, jumping and heavy legs work, because those are the
 * movements a *knee at any injury level* is genuinely at risk of aggravating —
 * NOT because they are bad for knees in general. A site outside these areas is
 * never auto-adapted: "Other" entries are the athlete's own words and a rule
 * invented from them is a rule invented from nothing.
 */
const RESTRICTED_AREAS: Record<RestrictableArea, readonly string[]> = {
  lowerLimb: [
    "knee", "hamstring", "calf", "achilles", "foot", "ankle", "foot/ankle",
    "hip", "thigh", "quad", "groin", "shin", "lower leg", "leg",
  ],
  back: ["lower back", "back", "spine", "lumbar"],
  shoulder: ["shoulder", "rotator cuff"],
};

type RestrictableArea = "lowerLimb" | "back" | "shoulder";

const LOWER_LIMB_SPORT_PATTERNS = /\b(run|jog|sprint|skip|stride|jump|plyo|cut|lunge|leg)\b/i;
const BACK_PRESS_PATTERNS = /\b(overhead press|shoulder press|clean|snatch|deadlift|bent[- ]over row|squat)\b/i;
const SHOULDER_PRESS_PATTERNS = /\b(press|push[- ]?up|overhead|snatch|serve|throw|swim stroke|bench)\b/i;

const areaFor = (bodyPartRaw: string): RestrictableArea | null => {
  const site = bodyPartRaw.toLowerCase();
  if (RESTRICTED_AREAS.back.some((part) => site.includes(part))) return "back";
  if (RESTRICTED_AREAS.shoulder.some((part) => site.includes(part))) return "shoulder";
  if (RESTRICTED_AREAS.lowerLimb.some((part) => site.includes(part))) return "lowerLimb";
  return null;
};

const SEVERITY_FLOOR = 1;
const SEVERITY_CEILING = 10;
const HEAVY_SEVERITY = 6;

/**
 * What an active injury says about ONE session.
 *
 * Returns a transform only in the cases where a conservative rule is genuinely
 * defensible from the record; anything else is `flagged` with a reason and the
 * session is left as written, because an app that rewrites what it cannot
 * safely evaluate is worse than an app that says "have this checked".
 */
export type InjuryVerdict =
  | {
      action: "adapt";
      /** The reason, shown on the session chip in the plan detail. */
      reason: string;
      /** Shorter label for the chip itself. Phrased as an instruction — the
       *  plan data itself is never rewritten, so the chip must not claim the
       *  session WAS changed, only what to do with it. */
      chip: string;
      /** The adapted duration, when the rule shortens the session. */
      durationPct?: number;
      /** Deep link text for the athlete to act on. */
      actionLabel: "Reduce the load" | "Swap it for recovery work";
    }
  | { action: "flag"; reason: string; chip: string }
  | { action: "none" };

export function injuryVerdictForSession(
  injury: InjuryRestriction,
  session: { title: string; duration_minutes?: number; type?: string; isRest?: boolean; isRecovery?: boolean },
): InjuryVerdict {
  // Only unresolved injuries restrict, per the safety rule above. severity is
  // guarded the same way the form and DB checks bound it.
  if (!isRestrictingStatus(injury.status)) return { action: "none" };
  const severity = Math.max(SEVERITY_FLOOR, Math.min(SEVERITY_CEILING, Math.round(injury.severity)));
  if (session.isRest || session.isRecovery || session.type === "rest") return { action: "none" };

  const area = areaFor(injury.bodyPart);
  if (!area) return { action: "none" };

  const title = session.title;
  const duration = Number(session.duration_minutes) || 0;
  const site = injury.bodyPart;

  // High severity in any restricted area does not rewrite the plan — it takes
  // it to a professional. The chip carries the reason; the session is left
  // exactly as written so the adaptation decision stays with the person.
  if (severity >= HEAVY_SEVERITY) {
    return {
      action: "flag",
      chip: `Review · ${site} ${severity}/10`,
      reason: `Your ${site} injury is at severity ${severity}/10. Do not push through this — get professional assessment before your next session, and clear the whole plan with them.`,
    };
  }

  switch (area) {
    case "lowerLimb": {
      if (LOWER_LIMB_SPORT_PATTERNS.test(title)) {
        return {
          action: "adapt",
          chip: `Reduce · ${site}`,
          reason: `Cut to recovery pace for your ${site} injury (severity ${severity}/10). If anything hurts, stop — and have it assessed before the next hard session.`,
          durationPct: 0.6,
          actionLabel: "Reduce the load",
        };
      }
      if (BACK_PRESS_PATTERNS.test(title)) {
        return {
          action: "flag",
          chip: `Review · ${site}`,
          reason: `Loaded ${site === "back" ? "back" : "leg"} work with your ${site} injury (severity ${severity}/10) — a physiotherapist should clear the loading before you attempt it.`,
        };
      }
      return { action: "none" };
    }
    case "back": {
      if (BACK_PRESS_PATTERNS.test(title) || LOWER_LIMB_SPORT_PATTERNS.test(title)) {
        return {
          action: "flag",
          chip: `Review · ${site}`,
          reason: `An exercise your ${site} injury (severity ${severity}/10) should not be pushed through unloaded — get this movement checked by a professional before training it.`,
        };
      }
      if (duration > 45) {
        return {
          action: "adapt",
          chip: `Shorten · ${site}`,
          reason: `Kept to ${Math.max(15, Math.round(duration * 0.7))}min for your ${site}: long sessions in one position aggravate a recent complaint. Move or change position regularly.`,
          durationPct: 0.7,
          actionLabel: "Reduce the load",
        };
      }
      return { action: "none" };
    }
    case "shoulder": {
      if (SHOULDER_PRESS_PATTERNS.test(title)) {
        return {
          action: "flag",
          chip: `Review · ${site}`,
          reason: `Overhead or pressing work with your ${site} injury (severity ${severity}/10) — have this movement cleared by a professional rather than training through it.`,
        };
      }
      return { action: "none" };
    }
  }
}

// ---------------------------------------------------------------------------
// The plan-level summary
// ---------------------------------------------------------------------------

export type PlanInjurySummary = {
  /** The injuries that produced any verdict on this plan. */
  injuries: InjuryRestriction[];
  /** Sessions adapted or flagged, in plan order. */
  affected: { week: number; day: number; title: string; verdict: InjuryVerdict }[];
};

export function summarizeInjuryImpact(
  injuries: InjuryRestriction[],
  plan: Array<{ week: number; sessions?: Array<{ day: number; title?: string; duration_minutes?: number; type?: string; isRest?: boolean; isRecovery?: boolean }> }>,
): PlanInjurySummary {
  const active = injuries.filter((i) => isRestrictingStatus(i.status));
  const affected: PlanInjurySummary["affected"] = [];
  for (const week of plan) {
    for (const session of week.sessions ?? []) {
      for (const injury of active) {
        const verdict = injuryVerdictForSession(injury, {
          title: session.title ?? "",
          duration_minutes: session.duration_minutes,
          type: session.type,
          isRest: session.isRest,
          isRecovery: session.isRecovery,
        });
        if (verdict.action !== "none") {
          affected.push({ week: week.week, day: session.day, title: session.title ?? "", verdict });
          break; // one verdict per session is enough to act on
        }
      }
    }
  }
  return { injuries: active, affected };
}
