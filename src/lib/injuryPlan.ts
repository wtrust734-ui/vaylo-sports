// ============================================================================
// INJURY PLAN — the client half of the paid rehabilitation scaffold
// ----------------------------------------------------------------------------
// Injury Management is a one-off unlock. This is the part that is charged every
// time it is used: `ai-analyze` type "injury_plan" (priced at
// `creditCost("injury_plan")`), which writes a week-by-week scaffold for one
// injury, against what this athlete can still do. The tab is the screen; the
// plan is a provider call, so it is priced per plan on top of the unlock.
//
// What lives here is everything that has to be true before that call is worth
// making and after the answer arrives:
//
//   * the briefing the model reads is built from the athlete's own report, so
//     the page does not hand-assemble a prompt (and a severity of 3 cannot
//     arrive as "undefined"),
//   * the answer is validated DEFENSIVELY — a model that says "about 20
//     minutes", omits a week or wraps the JSON in markdown must produce a plan
//     the screen can read, never a crash on `weeks.map` and never a plan that
//     renders as empty after a charge,
//   * and the stored form (`injury_logs.recovery_protocol`, text) is rendered
//     here rather than in the component, so the same plan reads the same way
//     whether it was saved today or a month ago.
//
// Pure: no React, no Supabase.
// ============================================================================

/** One item inside a week — "Days 1-3: isometrics, 3×10, pain-free only". */
export type InjuryPlanItem = {
  /** When it happens, e.g. "Days 1–3". */
  label: string;
  /** The work itself: exercise, sets, reps or time. */
  work: string;
  /** What has to be pain-free before this is done or progressed. */
  painRule: string;
};

export type InjuryPlanWeek = {
  week: number;
  focus: string;
  items: InjuryPlanItem[];
  /** The checkpoint for moving to the next week. */
  progressWhen: string;
  /** What would end this week early. */
  stopIf: string;
};

export type InjuryPlan = {
  summary: string;
  weeks: InjuryPlanWeek[];
  /** Signs that mean stop and see a clinician. Never displayed as optional. */
  redFlags: string[];
  seeAProfessional: string;
  disclaimer: string;
};

/** The plan most the model may return; anything beyond this is dropped. */
export const MAX_PLAN_WEEKS = 12;

/**
 * Longest site we store. The same 40 the briefing caps `Reported site` at, so
 * the athlete's own words cannot be truncated to nothing between the form and
 * the prompt.
 */
export const MAX_SITE_LENGTH = 40;

/**
 * The injury site to log, from a list or in the athlete's own words.
 *
 * The screen's list of body parts is a set of SHORTCUTS, not the set of injuries
 * that exist. Everything off it used to be stored as "Other", which threw away
 * the most specific thing the paid plan is written from — a scaffold for "Other,
 * severity 4, no notes" is a plan for nobody. So "Other" means "describe it", and
 * what the athlete typed is kept (control characters stripped, whitespace
 * collapsed, length bounded) instead of being replaced.
 *
 * A site not on the list and not typed still falls back to "Other": the column
 * is free text, but a blank one is not a site.
 */
export function resolveInjurySite(input: {
  /** What the picker holds, including the "Other" entry. */
  listed: string;
  /** What the athlete typed when they picked "Other". */
  typed?: string | null;
  /** The shortcuts the picker offered. */
  known: readonly string[];
}): string {
  const clean = (input.typed ?? "")
    .replace(/\p{C}/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_SITE_LENGTH);
  if (input.listed === "Other") return clean || "Other";
  return input.known.includes(input.listed) ? input.listed : "Other";
}
const MAX_ITEMS_PER_WEEK = 8;

/**
 * Bounds on the athlete's own report. The server caps the whole briefing at
 * 4,000 characters; these keep a single field from eating that budget and stop
 * a pasted wall of text becoming the prompt.
 */
const MAX_NOTES = 600;

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const toText = (value: unknown, max = 400): string =>
  typeof value === "string" ? value.replace(/\p{C}/gu, " ").trim().slice(0, max) : "";

const toList = (value: unknown, max = 8, each = 300): string[] =>
  (Array.isArray(value) ? value : [])
    .map((v) => (typeof v === "string" ? toText(v, each) : ""))
    .filter((v) => v.length > 0)
    .slice(0, max);

// ---------------------------------------------------------------------------
// The briefing
// ---------------------------------------------------------------------------

export type InjuryBriefingInput = {
  bodyPart: string;
  /** 1–10, the same scale the injury log uses. */
  severity: number;
  notes?: string | null;
  /** Optional answers the athlete can give in the form. */
  hurts?: string | null;
  stillDoing?: string | null;
  /** Days since it started, when known. */
  daysSince?: number | null;
  /** Anything the app already knows, e.g. the athlete's sport. */
  sport?: string | null;
};

/**
 * Plain text for the model. Data, not instructions — the prompt says so — and
 * it carries only what the athlete reported: the app must never infer a
 * diagnosis to fill a gap, because a plausible-sounding invented injury is the
 * worst thing this feature could produce.
 */
export function buildInjuryBriefing(input: InjuryBriefingInput): string {
  const severity = Math.max(1, Math.min(10, Math.round(Number(input.severity) || 1)));
  const lines: string[] = [
    `Reported site: ${toText(input.bodyPart, 40) || "unspecified"}`,
    `Reported severity: ${severity}/10`,
  ];
  if (input.daysSince != null && Number.isFinite(Number(input.daysSince))) {
    const days = Math.max(1, Math.min(3650, Math.round(Number(input.daysSince))));
    lines.push(`Started about ${days} day${days === 1 ? "" : "s"} ago`);
  }
  if (input.sport) lines.push(`Sport: ${toText(input.sport, 60)}`);
  if (input.hurts) lines.push(`What hurts / makes it worse: ${toText(input.hurts, MAX_NOTES)}`);
  if (input.stillDoing) lines.push(`Still able to do: ${toText(input.stillDoing, MAX_NOTES)}`);
  if (input.notes) lines.push(`Athlete's own note: ${toText(input.notes, MAX_NOTES)}`);
  lines.push("The athlete has not been examined; nothing here is a diagnosis.");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Defensive parsing
// ---------------------------------------------------------------------------

export type InjuryPlanParseResult = {
  plan: InjuryPlan | null;
  /** Present when `plan` is null — what to tell the athlete. */
  error?: string;
};

/** Models sometimes wrap JSON in a fenced block despite being told not to. */
function unwrapJson(raw: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  return (fenced ? fenced[1] : raw).trim();
}

const readItem = (raw: unknown): InjuryPlanItem | null => {
  if (!isObject(raw)) return null;
  const work = toText(raw.work ?? raw.exercise ?? raw.detail, 400);
  const label = toText(raw.label ?? raw.when ?? raw.days, 60) || "Sessions";
  if (!work) return null;
  return { label, work, painRule: toText(raw.pain_rule ?? raw.painRule, 300) };
};

const readWeek = (raw: unknown, index: number): InjuryPlanWeek | null => {
  if (!isObject(raw)) return null;
  const weekNumber = Math.round(Number(raw.week));
  const week = Number.isFinite(weekNumber) && weekNumber > 0 ? weekNumber : index + 1;
  if (week > MAX_PLAN_WEEKS) return null;
  const rawItems: unknown = raw.items ?? raw.sessions;
  const items = (Array.isArray(rawItems) ? rawItems : [])
    .map(readItem)
    .filter((i): i is InjuryPlanItem => i !== null)
    .slice(0, MAX_ITEMS_PER_WEEK);
  const focus = toText(raw.focus, 120);
  // A week with no readable work is not a week: dropping it is better than
  // rendering an empty heading the athlete paid for.
  if (!focus && items.length === 0) return null;
  return {
    week,
    focus: focus || `Week ${week}`,
    items,
    progressWhen: toText(raw.progress_when ?? raw.progressWhen, 400),
    stopIf: toText(raw.stop_if ?? raw.stopIf, 400),
  };
};

/**
 * Turn whatever `ai-analyze` returned into something renderable.
 *
 * Accepts the raw JSON string, an already-parsed object, or a fenced block. A
 * response with no readable week is a failure, not an empty plan: the athlete
 * has been charged, so the screen has to say the answer could not be read
 * rather than show them nothing.
 */
export function parseInjuryPlan(raw: unknown): InjuryPlanParseResult {
  let container: unknown = raw;
  if (typeof raw === "string") {
    const text = unwrapJson(raw);
    if (!text) return { plan: null, error: "The plan came back empty." };
    try {
      container = JSON.parse(text);
    } catch {
      return { plan: null, error: "The plan came back in a shape we could not read." };
    }
  }
  if (typeof container === "string") {
    // Double-encoded (a JSON string inside the JSON string).
    try {
      container = JSON.parse(container);
    } catch {
      return { plan: null, error: "The plan came back in a shape we could not read." };
    }
  }
  if (isObject(container) && "plan" in container) container = container.plan;
  if (!isObject(container)) {
    return { plan: null, error: "The plan came back in a shape we could not read." };
  }

  const weeksSource = Array.isArray(container.weeks) ? container.weeks : [];
  const seen = new Set<number>();
  const weeks: InjuryPlanWeek[] = [];
  weeksSource.forEach((w, i) => {
    const parsed = readWeek(w, i);
    if (!parsed) return;
    // A week sent twice must not render twice.
    if (seen.has(parsed.week)) return;
    seen.add(parsed.week);
    weeks.push(parsed);
  });
  weeks.sort((a, b) => a.week - b.week);

  const redFlags = toList(container.red_flags ?? container.redFlags, 8, 300);

  if (weeks.length === 0) {
    return {
      plan: null,
      error: "The plan came back with no readable weeks, so nothing was saved. Your credits were refunded automatically.",
    };
  }

  return {
    plan: {
      summary: toText(container.summary, 600),
      weeks,
      redFlags,
      seeAProfessional: toText(container.see_a_professional ?? container.seeAProfessional, 400),
      disclaimer: toText(container.disclaimer, 400),
    },
  };
}

// ---------------------------------------------------------------------------
// The stored form
// ---------------------------------------------------------------------------
// `injury_logs.recovery_protocol` is text and is rendered line by line, so the
// plan is flattened here into lines a person reads in order: what the plan is,
// then each week with its work and its pain rule, then the red flags and the
// sentence that says who this is for. The disclaimer is always last and is
// never dropped — an AI-written rehabilitation scaffold shown without it is
// exactly the output this app must not produce.

const FALLBACK_DISCLAIMER =
  "General scaffold, not medical advice — have a qualified physiotherapist or doctor supervise it.";

/**
 * The first line of a stored AI plan.
 *
 * The column is plain text and the free generic scaffold is stored in the same
 * one, so the stored plan has to say which it is: an athlete (and this screen)
 * must be able to tell a generic scaffold from one written for their injury, and
 * "was I charged for this?" must be answerable from the record itself.
 */
export const PERSONALISED_PLAN_MARKER = "AI-written personalised plan";

export function renderInjuryProtocol(plan: InjuryPlan): string {
  const lines: string[] = [
    `${PERSONALISED_PLAN_MARKER} — for a qualified professional to supervise.`,
  ];
  if (plan.summary) lines.push(plan.summary);
  if (plan.disclaimer) lines.push(plan.disclaimer);
  else lines.push(FALLBACK_DISCLAIMER);

  for (const week of plan.weeks) {
    lines.push(`Week ${week.week}: ${week.focus}`);
    for (const item of week.items) {
      lines.push(`${item.label} — ${item.work}${item.painRule ? ` (${item.painRule})` : ""}`);
    }
    if (week.progressWhen) lines.push(`Progress when: ${week.progressWhen}`);
    if (week.stopIf) lines.push(`Stop this week if: ${week.stopIf}`);
  }

  if (plan.redFlags.length > 0) {
    lines.push("Stop and see a clinician now if:");
    for (const flag of plan.redFlags) lines.push(`• ${flag}`);
  }
  if (plan.seeAProfessional) lines.push(plan.seeAProfessional);

  return lines.join("\n");
}

/**
 * Read a stored `recovery_protocol` back: is it the paid plan, and what are the
 * lines to show? The marker is stripped so it is never a bullet on the screen,
 * and a plain generic scaffold (written before this feature, or by the free
 * path) comes back unmarked rather than being mislabelled as personalised.
 */
export function splitStoredProtocol(stored: string): { personalised: boolean; lines: string[] } {
  const lines = stored.split("\n");
  if (lines.length > 0 && lines[0].startsWith(PERSONALISED_PLAN_MARKER)) {
    return { personalised: true, lines: lines.slice(1) };
  }
  return { personalised: false, lines };
}

/** One line for a toast: the first thing the athlete should read. */
export function planHeadline(plan: InjuryPlan): string {
  if (plan.summary) return plan.summary.slice(0, 140);
  const first = plan.weeks[0];
  return first ? `${plan.weeks.length}-week plan starting: ${first.focus}` : "Plan ready.";
}
