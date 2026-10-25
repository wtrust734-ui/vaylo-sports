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

/**
 * The first line of a stored mobility/rehab plan.
 *
 * The free, on-device plan is a different thing from the paid AI scaffold: it is
 * three weeks of range, activation and gentle strength built from the logged
 * injury, and nobody was charged for it. It therefore gets its own marker, so
 * the screen never tells an athlete they paid for something they did not.
 */
export const MOBILITY_PLAN_MARKER = "Mobility & rehab plan (built on this device)";

/** Which of the three stored kinds a `recovery_protocol` holds. */
export type StoredPlanKind = "ai" | "mobility" | "generic";

export function renderInjuryProtocol(plan: InjuryPlan, kind: "ai" | "mobility" = "ai"): string {
  const marker = kind === "mobility" ? MOBILITY_PLAN_MARKER : PERSONALISED_PLAN_MARKER;
  const lines: string[] = [
    `${marker} — for a qualified professional to supervise.`,
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

// ---------------------------------------------------------------------------
// Serious symptoms — the gate ahead of any plan
// ---------------------------------------------------------------------------

/**
 * Free-text signals that this is not a nagging complaint. Deliberately narrow:
 * a keyword scan over an athlete's own words will false-positive ("numbness
 * has fully gone"), so the rule asks for the scarce, serious words only, and
 * every listed term is a symptom that genuinely warrants a clinician's
 * assessment regardless of the rest of the report.
 */
export type SeriousSymptomInput = {
  /** Severity as recorded, 1–10. */
  severity: number;
  /** What hurts / how it happened / the athlete's note. */
  reported: string;
};

const SERIOUS_SYMPTOM_PATTERNS: RegExp[] = [
  /can'?t (?:bear|put) (?:any )?weight/i,
  /unable to (?:bear|put) weight/i,
  /(?:numb|tingling|pins and needles|no feeling|lost sensation)/i,
  /(?:bladder|bowel) (?:changes|issues|control|problems|incontinence)/i,
  /(?:incontinence|saddle anesthesia|saddle numbness)/i,
  /(?:pop|snap|crack|tear)(?:ped|t|king)? (?:at|on|in|during)?\s*(?:the )?(?:time of injury|onset|impact|collision|landing|moment)/i,
  /(?:broken|fracture|deformed|dislocated|dislocation|bone sticking|obvious deformity)/i,
  /(?:night pain|pain that wakes)/i,
  /(?:fever|hot to touch|hot and swollen|red streak)/i,
  /(?:post-concussion|concussion|head injury|knocked out|black out|blurred vision after)/i,
  /(?:chest pain|can'?t breathe|trouble breathing|shortness of breath)/i,
  /(?:make it worse quickly|worse over hours|rapidly worsening swelling)/i,
];

/** Severity alone that warrants a professional before any training plan. */
export const SERIOUS_SEVERITY = 8;

export function hasSeriousSymptomSignals(input: SeriousSymptomInput): boolean {
  if (Math.max(1, Math.min(10, Math.round(Number(input.severity) || 1))) >= SERIOUS_SEVERITY) return true;
  const reported = input.reported ?? "";
  return SERIOUS_SYMPTOM_PATTERNS.some((re) => re.test(reported));
}

/**
 * The stored protocol for an injury whose report carries serious signals. Not
 * a plan: the app is the wrong place to manage a possible fracture or a
 * neurological complaint, and writing a training scaffold next to that report
 * would imply otherwise. Everything this stores says so.
 */
export const MEDICAL_REFERRAL_MARKER = "Medical assessment needed first";

export function medicalReferralProtocol(bodyPart: string): string[] {
  return [
    `${MEDICAL_REFERRAL_MARKER} — not a training plan.`,
    `What you reported for your ${bodyPart.toLowerCase()} — the severity, the way it happened, or the symptoms in your note — fits the pattern of an injury that needs a qualified clinician (physiotherapist or doctor) to assess it first.`,
    "Before any training resumes: get the injury examined, and ask the clinician what is safe to keep doing in the meantime. Keep to everyday activity and pain-free movement only.",
    "Do not train through this, and do not test it with a heavier session to 'check' how it feels.",
    "If symptoms are severe or getting worse quickly — inability to bear weight, numbness, bladder or bowel changes, sudden severe swelling, fever with a hot swollen site — seek urgent care now.",
    "Vaylo Sports does not diagnose or treat injuries, and will not write a plan around this report until a professional has assessed it. Once they have, log the outcome here and the app can help you track a plan they approve.",
  ];
}

// ---------------------------------------------------------------------------
// The free, conservative, visible scaffold
// ---------------------------------------------------------------------------
// The old generic scaffolds were fixed week-by-week programmes — "Week 3:
// build to sprints, add 10% a session" — written identically for a severity-2
// niggle and a severity-8 injury. That was a timeline the app could not
// justify (it knows nothing about the tissue, the healing stage, or the
// athlete's history) and a return-to-sport progression written before anyone
// looked at the injury. Both are exactly what a sports app must not hand out
// as medical-sounding instruction.
//
// What a free scaffold CAN honestly be: the general pattern of care every
// body area follows (settle, move within comfort, load gradually by pain
// rules), the movements that commonly need easing off for that area, the
// review criterion that earns progression, and the red flags. No week
// numbers, no percentages, no return date. The paid personalised plan above
// is where a week-by-week structure earns its place, because it is written
// for this injury — and even that one is capped by its own prompt server-side.
// ---------------------------------------------------------------------------

export type GenericScaffold = {
  /** What this area's general pattern of care is, in plain lines. */
  care: string[];
  /** Movements of this kind commonly need easing off while this is settling. */
  easeOff: string;
  /** The pain rule that earns progression. */
  progressWhen: string;
  /** Red flags that mean stop and see a clinician. */
  redFlags: string[];
};

const GENERIC_SCAFFOLDS: Record<string, GenericScaffold> = {
  Knee: {
    care: [
      "Keep the knee moving comfortably (heel slides, easy walking) — total rest past the first days tends to stiffen it, not protect it.",
      "Keep strength: quad squeezes and straight-leg raises stay in daily while the knee is settling, done pain-free.",
      "Change one thing at a time. If a day made it worse, that day is information — don't push the same dose again tomorrow.",
    ],
    easeOff: "Deep squats, jumping, cutting, downhill running and heavy leg presses are the movements most likely to aggravate a knee — keep them out of rotation while symptoms settle, rather than testing them.",
    progressWhen: "Progress the dose only when the knee has been comfortable the day AFTER the last increase — next-morning pain is the reading, not the session itself.",
    redFlags: ["The knee locks or gives way", "Swelling that keeps coming back or does not settle", "A pop at the moment of injury, followed by swelling", "Trouble bearing weight"],
  },
  Hamstring: {
    care: [
      "Very early on, keep it gentle: easy walking and pain-free range movement beat aggressive stretching for the first days.",
      "Strength work (bridges, gentle isometrics) can begin early if pain-free and is the base of everything after — build the dose gradually.",
      "Sprint work waits until strength is comfortable at range, not until a calendar says so.",
    ],
    easeOff: "Sprinting, acceleration, hurdle-style reaching and heavy Romanian deadlifts are hamstring aggravators — leave them out until the hamstring is comfortable at full range under moderate load.",
    progressWhen: "Sport-specific speed comes back only when loaded strength work is pain-free at full range — build it in small steps with a recovery day between each.",
    redFlags: ["A pop or snap felt at the back of the thigh", "Visible bruising appearing within a day", "Significant weakness or inability to activate the hamstring", "Pain walking or sitting on that side"],
  },
  Calf: {
    care: [
      "Keep it moving within comfort early — calf stiffness settles best with gentle, frequent movement, not with a boot.",
      "Gradual springiness work matters more than raw strength for calves; start when hopping is comfortable rather than forced.",
    ],
    easeOff: "Running, hopping, skipping, plyometrics and heavy calf loading stay out until the calf tolerates six comfortable single-leg heel raises without next-day pain.",
    progressWhen: "Progress only when a single-leg calf raise to heel-raise height is comfortable and pain-free the next morning.",
    redFlags: ["Sudden sharp pain in the calf with a pop", "Calf that is hot, swollen or visibly different from the other side", "Calf pain with breathing difficulty or chest pain (seek urgent care)"],
  },
  Achilles: {
    care: [
      "Achilles responds to gradual heavy loading, not to rest — but the dose must be tolerable and built slowly.",
      "Early on: keep walking comfortable, add gentle isometric holds if pain-free, and avoid stretching the tendon hard into pain.",
      "Morning stiffness melting as the day goes on is normal with tendon complaints; morning stiffness that sharpens is a sign to ease the dose.",
    ],
    easeOff: "Jumping, sprinting and steep running wait until hopping is comfortable on that leg without next-day pain.",
    progressWhen: "Build load only if next-morning pain stays below where it started and settles within a day.",
    redFlags: ["Sudden snap or loss of push-off strength", "A visible gap or lump change in the tendon", "Calf pain with chest pain or breathlessness (urgent care)"],
  },
  "Foot/Ankle": {
    care: [
      "Ankle sprains settle with early, comfortable movement and progressive balance work — not with immobilisation for weeks.",
      "Walking as tolerated from day one, easy range-of-motion circles, and single-leg balance practice when it can be held pain-free.",
    ],
    easeOff: "Cutting, hopping, uneven ground and plyometrics return last; they load the ankle in exactly its weakest direction.",
    progressWhen: "Progress when single-leg balance is steady for 30s pain-free and next-morning pain is not climbing.",
    redFlags: ["Unable to bear weight after the injury", "Bony tenderness at the malleolus or midfoot", "Numbness, coldness or colour change in the foot", "Swelling that worsens steadily"],
  },
  Hip: {
    care: [
      "Keep the hip moving comfortably — hip complaints stiffen fastest when the athlete stops moving entirely.",
      "Glute and trunk strength give the hip the support it needs; start gently, keep everything pain-free, expand the dose slowly.",
    ],
    easeOff: "Deep lunges, deep squats, limb-loaded hinge patterns and sprinting aggravate hip complaints most — keep them modest while symptoms settle.",
    progressWhen: "Progress loading when the hip is comfortable the day after work, not when the session itself feels fine.",
    redFlags: ["Groin or thigh pain with fever or feeling unwell", "Numbness or tingling down the leg", "Pain at night or at rest that is worsening", "Unable to bear weight"],
  },
  "Lower Back": {
    care: [
      "Keep moving within comfort — extended bed rest is the one thing back complaints respond to worst.",
      "Walk regularly, change positions often, and let the tolerance for sitting and bending rebuild at its own pace.",
      "Gradual trunk and hip strength work (bridges, bird-dogs, hinges patterned slowly) is the long-term base once day-to-day movement is comfortable.",
    ],
    easeOff: "Heavy deadlifts, loaded squats, overhead work and long static holds are the loading most likely to aggravate a back complaint — no maximal loads while it is settling.",
    progressWhen: "Load stepwise: a heavier session is earned by two comfortable days following the last one.",
    redFlags: ["Numbness, tingling or weakness spreading into a leg", "Bladder or bowel changes (urgent care)", "Fever with back pain", "Night pain that wakes you and will not settle", "Numbness in the saddle area (urgent care)"],
  },
  Shoulder: {
    care: [
      "Keep the shoulder moving gently within comfort (pendulum swings are the classic) — frozen-shoulder-pattern stiffness is the risk of total rest.",
      "Scapular control and rotator-cuff strength come back with high-frequency, low-load work begun early and built slowly.",
    ],
    easeOff: "Overhead pressing, heavy bench, throwing and catching reactions ease off until pain-free range under light load returns.",
    progressWhen: "Progress load only within a pain-free range, and only when the shoulder is no worse the next morning. The overhead end of the range returns last.",
    redFlags: ["Sudden weakness or inability to lift the arm", "A visible deformity or a bump out of place", "Numbness or tingling down the arm", "Neck pain with arm symptoms"],
  },
  Elbow: {
    care: [
      "Elbow complaints (tennis golfer's elbow territory) respond to gradual progressive loading, not to resting the arm entirely.",
      "Keep the wrist and forearm moving comfortably, and let grip-heavy work wait for tolerance.",
    ],
    easeOff: "Gripping under load, pull-ups, heavy curls and racket or throwing volume stay light until resisted wrist and elbow movements are comfortable.",
    progressWhen: "Build load only when the site settles within a day of the last increase rather than flaring for longer.",
    redFlags: ["Numbness or tingling in the hand", "Swelling, heat or visible deformity at the elbow", "Pain after a fall onto the outstretched arm"],
  },
  Wrist: {
    care: [
      "Keep the wrist moving within comfort early; load it progressively rather than splinting it for weeks (unless a clinician has said otherwise).",
      "Grip strength and wrist range rebuild together — light, frequent, pain-free.",
    ],
    easeOff: "Handstand pressure, heavy pressing, loaded carries and racket/hand-to-ground impact stay out until the wrist takes bodyweight-less loading comfortably.",
    progressWhen: "Progress when the wrist tolerates daily activities pain-free and next-morning pain is not climbing.",
    redFlags: ["Visible deformity after a fall", "Numbness or colour change in the fingers", "Pain that will not settle around the anatomical snuffbox after a fall (get it imaged)"],
  },
  Other: {
    care: [
      "The general pattern of care for any soft-tissue complaint: let it settle, keep it moving within comfort, rebuild loading gradually by pain rules.",
      "Relative rest just means dialling the aggravating thing down — not resting everything.",
      "Sleep, food and load-management are doing more for the injury than anything you can add on top.",
    ],
    easeOff: "Anything that reliably provokes the pain eases off; anything pain-free stays in the rotation.",
    progressWhen: "Progress when the site is comfortable the day after the last increase — the next-morning reading is the honest one.",
    redFlags: ["Numbness, tingling or weakness spreading from the site", "A hot, swollen or rapidly worsening site", "Fever or feeling generally unwell with the pain", "Inability to use the limb normally"],
  },
};

/**
 * The free generic scaffold, stored as the same text lines the paid path
 * writes. Conservative by construction: no week numbers, no percentages, no
 * return-to-sport timeline — because the app knows none of the things those
 * would have to be built from.
 */
export function genericScaffoldFor(bodyPart: string): GenericScaffold | undefined {
  return GENERIC_SCAFFOLDS[bodyPart] ?? GENERIC_SCAFFOLDS.Other;
}

/**
 * The generic scaffold as stored lines. A severity reported at the top of the
 * scale, or a report that carries the serious-symptom signals, returns the
 * medical-referral text instead of a scaffold: that is the app refusing to
 * be the clinician, which is the safety floor for this feature.
 */
export function freeInjuryProtocol(input: {
  bodyPart: string;
  severity: number;
  reported?: string | null;
}): { lines: string[]; referral: boolean } {
  if (hasSeriousSymptomSignals({ severity: input.severity, reported: input.reported ?? "" })) {
    return { lines: medicalReferralProtocol(input.bodyPart), referral: true };
  }
  const scaffold = genericScaffoldFor(input.bodyPart);
  if (!scaffold) {
    return { lines: medicalReferralProtocol(input.bodyPart), referral: true };
  }
  const lines: string[] = [
    "General scaffold for while this settles — not medical advice, and not a return-to-training programme.",
    ...scaffold.care.map((c) => `• ${c}`),
    `Ease off: ${scaffold.easeOff}`,
    `Progress when: ${scaffold.progressWhen}`,
    "Stop and see a clinician if:",
    ...scaffold.redFlags.map((f) => `• ${f}`),
    "If anything is sharp, worsening, or changes how the limb works — see a qualified physiotherapist or doctor rather than training through it. Once a professional has assessed the injury, their guidance goes into the personalised plan.",
  ];
  return { lines, referral: false };
}

/**
 * Read a stored `recovery_protocol` back: is it the paid plan, and what are the
 * lines to show? The marker is stripped so it is never a bullet on the screen,
 * and a plain generic scaffold (written before this feature, or by the free
 * path) comes back unmarked rather than being mislabelled as personalised.
 */
export function splitStoredProtocol(stored: string): {
  kind: StoredPlanKind;
  personalised: boolean;
  lines: string[];
} {
  const lines = stored.split("\n");
  const first = lines[0] ?? "";
  if (first.startsWith(PERSONALISED_PLAN_MARKER)) {
    return { kind: "ai", personalised: true, lines: lines.slice(1) };
  }
  if (first.startsWith(MOBILITY_PLAN_MARKER)) {
    return { kind: "mobility", personalised: false, lines: lines.slice(1) };
  }
  return { kind: "generic", personalised: false, lines };
}

/** One line for a toast: the first thing the athlete should read. */
export function planHeadline(plan: InjuryPlan): string {
  if (plan.summary) return plan.summary.slice(0, 140);
  const first = plan.weeks[0];
  return first ? `${plan.weeks.length}-week plan starting: ${first.focus}` : "Plan ready.";
}
