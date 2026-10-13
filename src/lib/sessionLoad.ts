// ============================================================================
// SESSION LOAD — one comparable number per session, per sport
// ----------------------------------------------------------------------------
// Phase 2 could not say how hard an athlete had actually been working, because
// `workouts` had no sport column and nothing anywhere stored a load. This
// module supplies that number, and it exists because the tempting shortcut is
// wrong: divide every session's minutes by a constant, call it a load, and
// treat an hour of swimming, an hour of easy running and a 90-minute football
// match as the same work.
//
// They are not the same work, and the specification says so in as many words:
// do not pretend that "60 minutes of swimming = 60 minutes of running". So each
// sport gets the formula the specification gives it — duration × intensity
// factor for running and cycling, volume load × RPE/10 for strength, minutes ×
// factor for field and court, distance × stroke factor for swimming — and every
// result carries the confidence and the reasoning that produced it.
//
// Walking is the one sport the specification does not price at all, and it gets
// an explicit discount of its own rather than a borrowed formula: an hour on
// your feet is real training and must not read as nothing, and it is equally
// not an hour of running. A sport with no formula *and* no replacement falls
// through to `unknownLoad`, which says so out loud.
//
// Three rules run through all of it:
//
//   1. NO FALSE PRECISION. The output is a plain number in arbitrary but
//      consistent units, not a validated physiological measure. It is rounded
//      to whole units so nothing downstream can imply more precision than a
//      slider and a duration produce.
//
//   2. UNCERTAINTY IS AN OUTPUT. A sport we cannot classify, or a session with
//      no duration, returns `load: null` with a reason — never a guessed number
//      dressed as a measurement. `null` means "not enough information", and the
//      decision layer above is required to say so rather than substitute.
//
//   3. HISTORY IS NEVER REWRITTEN. This computes a number for a session being
//      written now. It does not go back and assign loads to rows that already
//      exist, because a past session's real sport is a guess and a guess written
//      into history becomes a fact nobody can distinguish from a logged one.
//
// Pure: no Supabase, no clock, no React. Every band below is the specification's
// own number, and every deviation from it is named in a comment rather than
// buried in a constant.
// ============================================================================

// ---------------------------------------------------------------------------
// What we know about a session
// ---------------------------------------------------------------------------

/**
 * How the athlete (or a plan) described the session's intensity.
 *
 * Deliberately the same vocabulary the plan generator and the existing
 * `PlanSession.type` already use, so a planned session can be priced without a
 * translation table — and so "speed work" means the same thing in both places.
 */
export type IntensityBand =
  | "recovery"
  | "easy"
  | "moderate"
  | "hard"
  | "max";

/** Stroke, for a swim. Only swimming reads it. */
export type Stroke = "freestyle" | "backstroke" | "breaststroke" | "butterfly" | "mixed";

/** The sports this model prices explicitly. Anything else is unclassified. */
export type SportKind =
  | "running"
  | "cycling"
  | "swimming"
  | "walking"
  | "strength"
  | "field"
  | "court"
  | "unknown";

/** A session, as far as load is concerned. Every field is optional on purpose. */
export interface SessionLoadInput {
  /**
   * Free text as the athlete or the plan wrote it: "Running", "hiit", "gym",
   * "football". Normalised by `classifySport`; anything unrecognised is
   * `unknown` and priced conservatively rather than rejected.
   */
  sport?: string | null;
  /** The plan's own session type, used when `sport` is absent. */
  sessionType?: string | null;
  /** Minutes. The single most important input; without it there is no load. */
  durationMinutes?: number | null;
  /** Perceived exertion 1–10. The intensity proxy the specification asks for. */
  rpe?: number | null;
  /** Metres, for a swim. Preferred over duration when present. */
  distanceMeters?: number | null;
  /** Kilometres, as the performance log records it. Converted to metres. */
  distanceKm?: number | null;
  /** Sets × reps × load, when the athlete logged it. Strength only. */
  volumeLoad?: number | null;
  /** Stroke, for a swim. */
  stroke?: Stroke | null;
  /**
   * Whether a field/court session was a match or a practice. A match is worth
   * roughly half again as much as the same ninety minutes of drills.
   */
  kind?: "match" | "practice" | "unknown" | null;
}

/**
 * The price of one session.
 *
 * `confidence` is the field the rest of the app must respect. An athlete who
 * logged 45 minutes of something we cannot classify is not evidence of a
 * moderate session; they are evidence of 45 minutes, and the difference is
 * written down here rather than guessed away.
 */
export interface SessionLoad {
  /** Load units, or null when the session cannot be priced. */
  load: number | null;
  sport: SportKind;
  /** Which formula produced the number. Shown to the athlete, never hidden. */
  method: LoadMethod;
  /** How much the number can be trusted. */
  confidence: "high" | "medium" | "low";
  /**
   * Why the number is uncertain, in one short clause. Null when there is no
   * caveat to state, which is the case the app should be able to reach.
   */
  caveat: string | null;
}

export type LoadMethod =
  | "duration-x-intensity"
  | "walking-minutes-x-factor"
  | "volume-load-x-rpe"
  | "duration-x-rpe"
  | "distance-x-stroke"
  | "match-minutes-x-factor"
  | "practice-minutes-x-factor"
  | "unclassified";

/** One short sentence naming the real inputs, for an explanation. */
export const loadExplanation = (input: SessionLoadInput, result: SessionLoad): string => {
  if (result.load === null) return `Not enough information: ${result.caveat}`;
  const minutes = Number.isFinite(input.durationMinutes) ? `${Math.round(input.durationMinutes)} min` : "unknown duration";
  const rpe = Number.isFinite(input.rpe) ? ` at RPE ${Math.round(input.rpe)}` : "";
  switch (result.method) {
    case "volume-load-x-rpe":
      return `${Math.round(input.volumeLoad ?? 0).toLocaleString("en")} kg lifted × RPE ${Math.round(input.rpe ?? 0)} ÷ 10 = ${result.load}`;
    case "distance-x-stroke":
      return `${Math.round((input.distanceMeters ?? 0)).toLocaleString("en")} m ${input.stroke ?? "swum"}${rpe} = ${result.load}`;
    case "match-minutes-x-factor":
      return `${minutes} of match play × 1.4 = ${result.load}`;
    case "practice-minutes-x-factor":
      return `${minutes} of practice × 1.0 = ${result.load}`;
    case "duration-x-rpe":
      return `${minutes}${rpe} used as a stand-in for sets and reps = ${result.load}`;
    case "walking-minutes-x-factor":
      return `${minutes}${rpe} of walking × the walking factor (a walk is not a run) = ${result.load}`;
    case "unclassified":
      return `${minutes} of unclassified activity, priced at a moderate assumption = ${result.load}`;
    default:
      return `${minutes}${rpe} × intensity factor = ${result.load}`;
  }
};

// ---------------------------------------------------------------------------
// Classifying the sport
// ---------------------------------------------------------------------------

/**
 * Map free text to a sport kind.
 *
 * The vocabulary is the app's own — `Workouts` used `run|gym|cycle|swim|hiit|
 * sport`, the plan generator writes session types like `speed` and
 * `endurance`, the performance log writes "Running" — so one table covers all
 * three rather than three tables drifting apart.
 *
 * An unrecognised value is `unknown`, and that is a real answer, not a failure.
 */
export function classifySport(sport?: string | null, sessionType?: string | null): SportKind {
  const text = `${sport ?? ""} ${sessionType ?? ""}`.toLowerCase().trim();
  if (!text) return "unknown";

  // Swimming first: "swim", "swimming", "pool" and any stroke name.
  if (/swim|freestyle|backstroke|breaststroke|butterfly|\bpool\b/.test(text)) return "swimming";
  // Walking before running and cycling, and separate from both. It has to be
  // asked here rather than folded into the running branch, because the whole
  // point of the kind is that it is priced differently: "power walk", "race
  // walk" and "Nordic walk" are training, and none of them is a run. Nothing
  // above or below this line contains "walk", "hike", "trek" or "rambl".
  // `hik` rather than `hike`: "hiking" is h-i-k-i-n-g and does not contain
  // "hike", so the obvious spelling of the branch silently left every imported
  // hike — which `importHistory` labels "Hiking" — priced as an unknown sport.
  if (/walk|hik|rambl|trek/.test(text)) return "walking";
  // Cycling before running: "trail running" and "cyclocross" both contain "run"
  // and "cross" in ways a substring test would otherwise get wrong.
  if (/cycl|bike|biking|ride|rowing|row\b|erg|spin|elliptical/.test(text)) return "cycling";
  if (/run|trail|jog|5k|10k|half marathon|running|cross.?country/.test(text)) return "running";
  if (/strength|gym|weight|lift|resistance|calisthenic|bodyweight|power\b/.test(text)) return "strength";
  // Cricket is a field sport: long spells of standing, sprinting between the
  // wickets and bowling, which is closer to the field/court model than to any
  // duration-based one.
  if (/football|soccer|hockey|rugby|cricket|field\b/.test(text)) return "field";
  if (/basketball|court|tennis|badminton|volley|netball/.test(text)) return "court";
  return "unknown";
}

/**
 * Intensity band from a session's own type, when no RPE was logged.
 *
 * A planned "Intervals" session is a hard session even though nobody has
 * reported how it felt yet, and treating it as moderate would be the app
 * quietly under-counting the very thing the specification asks it to notice.
 */
export function bandFromSessionType(sessionType?: string | null): IntensityBand | null {
  const text = (sessionType ?? "").toLowerCase();
  if (!text) return null;
  if (/interval|speed|hill|repeat|race/.test(text)) return "hard";
  if (/tempo|threshold|power|strength|sport_specific/.test(text)) return "hard";
  if (/long|endurance|conditioning|cross/.test(text)) return "moderate";
  if (/easy|recovery|mobility|rest|active/.test(text)) return "easy";
  if (/sprint|max/.test(text)) return "max";
  return null;
}

// ---------------------------------------------------------------------------
// Intensity factors
// ---------------------------------------------------------------------------

/**
 * The specification's bands, as their midpoints.
 *
 * Bands, not points, because the specification gives ranges and the honest
 * reading of "0.6–0.8" is that we do not know where inside it the session
 * actually sat. The midpoint is used, the range is exported below so callers
 * can show the athlete the width, and `factorBand` returns which band was
 * chosen so the explanation can name it rather than asserting precision.
 */
export const INTENSITY_BANDS: Record<IntensityBand, { min: number; max: number; factor: number }> = {
  recovery: { min: 0.6, max: 0.8, factor: 0.7 },
  easy: { min: 0.6, max: 0.8, factor: 0.7 },
  moderate: { min: 0.9, max: 1.1, factor: 1.0 },
  hard: { min: 1.2, max: 1.5, factor: 1.35 },
  max: { min: 1.5, max: 2.0, factor: 1.75 },
};

/**
 * Field and court: a match is worth materially more than the same time training.
 *
 * 1.4 and 1.0 are the midpoints of the specification's 1.3–1.6 and 0.9–1.1.
 * The gap is the point — an unplanned 90-minute match the athlete did not plan
 * for has to move the needle, or the cross-sport integration in §4 does
 * nothing.
 */
export const FIELD_MATCH_FACTOR = 1.4;
export const FIELD_PRACTICE_FACTOR = 1.0;

/**
 * Stroke factors, in load per metre.
 *
 * The specification gives them in ranges because they genuinely are ranges: a
 * relaxed breaststroke swim and a maximal one are different sports. Midpoints
 * again, and again the range is what gets shown.
 *
 * Divided by 1000 to put swimming in the same rough range as the
 * duration-based sports: 1500 m of easy freestyle is ~1500 units, which reads
 * against a 60-minute easy run at 42 units. Swimming at an easy effort is
 * genuinely lower-load-per-minute than running, and the number says so.
 */
export const STROKE_FACTORS: Record<Stroke, { min: number; max: number }> = {
  freestyle: { min: 1.0, max: 1.0 },
  backstroke: { min: 1.0, max: 1.1 },
  breaststroke: { min: 1.1, max: 1.3 },
  butterfly: { min: 1.3, max: 1.5 },
  mixed: { min: 1.0, max: 1.5 },
};
const STROKE_FACTOR_MIDPOINT: Record<Stroke, number> = {
  freestyle: 1.0,
  backstroke: 1.05,
  breaststroke: 1.2,
  butterfly: 1.4,
  mixed: 1.2,
};

/**
 * What one minute of swimming is worth against one minute of running.
 *
 * The specification gives running and swimming different formulas and then says
 * plainly that 60 minutes of swimming must not read as 60 minutes of running.
 * The distance-based branch already honours that. The duration-based fallback —
 * the one used when an athlete logs a swim without a distance — would not,
 * because both would land on the same duration × intensity figure.
 *
 * So the fallback carries an explicit discount for being non-weight-bearing.
 * 0.7 is a stated assumption, not a measured constant, and it is deliberately
 * conservative: it counts a hard minute of swimming as meaningfully less load
 * than a hard minute of running while still refusing to call it nothing. It is
 * exported so the assumption is visible to anyone reading the model, and the
 * caveat travels with the result so the athlete is told the number is a proxy.
 */
export const SWIM_DURATION_FACTOR = 0.7;

/**
 * What one minute of walking is worth against one minute of running.
 *
 * The specification gives no walking formula, and the alternative to assuming
 * one is worse than it looks: leaving walking unclassified sends it through
 * `unknownLoad`, which prices an unrecognised session as a MODERATE one — so a
 * gentle hour on your feet would come back as hard as an hour of steady
 * running, and over-counting load is the direction this module treats as the
 * dangerous one (it is what tells a recovering athlete to stop training when
 * they do not need to).
 *
 * 0.5 is a STATED ASSUMPTION, not a measured constant: walking costs roughly
 * half of running the same minutes, and the figure is deliberately on the low
 * side of that so the error is in the safe direction. It is exported so the
 * assumption is visible to anyone reading the model, and a caveat travels with
 * every walking result so the athlete is told the number is a proxy.
 */
export const WALK_DURATION_FACTOR = 0.5;

/**
 * The intensity band for a session, from RPE if given and from the session's
 * own type otherwise.
 *
 * The RPE cut points are the specification's bands mapped onto a 1–10 scale.
 * They are cut points, not conversions: nobody has validated that RPE 7 is
 * exactly 1.35, and the comment says so, because the alternative is a false
 * claim of precision wearing a decimal point.
 */
export function bandFor(input: SessionLoadInput): IntensityBand | null {
  // `typeof === "number"`, never `Number(...)`: `Number(null)` is 0 and
  // `Number.isFinite(0)` is true, so a session with no RPE would be read as
  // RPE 0 — the easiest possible effort — and quietly un-load every session the
  // athlete did not bother to rate.
  const rpe = typeof input.rpe === "number" && Number.isFinite(input.rpe) ? input.rpe : null;
  if (rpe !== null) {
    if (rpe <= 3) return "recovery";
    if (rpe <= 5) return "easy";
    if (rpe <= 6) return "moderate";
    if (rpe <= 8) return "hard";
    return "max";
  }
  return bandFromSessionType(input.sessionType) ?? bandFromSessionType(input.sport);
}

/** The factor a band prices at, or null when no band could be determined. */
export function factorBand(band: IntensityBand | null): number | null {
  if (!band) return null;
  return INTENSITY_BANDS[band].factor;
}

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

/**
 * A finite number, or null.
 *
 * Rejects `null`, `""`, `false` and `NaN` rather than coercing them. `Number(null)`
 * is 0 and `Number("")` is 0, so a session with no duration logged would be
 * priced as a zero-minute session — load zero, which downstream reads as "this
 * athlete did nothing". A missing input has to stay missing all the way through.
 *
 * Numeric *strings* are still accepted, because a form field arrives as one.
 */
const num = (value: unknown): number | null => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

const round = (n: number): number => Math.round(n);

/**
 * The load of one session, or null when it cannot be priced.
 *
 * The order of the branches is the order of how much we trust each input, and
 * it differs per sport on purpose:
 *
 *   • Strength prefers `volumeLoad × RPE/10` — the specification's own formula,
 *     and the only one that reflects how much was actually lifted. Duration ×
 *     RPE is the documented fallback, never the first choice.
 *
 *   • Swimming prefers distance × stroke factor. Duration is the fallback,
 *     because a swim logged without a distance is far more common than a run
 *     logged without a time, and 45 minutes of butterfly at an easy effort is
 *     still a demanding session.
 *
 *   • Field and court needs a match/practice answer, because that is the whole
 *     point: a match and a practice are different amounts of work and the
 *     specification prices them 40% apart. When the athlete did not say which,
 *     the fallback is the *practice* factor, not the match factor — assuming a
 *     game they did not mention would inflate their load on a guess, and the
 *     failure mode of over-counting load is that the app tells a recovering
 *     athlete to stop training when they do not need to.
 *
 *   • Everything else uses the sport's duration × intensity factor, with the
 *     band from RPE and the session type as the fallback.
 */
export function sessionLoad(input: SessionLoadInput): SessionLoad {
  const sport = classifySport(input.sport, input.sessionType);
  const duration = num(input.durationMinutes);
  const rpe = num(input.rpe);
  const band = bandFor(input);
  const factor = factorBand(band);

  if (sport === "strength") return strengthLoad(input, duration, rpe);
  if (sport === "swimming") return swimLoad(input, duration, rpe, band);
  if (sport === "walking") return walkingLoad(input, duration);
  if (sport === "field" || sport === "court") return fieldLoad(input, sport, duration, rpe);
  if (sport === "unknown") return unknownLoad(input, duration);

  if (duration === null) {
    return {
      load: null,
      sport,
      method: "duration-x-intensity",
      confidence: "low",
      caveat: "no duration was recorded",
    };
  }

  return {
    load: round(duration * (factor ?? INTENSITY_BANDS.moderate.factor)),
    sport,
    method: "duration-x-intensity",
    // No intensity signal at all means the number is a moderate assumption.
    confidence: factor === null ? "low" : "medium",
    caveat: factor === null ? "no intensity was recorded, so a moderate effort is assumed" : null,
  };
}

function strengthLoad(input: SessionLoadInput, duration: number | null, rpe: number | null): SessionLoad {
  const volume = num(input.volumeLoad);
  // The specification's first choice, and the only formula here that reflects
  // what was actually lifted rather than how long the athlete stood in a room.
  if (volume !== null && volume > 0 && rpe !== null) {
    return { load: round((volume * rpe) / 10), sport: "strength", method: "volume-load-x-rpe", confidence: "high", caveat: null };
  }
  if (volume !== null && volume > 0) {
    // Volume without effort is still real information, but the specification's
    // formula needs both, and inventing an RPE would be fabricating the input
    // the formula exists to use. Priced at RPE 5 — the middle of the scale —
    // and said so.
    return {
      load: round((volume * 5) / 10),
      sport: "strength",
      method: "volume-load-x-rpe",
      confidence: "low",
      caveat: "no effort was recorded, so a moderate effort is assumed",
    };
  }
  // Duration × RPE, exactly as the specification's fallback prescribes. RPE is
  // divided by 10 to keep a session-RPE figure from being ten times a
  // duration figure.
  if (duration !== null && rpe !== null) {
    return {
      load: round(duration * (rpe / 10)),
      sport: "strength",
      method: "duration-x-rpe",
      confidence: "low",
      caveat: "sets, reps and weights were not logged, so duration and effort stand in for them",
    };
  }
  return {
    load: null,
    sport: "strength",
    method: "duration-x-rpe",
    confidence: "low",
    caveat: "no duration, effort or lifted volume was recorded",
  };
}

function swimLoad(
  input: SessionLoadInput,
  duration: number | null,
  rpe: number | null,
  band: IntensityBand | null,
): SessionLoad {
  const stroke = (input.stroke ?? "mixed") as Stroke;
  const metres = num(input.distanceMeters) ?? (num(input.distanceKm) !== null ? num(input.distanceKm)! * 1000 : null);
  const strokeFactor = STROKE_FACTOR_MIDPOINT[stroke] ?? 1.2;

  // Distance is the specification's first choice. Stroke defaults to "mixed"
  // rather than freestyle: a swimmer who logged 2000 m without saying which
  // stroke was in it has told us the distance and withheld the one detail that
  // changes the number, and 1.2 (the middle of the range) is the honest
  // midpoint of "mixed".
  if (metres !== null && metres > 0) {
    const hard = band === "hard" || band === "max";
    const factor = strokeFactor * (hard ? 1.25 : 1);
    return {
      load: round((metres / 1000) * factor),
      sport: "swimming",
      method: "distance-x-stroke",
      confidence: stroke === "mixed" ? "low" : "medium",
      caveat: stroke === "mixed" ? "the stroke was not recorded, so a mixed-stroke factor is used" : null,
    };
  }

  // No distance. A swim logged only as time is still real training, and the
  // specification's fallback is duration × intensity factor — but with the
  // non-weight-bearing discount above, because without it this branch would
  // return exactly the running figure and assert the equivalence the
  // specification forbids.
  if (duration !== null) {
    const f = (factorBand(band) ?? INTENSITY_BANDS.moderate.factor) * SWIM_DURATION_FACTOR;
    return {
      load: round(duration * f),
      sport: "swimming",
      method: "duration-x-intensity",
      confidence: "low",
      caveat:
        rpe === null
          ? "no distance, stroke or effort was recorded, so a moderate swim is assumed"
          : "no distance was recorded, so time and effort are used instead — a swim is not weighted like a run",
    };
  }
  return {
    load: null,
    sport: "swimming",
    method: "distance-x-stroke",
    confidence: "low",
    caveat: "no distance or duration was recorded",
  };
}

function walkingLoad(input: SessionLoadInput, duration: number | null): SessionLoad {
  if (duration === null) {
    return { load: null, sport: "walking", method: "walking-minutes-x-factor", confidence: "low", caveat: "no duration was recorded" };
  }
  // An effort rating still says how hard the walk was — a hilly hour with a
  // pack is not an amble round the block — so it scales the walking factor
  // rather than replacing it. That is the difference from the running branch:
  // no reported effort can turn a walk into a run here.
  const effort = factorBand(bandFor(input)) ?? INTENSITY_BANDS.moderate.factor;
  return {
    load: round(duration * effort * WALK_DURATION_FACTOR),
    sport: "walking",
    method: "walking-minutes-x-factor",
    confidence: "low",
    caveat:
      num(input.rpe) !== null
        ? "walking is priced at a stated fraction of running, so this is a proxy rather than a measured figure"
        : "no effort was recorded, so a moderate walk is assumed",
  };
}

function fieldLoad(
  input: SessionLoadInput,
  sport: SportKind,
  duration: number | null,
  rpe: number | null,
): SessionLoad {
  if (duration === null) {
    return { load: null, sport, method: "match-minutes-x-factor", confidence: "low", caveat: "no duration was recorded" };
  }
  const kind = input.kind ?? null;
  if (kind === "match") {
    // A hard match also carries an intensity ceiling from the RPE, but the
    // specification prices a match at 1.3–1.6 regardless, so the RPE is only
    // used to keep an easy training match from being read as a final.
    const f = rpe !== null && rpe >= 8 ? 1.6 : FIELD_MATCH_FACTOR;
    return { load: round(duration * f), sport, method: "match-minutes-x-factor", confidence: "high", caveat: null };
  }
  if (kind === "practice") {
    return { load: round(duration * FIELD_PRACTICE_FACTOR), sport, method: "practice-minutes-x-factor", confidence: "medium", caveat: null };
  }
  // Unknown whether this was a match or a practice. Priced as a practice, and
  // the caveat is not decoration — it is the difference between a number the
  // athlete can rely on and one they cannot.
  return {
    load: round(duration * FIELD_PRACTICE_FACTOR),
    sport,
    method: "practice-minutes-x-factor",
    confidence: "low",
    caveat: "it was not recorded whether this was a match or a training session, so it is priced as training",
  };
}

function unknownLoad(input: SessionLoadInput, duration: number | null): SessionLoad {
  if (duration === null) {
    return { load: null, sport: "unknown", method: "unclassified", confidence: "low", caveat: "no duration was recorded" };
  }
  // The specification's instruction for a sport we cannot compare: acknowledge
  // the uncertainty, and treat it as moderately demanding. A moderate factor is
  // the middle of every band in this file — the one assumption that is wrong in
  // neither direction by much.
  const rpe = num(input.rpe);
  const f = rpe !== null ? (factorBand(bandFor(input)) ?? 1.0) : 1.0;
  return {
    load: round(duration * f),
    sport: "unknown",
    method: "unclassified",
    confidence: "low",
    caveat: "the sport could not be identified, so this is priced as a moderate session",
  };
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

/** One day's total load, and how many sessions it was built from. */
export interface DailyLoad {
  date: string;
  load: number;
  sessions: number;
}

/**
 * Total load by day, newest last.
 *
 * Sums whatever is in the window and counts only the sessions that produced a
 * number. A day with two unpriceable sessions reports zero load and two
 * sessions, which is the truth: work happened, and we cannot say how much.
 */
export function dailyLoadTotals(
  entries: { date: string; load: number | null }[],
): DailyLoad[] {
  const map = new Map<string, DailyLoad>();
  for (const entry of entries) {
    const row = map.get(entry.date) ?? { date: entry.date, load: 0, sessions: 0 };
    if (entry.load !== null && Number.isFinite(entry.load)) {
      row.load += entry.load;
      row.sessions += 1;
    }
    map.set(entry.date, row);
  }
  return [...map.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * Load over a window, and the days it was logged on.
 *
 * `daysLogged` matters as much as `total`: an athlete who trained hard on four
 * days is a different situation from one who logged the same total across
 * fourteen, and a recommendation that cannot tell the difference is guessing.
 */
export function loadTotals(entries: { date: string; load: number | null }[]): { total: number; sessions: number; daysLogged: number } {
  const priced = entries.filter((e) => e.load !== null && Number.isFinite(e.load));
  return {
    total: priced.reduce((sum, e) => sum + (e.load ?? 0), 0),
    sessions: priced.length,
    daysLogged: new Set(entries.map((e) => e.date)).size,
  };
}