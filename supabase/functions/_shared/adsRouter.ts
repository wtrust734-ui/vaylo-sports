// ============================================================================
// adsRouter — intent classification + ordered routing for Ads Studio
// ----------------------------------------------------------------------------
// Two layers, deliberately:
//   1. deterministic rules below — fast, free, precise on explicitly worded
//      requests, and the safety net when the model is unreachable;
//   2. a model-based refinement in ads-chat (structured JSON) that uses these
//      same validators, so neither path can invent a plan shape the system
//      does not implement.
//
// Rules of the house (enforced in code, not prose):
//   • image-ad requests route to the image workflow and never silently become
//     video, and vice versa — a script is not a finished video;
//   • combined requests ("research X before creating Y") keep the requested
//     ORDER: research steps come before the creation steps they precede;
//   • ambiguous input asks one concise clarifying question rather than guessing;
//   • nothing here starts a paid generation — the plan is persisted for the
//     specialist workflows (Prompt 3+) to execute behind cost gates.
// ============================================================================

export const INTENTS = [
  "image_ad",
  "video_ad",
  "competitor_research",
  "campaign_ideation",
  "creative_revision",
  "asset_library",
  "platform_question",
  // Prompt 7: the routing set must also cover analyse / export / compare
  // requests instead of falling into ideation.
  "campaign_analyse",
  "export_asset",
] as const;

export type AdsIntent = (typeof INTENTS)[number];

export interface StepOptions {
  format?: "image" | "video";
  durationSeconds?: number;
  conceptCount?: number;
  competitors?: string[];
  platform?: string;
  revisionTarget?: string;
  query?: string;
  /** The campaign or asset being analysed/exported, when one is referred to. */
  target?: string;
}

export interface PlanStep {
  type: AdsIntent;
  options: StepOptions;
}

export interface Classification {
  primary: AdsIntent;
  steps: PlanStep[];
  clarification: string | null;
}

export const KNOWN_COMPETITORS = [
  "strava",
  "nike run club",
  "nike",
  "runna",
  "adidas",
  "under armour",
  "mapmyrun",
  "whoop",
  "garmin",
  "peloton",
] as const;

const CLARIFYING_QUESTION =
  "Happy to help. Do you want an image ad, a video ad, competitor research, new campaign concepts, a change to existing creative, or to look something up in the library?";

// ---------------------------------------------------------------------------
// Options parsing + validation
// ---------------------------------------------------------------------------

function parseDurationSeconds(text: string): number | undefined {
  const m = text.match(/(\d{1,2})\s*(?:-|\s)?\s*(?:second|sec|s)\b/i);
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : undefined;
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

function parseConceptCount(text: string): number | undefined {
  // "5 concepts", "give me five different launch concepts" — a few filler
  // words between the count and the noun are tolerated, in either direction.
  const digit = text.match(/\b(\d{1,2})\s+[a-z\s]{0,20}?concepts?\b/i);
  if (digit) return Number(digit[1]);
  const word = text.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+[a-z\s]{0,20}?concepts?\b/i);
  if (word) return NUMBER_WORDS[word[1].toLowerCase()];
  const verb = text.match(/\b(?:give me|make|create|generate|need|wanted)\s+(\d{1,2})\b/i);
  if (verb) return Number(verb[1]);
  return undefined;
}

function parseCompetitors(text: string): string[] | undefined {
  const found = new Set<string>();
  for (const c of KNOWN_COMPETITORS) {
    if (text.includes(c)) found.add(c.trim());
  }
  // "research X and Y before…" — quoted names or capitalised words often name brands
  const quoted = text.match(/["“']([A-Za-z][\w&.\- ]{2,30})["”']/g) ?? [];
  for (const q of quoted) {
    const name = q.replace(/["“'”]/g, "").trim();
    if (name) found.add(name);
  }
  return found.size ? [...found] : undefined;
}

function parsePlatform(text: string): string | undefined {
  const m = text.match(/\b(instagram|tiktok|reels|youtube shorts|youtube|facebook|linkedin)\b/i);
  return m ? m[1].toLowerCase() : undefined;
}

function parseRevisionTarget(text: string): string | undefined {
  const m = text.match(/\b(opening hook|hook|captions?|storyboard|script|call to action|cta|voiceover|soundtrack)\b/i);
  return m ? m[1].toLowerCase() : undefined;
}

/**
 * Per-intent validation. Returns the problems as strings; an empty list means
 * the step is well-formed for its specialist workflow.
 */
export function validateStep(step: PlanStep): string[] {
  const problems: string[] = [];
  const o = step.options;
  switch (step.type) {
    case "video_ad": {
      if (o.format !== "video") problems.push("video_ad steps must carry format:\"video\"");
      if (o.durationSeconds !== undefined && (o.durationSeconds < 6 || o.durationSeconds > 60)) {
        problems.push("durationSeconds must be between 6 and 60");
      }
      break;
    }
    case "image_ad": {
      if (o.format !== "image") problems.push("image_ad steps must carry format:\"image\"");
      if (o.durationSeconds !== undefined) problems.push("image ads take no durationSeconds");
      break;
    }
    case "campaign_ideation": {
      if (o.conceptCount !== undefined && (o.conceptCount < 1 || o.conceptCount > 5)) {
        problems.push("conceptCount must be between 1 and 5");
      }
      break;
    }
    case "competitor_research": {
      if (o.competitors && o.competitors.length === 0) problems.push("competitors, when present, must be non-empty");
      break;
    }
    case "creative_revision": {
      if (o.revisionTarget !== undefined && o.revisionTarget.length > 40) {
        problems.push("revisionTarget is too long");
      }
      break;
    }
    default:
      break;
  }
  return problems;
}

export function validateClassification(c: unknown): Classification | null {
  if (!c || typeof c !== "object") return null;
  const obj = c as Record<string, unknown>;
  if (!INTENTS.includes(obj.primary as AdsIntent)) return null;
  if (!Array.isArray(obj.steps) || obj.steps.length === 0 || obj.steps.length > 6) return null;
  const steps: PlanStep[] = [];
  for (const s of obj.steps) {
    if (!s || typeof s !== "object" || !INTENTS.includes((s as Record<string, unknown>).type as AdsIntent)) return null;
    const type = (s as Record<string, unknown>).type as AdsIntent;
    const raw = (s as Record<string, unknown>).options ?? {};
    if (typeof raw !== "object") return null;
    const o = raw as Record<string, unknown>;
    const options: StepOptions = {};
    if (typeof o.format === "string" && (o.format === "image" || o.format === "video")) options.format = o.format;
    if (typeof o.durationSeconds === "number") options.durationSeconds = Math.round(o.durationSeconds);
    if (typeof o.conceptCount === "number") options.conceptCount = Math.round(o.conceptCount);
    if (Array.isArray(o.competitors)) options.competitors = o.competitors.filter((x): x is string => typeof x === "string").slice(0, 5);
    if (typeof o.platform === "string") options.platform = o.platform.slice(0, 40);
    if (typeof o.revisionTarget === "string") options.revisionTarget = o.revisionTarget.slice(0, 40);
    if (typeof o.query === "string") options.query = o.query.slice(0, 200);
    const step: PlanStep = { type, options };
    if (validateStep(step).length) return null;
    steps.push(step);
  }
  const clarification = typeof obj.clarification === "string" && obj.clarification.length ? obj.clarification : null;
  return { primary: obj.primary as AdsIntent, steps, clarification };
}

// ---------------------------------------------------------------------------
// Deterministic classifier
// ---------------------------------------------------------------------------

interface Marker {
  type: AdsIntent;
  index: number;
  options: StepOptions;
}

export function classifyLocal(text: string): Classification {
  const raw = text ?? "";
  const t = raw.toLowerCase();
  const markers: Marker[] = [];

  const push = (type: AdsIntent, index: number, options: StepOptions) => {
    const existing = markers.find((m) => m.type === type && m.index === index);
    if (!existing) markers.push({ type, index, options });
  };

  // --- explicit image ad ---
  const imageMatch = t.search(/\bimage ad\b|\bstatic ad\b|\bpicture ad\b|\bgraphic ad\b|\bstill ad\b/);
  if (imageMatch >= 0) push("image_ad", imageMatch, { format: "image", platform: parsePlatform(t) });

  // --- explicit video ad ---
  const videoMatch = t.search(/\bvideo ad\b|\bcommercial\b|(\b\d{1,2}\s*(?:-|\s)?\s*second\b)|\bmotion ad\b|\bmontage\b|\b(\d{1,2}\s*-?\s*second video)\b/);
  if (videoMatch >= 0) push("video_ad", videoMatch, { format: "video", durationSeconds: parseDurationSeconds(t), platform: parsePlatform(t) });

  // --- explicit concepts / ideation ---
  const conceptMatch = t.search(/\bconcepts?\b|\bideas?\b|\bangles\b/);
  if (conceptMatch >= 0) push("campaign_ideation", conceptMatch, { conceptCount: parseConceptCount(t) ?? 3 });

  // --- explicit research ---
  const researchMatch = t.search(/\bresearch\b|\bcompetitors?\b|\bad librar|\bwhat are .* (running|sport)s apps (doing|advertising)/);
  if (researchMatch >= 0) {
    push("competitor_research", researchMatch, { competitors: parseCompetitors(t), platform: parsePlatform(t) });
    // Combined phrasing — "research X before creating our campaign" — carries a
    // creation verb later in the sentence. Creation stays AFTER research,
    // regardless of how the sentence is decorated.
    const createAfterResearch = /\b(create|create|making|make|creating|develop|designing|design)\b/.exec(t.slice(researchMatch + 1));
    if (createAfterResearch) {
      push("campaign_ideation", researchMatch + 1 + (createAfterResearch.index ?? 0), { conceptCount: parseConceptCount(t) ?? 3 });
    }
  }

  // --- revision of existing creative ---
  const revisMatch = t.search(/\bimprove\b|\brework\b|\brevise\b|\bmake .* better\b|\bchanging the\b|\bfix the\b/);
  if (revisMatch >= 0) push("creative_revision", revisMatch, { revisionTarget: parseRevisionTarget(t) });

  // --- library access ---
  const libMatch = t.search(/\b(insert|open|show|search) (the )?(asset )?library\b/);
  if (libMatch >= 0) push("asset_library", libMatch, { query: raw.slice(0, 200) });

  // --- analyse: campaign results, performance, what experiment next. This is
  // NOT research (competitor evidence) and NOT ideation (new concepts).
  const analyseMatch = t.search(/\b(show|get|pull|evaluate|assess) .*\bresults?\b|\bhow is .*\bcampaign\b|\bcampaign (performance|results|report)|(\bshow|get) .*metric/);
  if (analyseMatch >= 0) push("campaign_analyse", analyseMatch, { query: raw.slice(0, 200) });

  // --- compare concepts/creatives routes into analyse with the query kept —
  // the workspace surfaces what evidence actually exists rather than inventing
  // a winner from a small sample.
  const compareMatch = t.search(/\bcompar(e|ing)\b/);
  if (compareMatch >= 0) push("campaign_analyse", compareMatch, { query: raw.slice(0, 200) });

  // --- export: "export the final video", "download the finished ad".
  const exportMatch = t.search(/\bexport\b|\bdownload\b/);
  if (exportMatch >= 0) push("export_asset", exportMatch, { query: raw.slice(0, 200), format: /\bvideo\b/.test(t) ? "video" : /\bimage\b/.test(t) ? "image" : undefined });

  // --- publish/spend language is never a generation step: publishing to ad
  // platforms is not connected, so these route to a question answered honestly.
  // Budget mentions alone are NOT captured — budget is a real, editable field
  // on campaigns; only explicit publish/go-live/spend phrasing routes here.
  const publishMatch = t.search(/\bpublish\b|\bgo live\b|\bput (it |this |the )?(money|spend) behind\b|\bsponso(u)?r(ed)? placement\b|\brun (this|it|the) (ad|campaign)\b/);
  if (publishMatch >= 0 && !markers.length) {
    return {
      primary: "platform_question",
      steps: [{ type: "platform_question", options: { query: raw.slice(0, 200) } }],
      clarification: null,
    };
  }

  // Distinct concept-only "give me five concepts" without research/ads → ideation.
  if (!markers.length && /\b(give me|make|create|generate|need|want)\b/.test(t)) {
    push("campaign_ideation", 0, { conceptCount: parseConceptCount(t) ?? 3 });
  }

  if (markers.length) {
    markers.sort((a, b) => a.index - b.index);
    const primary =
      markers.find((m) => m.type === "image_ad" || m.type === "video_ad")?.type ??
      markers[0].type;
    const steps: PlanStep[] = markers.map((m) => ({ type: m.type, options: sanitizeOptions(m.type, m.options) }));
    return { primary, steps, clarification: null };
  }

  // Safer triage for a question vs total ambiguity.
  if (/\?$/.test(raw.trim()) || /^\s*(what|why|how|can|does|do|is|are|which|when)\b/i.test(raw.trim())) {
    return { primary: "platform_question", steps: [{ type: "platform_question", options: { query: raw.slice(0, 200) } }], clarification: null };
  }
  return { primary: "campaign_ideation", steps: [{ type: "campaign_ideation", options: { conceptCount: 3 } }], clarification: CLARIFYING_QUESTION };
}

function sanitizeOptions(type: AdsIntent, o: StepOptions): StepOptions {
  const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(n)));
  const out: StepOptions = {};
  switch (type) {
    case "image_ad":
      out.format = "image";
      if (o.platform) out.platform = o.platform;
      return out;
    case "video_ad":
      out.format = "video";
      if (o.durationSeconds !== undefined) out.durationSeconds = clamp(o.durationSeconds, 6, 60);
      if (o.platform) out.platform = o.platform;
      return out;
    case "campaign_ideation":
      out.conceptCount = o.conceptCount !== undefined ? clamp(o.conceptCount, 1, 5) : 3;
      return out;
    case "competitor_research":
      if (o.competitors) out.competitors = o.competitors.slice(0, 5);
      if (o.platform) out.platform = o.platform;
      return out;
    case "creative_revision":
      if (o.revisionTarget) out.revisionTarget = o.revisionTarget;
      return out;
    case "asset_library":
      if (o.query) out.query = o.query;
      return out;
    case "campaign_analyse":
      if (o.query) out.query = o.query;
      return out;
    case "export_asset":
      if (o.query) out.query = o.query;
      if (o.format === "image" || o.format === "video") out.format = o.format;
      return out;
    default:
      if (o.query) out.query = o.query;
      return out;
  }
}

export { CLARIFYING_QUESTION };
