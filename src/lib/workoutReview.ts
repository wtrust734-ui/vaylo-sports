// ============================================================================
// WORKOUT REVIEW DIGEST — plan-vs-actual, with nothing invented
// ----------------------------------------------------------------------------
// "Analyse my workouts" sends one bounded text summary to the existing
// stats_insight AI call. That call already has the authoritative dossier, but
// the dossier is a broad athlete memory; this digest puts the comparison the
// athlete asked for at the top: what was logged, what the current plan week
// says, and the explicit question to compare them.
//
// Nothing here invents training. An absent plan is reported as absent, an
// empty workout list is reported as empty, and every line is truncated so a
// long history cannot push the request over the edge function's text cap.
// ============================================================================

export interface WorkoutReviewRow {
  title?: string | null;
  type?: string | null;
  sport?: string | null;
  duration_minutes?: number | null;
  distance_km?: number | string | null;
  calories_burned?: number | null;
  completed_at?: string | null;
  created_at?: string | null;
  notes?: string | null;
}

export interface WorkoutReviewPlanSession {
  day?: number | null;
  title?: string | null;
  type?: string | null;
  duration_minutes?: number | null;
  description?: string | null;
  skipped?: boolean | null;
}

export interface WorkoutReviewPlanWeek {
  week?: number | null;
  sessions?: WorkoutReviewPlanSession[] | null;
}

const MAX_DIGEST_CHARS = 3400;
const MAX_WORKOUTS = 20;
const MAX_NOTE_CHARS = 140;

const cleanLine = (value: unknown): string =>
  String(value ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const workoutLine = (row: WorkoutReviewRow): string | null => {
  const date = cleanLine(row.completed_at ?? row.created_at).slice(0, 10);
  const title = cleanLine(row.title || `${row.type || row.sport || "Session"}`);
  if (!date || !title) return null;
  const sport = cleanLine(row.sport || row.type);
  const minutes = typeof row.duration_minutes === "number" ? `${row.duration_minutes} min` : "";
  const distance = row.distance_km == null || row.distance_km === "" ? "" : `${cleanLine(row.distance_km)} km`;
  const calories =
    typeof row.calories_burned === "number" ? `${row.calories_burned} kcal` : "";
  const note = cleanLine(row.notes).slice(0, MAX_NOTE_CHARS);
  return [
    `- ${date}: ${title}`,
    sport,
    [minutes, distance, calories].filter(Boolean).join(" · "),
    note ? `Note: ${note}` : "",
  ]
    .filter(Boolean)
    .join(" — ");
};

const planLine = (session: WorkoutReviewPlanSession): string | null => {
  const title = cleanLine(session.title);
  if (!title || session.skipped) return null;
  const day = typeof session.day === "number" ? `Day ${session.day}` : "Unscheduled day";
  const kind = cleanLine(session.type);
  const minutes = typeof session.duration_minutes === "number" ? `${session.duration_minutes} min` : "";
  const description = cleanLine(session.description).slice(0, MAX_NOTE_CHARS);
  return [`- ${day}: ${title}`, kind, minutes, description].filter(Boolean).join(" — ");
};

export function buildWorkoutReviewDigest(input: {
  workouts: WorkoutReviewRow[] | null | undefined;
  planWeek?: WorkoutReviewPlanWeek | null;
  weekCurrent?: number | null;
  durationWeeks?: number | null;
}): { digest: string; workoutCount: number } {
  const workouts = Array.isArray(input.workouts) ? input.workouts.slice(0, MAX_WORKOUTS) : [];
  const workoutLines = workouts
    .map(workoutLine)
    .filter((line): line is string => !!line);
  const planSessions = Array.isArray(input.planWeek?.sessions) ? input.planWeek.sessions : [];
  const planLines = planSessions.map(planLine).filter((line): line is string => !!line);

  let digest = `Logged workouts (newest first, up to ${MAX_WORKOUTS}):\n${
    workoutLines.length ? workoutLines.join("\n") : "No completed workouts were supplied."
  }\n\n`;
  if (input.planWeek && typeof input.weekCurrent === "number") {
    digest += `Current training plan: week ${input.weekCurrent}${
      typeof input.durationWeeks === "number" ? ` of ${input.durationWeeks}` : ""
    }.\n${planLines.length ? planLines.join("\n") : "The current plan week has no scheduled sessions."}\n\n`;
  } else {
    digest += "Current training plan: no active plan was supplied.\n\n";
  }
  const compareLine =
    "Compare the logged workouts with the current plan week. Name where execution drifted from the plan, " +
    "what that drift suggests about load, balance, or consistency, and give 3-5 concrete next actions.";

  // The evidence is truncated to whatever room is left once the fixed
  // comparison ask is reserved, so the prompt never exceeds the edge
  // function's text cap AND the question is always the last thing the model
  // reads. Truncating the whole string would eat the question instead.
  const MARKER = "\n… (log truncated)";
  const room = MAX_DIGEST_CHARS - compareLine.length - 1;
  let body = digest.replace(/\s+$/, "");
  if (body.length > room) {
    body = body.slice(0, Math.max(0, room - MARKER.length)) + MARKER;
  }

  return {
    digest: `${body}\n${compareLine}`,
    workoutCount: workoutLines.length,
  };
}
