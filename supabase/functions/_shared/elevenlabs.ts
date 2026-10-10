// ============================================================================
// ELEVENLABS — the voiceover provider adapter.
// ----------------------------------------------------------------------------
// Modular on purpose: the render pipeline consumes AUDIO BYTES, not a vendor.
// If the voice provider changes, this file is replaced and `renderPlan.ts`,
// `ad-video` and the worker are untouched.
//
// Everything below was established by calling the live API with this project's
// key, not copied from documentation:
//
//   GET  /v1/voices               200  — 21 voices are available
//   GET  /v1/user                 401  — missing permission: user_read
//   GET  /v1/models               401  — missing permission: models_read
//   POST /v1/text-to-speech/{id}  200  — audio/mpeg
//
// The two 401s matter and are not a bug in this code: the key is SCOPED. It can
// speak, but it cannot enumerate models or read the subscription. That is why
// the model list here is a fixed, TESTED set rather than something discovered at
// runtime, and why cost is reported in CHARACTERS — the unit ElevenLabs bills —
// rather than in a currency this key cannot read.
// ============================================================================

/**
 * Models this key was verified to accept, in preference order.
 *
 * Each was exercised with a real request; a model the account cannot use fails
 * loudly rather than silently falling back, which is the required behaviour
 * ("do not silently switch to more expensive models").
 */
export const ELEVENLABS_MODELS = {
  /** Cheapest and fastest; the default for short social hooks. */
  FLASH: "eleven_flash_v2_5",
  /** Middle tier: good quality, low latency. */
  TURBO: "eleven_turbo_v2_5",
  /** Highest quality, most expensive; for premium brand narration. */
  MULTILINGUAL: "eleven_multilingual_v2",
} as const;

export type ElevenLabsModel = (typeof ELEVENLABS_MODELS)[keyof typeof ELEVENLABS_MODELS];

export const ALLOWED_MODELS: string[] = Object.values(ELEVENLABS_MODELS);

/** Output formats this project supports. MP3 is what the render worker accepts. */
export type VoiceOutputFormat = "mp3_44100_128" | "mp3_44100_192" | "pcm_44100";

/**
 * Per-request ceiling. ElevenLabs bills per character, so this is a cost limit.
 *
 * A plain constant rather than an env read, because every module in `_shared` is
 * Deno-free so it stays unit-testable. The edge function may override it from
 * ELEVENLABS_MAX_CHARACTERS and passes the effective limit in explicitly.
 */
export const MAX_CHARACTERS = 5000;

export interface VoiceSettings {
  /** 0-1. Higher = more consistent take, less expressive. */
  stability: number;
  /** 0-1. Higher = closer to the source voice. */
  similarityBoost: number;
  /** 0-1. Voice "punch"; useful on energetic sports reads. */
  style: number;
  /** Applies a speaker boost; subtle clarity gain. */
  useSpeakerBoost: boolean;
}

/**
 * Sensible defaults. Stability is deliberately mid-high and style low: an
 * over-styled read is the fastest way for an advert to sound like a novelty.
 */
export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  stability: 0.5,
  similarityBoost: 0.75,
  style: 0.15,
  useSpeakerBoost: true,
};

export interface TtsRequestInput {
  text: string;
  modelId?: string;
  settings?: Partial<VoiceSettings>;
  outputFormat?: VoiceOutputFormat;
  /** BCP-47 code; only meaningful on multilingual models. */
  languageCode?: string;
}

const clamp01 = (value: unknown, fallback: number): number => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0, n));
};

/** Build the `/v1/text-to-speech/{voice_id}` body. */
export function buildTtsRequest(input: TtsRequestInput): Record<string, unknown> {
  const text = String(input.text ?? "").trim();
  if (!text) throw new Error("text is required");

  const modelId = input.modelId ?? ELEVENLABS_MODELS.FLASH;
  if (!ALLOWED_MODELS.includes(modelId)) {
    // Refused rather than forwarded: an unknown model would either fail or, on
    // some accounts, route to something more expensive than intended.
    throw new Error(`unsupported model: ${modelId}`);
  }

  const s = input.settings ?? {};
  const voiceSettings: Record<string, unknown> = {
    stability: clamp01(s.stability, DEFAULT_VOICE_SETTINGS.stability),
    similarity_boost: clamp01(s.similarityBoost, DEFAULT_VOICE_SETTINGS.similarityBoost),
    style: clamp01(s.style, DEFAULT_VOICE_SETTINGS.style),
    use_speaker_boost: s.useSpeakerBoost ?? DEFAULT_VOICE_SETTINGS.useSpeakerBoost,
  };

  const body: Record<string, unknown> = { text, model_id: modelId, voice_settings: voiceSettings };
  if (input.languageCode && /^[a-z]{2}(-[A-Z]{2})?$/.test(input.languageCode)) {
    body.language_code = input.languageCode;
  }
  return body;
}

/**
 * Characters billed for this request.
 *
 * This is the unit ElevenLabs actually charges in. `user_read` is denied to this
 * key, so the account's plan and remaining quota cannot be read — reporting
 * characters is the honest measure available, and no dollar figure is invented.
 */
export function billedCharacters(text: string): number {
  return String(text ?? "").trim().length;
}

/**
 * A stable key for an identical generation.
 *
 * Used for duplicate prevention: the same script, voice, model and settings
 * describe the same audio, so a retry should not be billed a second time.
 */
export function voiceoverCacheKey(voiceId: string, input: TtsRequestInput): string {
  const s = { ...DEFAULT_VOICE_SETTINGS, ...(input.settings ?? {}) };
  const material = [
    voiceId,
    input.modelId ?? ELEVENLABS_MODELS.FLASH,
    input.outputFormat ?? "mp3_44100_128",
    String(input.text ?? "").trim(),
    s.stability,
    s.similarityBoost,
    s.style,
    s.useSpeakerBoost,
  ].join("|");
  // djb2 — small, dependency-free, and only needs to be stable, not secure.
  let hash = 5381;
  for (let i = 0; i < material.length; i++) hash = ((hash << 5) + hash + material.charCodeAt(i)) | 0;
  return `vo_${(hash >>> 0).toString(36)}`;
}

export interface VoiceSummary {
  voiceId: string;
  name: string;
  category: string | null;
  gender: string | null;
  accent: string | null;
  useCase: string | null;
  description: string | null;
}

/** Read the voices list, tolerating missing fields. */
export function parseVoices(body: unknown): VoiceSummary[] {
  const list = (body as { voices?: unknown })?.voices;
  if (!Array.isArray(list)) return [];
  return list
    .map((raw) => {
      const v = raw as Record<string, unknown>;
      const labels = (v.labels ?? {}) as Record<string, unknown>;
      const id = typeof v.voice_id === "string" ? v.voice_id : null;
      if (!id) return null;
      const str = (x: unknown) => (typeof x === "string" && x.trim() ? x.trim() : null);
      return {
        voiceId: id,
        name: str(v.name) ?? id,
        category: str(v.category),
        gender: str(labels.gender),
        accent: str(labels.accent),
        useCase: str(labels.use_case),
        description: str(v.description),
      } satisfies VoiceSummary;
    })
    .filter((v): v is VoiceSummary => v !== null);
}

/**
 * Strip anything credential-shaped from text that may be shown to a user.
 *
 * Provider errors occasionally quote the request back, and this module is the
 * last place before such a string reaches a response body or a log. ElevenLabs
 * keys look like `sk_...`, so those are removed along with anything long and
 * opaque that follows a "key" or "token" label.
 */
export function redactSecrets(text: string): string {
  return String(text)
    .replace(/\bsk_[A-Za-z0-9_-]{8,}/g, "[redacted]")
    .replace(/((?:api[_-]?key|token|authorization)\s*[:=]\s*)\S+/gi, "$1[redacted]")
    .slice(0, 300);
}

/** Read the `detail` shape ElevenLabs returns on failure. */
export function parseElevenLabsError(body: unknown): { status?: string; code?: string; message: string } {
  const detail = (body as { detail?: unknown })?.detail;
  if (typeof detail === "string") return { message: detail };
  const d = (detail ?? {}) as Record<string, unknown>;
  const str = (x: unknown) => (typeof x === "string" && x.trim() ? x.trim() : undefined);
  return {
    status: str(d.status),
    code: str(d.code),
    message: str(d.message) ?? "the voice provider rejected the request",
  };
}

/**
 * Turn a provider failure into something actionable.
 *
 * `missing_permissions` is separated from a bad key on purpose: the fix is to
 * add a scope in the ElevenLabs dashboard, not to replace the credential.
 */
export function describeElevenLabsError(
  status: number,
  body: unknown,
): { error: string; code: string; status: number } {
  const parsed = parseElevenLabsError(body);

  if (status === 401 || status === 403) {
    if (parsed.status === "missing_permissions" || /permission/i.test(parsed.message)) {
      return {
        code: "missing_permissions",
        status: 502,
        error: `The ElevenLabs key is valid but lacks a required permission: ${redactSecrets(parsed.message)}`,
      };
    }
    return { code: "credentials_rejected", status: 502, error: "ElevenLabs rejected the API key." };
  }
  // An unknown voice id produced `400` in a live test, not the `404` the shape
  // of the API suggests, and the generic branch turned that into a useless
  // "ElevenLabs returned 400". Both are mapped to a message naming the fix.
  if (status === 400 || status === 404) {
    const aboutVoice = /voice/i.test(parsed.message);
    return {
      code: aboutVoice || status === 404 ? "voice_not_found" : "invalid_request",
      status: 400,
      error:
        aboutVoice || status === 404
          ? "That voice is not available on this account. Choose one from the voices list."
          : `ElevenLabs rejected the request: ${redactSecrets(parsed.message)}`,
    };
  }
  if (status === 422) {
    return { code: "invalid_request", status: 400, error: `ElevenLabs rejected the request: ${redactSecrets(parsed.message)}` };
  }
  if (status === 429) {
    const quota = /quota|credit/i.test(parsed.message);
    return {
      code: quota ? "quota_exceeded" : "rate_limited",
      status: 429,
      error: quota
        ? "The ElevenLabs character quota is used up. Top up the plan in the ElevenLabs dashboard."
        : "ElevenLabs is rate limiting this account. Try again shortly.",
    };
  }
  return { code: "provider_error", status: 502, error: `ElevenLabs returned ${status}.` };
}

// ---------------------------------------------------------------------------
// Vaylo voiceover styles
// ---------------------------------------------------------------------------

export interface VoiceoverStyle {
  id: string;
  label: string;
  /** What this read is for, shown in the UI. */
  intent: string;
  /** A verified voice that suits it. */
  voiceId: string;
  voiceName: string;
  modelId: string;
  settings: VoiceSettings;
  /** Guidance handed to OpenAI when writing a script for this style. */
  scriptGuidance: string;
  /** Target length, so a read fits the placement. */
  targetSeconds: number;
}

/**
 * The five styles from the brief, mapped onto voices that actually exist on this
 * account (verified from `/v1/voices`).
 *
 * Every guidance string carries the brand's refusal rules, because a generated
 * script is the thing most likely to invent a statistic or promise a result.
 */
export const VOICEOVER_STYLES: Record<string, VoiceoverStyle> = {
  high_energy: {
    id: "high_energy",
    label: "High-energy sports",
    intent: "Fast, competitive hook for a paid social placement.",
    voiceId: "TX3LPaxmHKxFdv7VOQHJ",
    voiceName: "Liam — Energetic, Social Media Creator",
    modelId: ELEVENLABS_MODELS.FLASH,
    settings: { stability: 0.35, similarityBoost: 0.75, style: 0.45, useSpeakerBoost: true },
    scriptGuidance:
      "One to two short, punchy sentences with a strong opening hook. Present tense, second person. " +
      "No promises about results or performance, no statistics, no testimonials.",
    targetSeconds: 8,
  },
  premium_tech: {
    id: "premium_tech",
    label: "Premium sports technology",
    intent: "Confident brand spot; the read that carries the Vaylo identity.",
    voiceId: "JBFqnCBsd6RMkjVDRZzb",
    voiceName: "George — Warm, Captivating Storyteller",
    modelId: ELEVENLABS_MODELS.MULTILINGUAL,
    settings: { stability: 0.55, similarityBoost: 0.8, style: 0.1, useSpeakerBoost: true },
    scriptGuidance:
      "Two measured sentences. Confident and understated; never a hard sell. " +
      "Describe what the app does, not how much better the athlete will become.",
    targetSeconds: 12,
  },
  credible_education: {
    id: "credible_education",
    label: "Credible performance education",
    intent: "Explains a training idea; earns trust rather than demanding action.",
    voiceId: "Xb7hH8MSUJpSbSDYk0k2",
    voiceName: "Alice — Clear, Engaging Educator",
    modelId: ELEVENLABS_MODELS.MULTILINGUAL,
    settings: { stability: 0.6, similarityBoost: 0.8, style: 0.05, useSpeakerBoost: true },
    scriptGuidance:
      "One clear explanation in plain language. Be accurate and specific about what the app records and shows. " +
      "Never make a health, injury-prevention or medical claim.",
    targetSeconds: 15,
  },
  social_hook: {
    id: "social_hook",
    label: "Short-form social hook",
    intent: "The first three seconds of a Reel or Short.",
    voiceId: "FGY2WhTYpPnrIDTdsKH5",
    voiceName: "Laura — Enthusiast, Quirky Attitude",
    modelId: ELEVENLABS_MODELS.FLASH,
    settings: { stability: 0.3, similarityBoost: 0.7, style: 0.5, useSpeakerBoost: true },
    scriptGuidance:
      "A single sentence of at most twelve words that earns the next three seconds. " +
      "No price, no trial, no discount, no guarantee.",
    targetSeconds: 5,
  },
  product_demo: {
    id: "product_demo",
    label: "Product demonstration",
    intent: "Narration over screen recordings of the app.",
    voiceId: "XrExE9yKIg1WjnnlVkGX",
    voiceName: "Matilda — Knowledgeable, Professional",
    modelId: ELEVENLABS_MODELS.TURBO,
    settings: { stability: 0.55, similarityBoost: 0.8, style: 0.1, useSpeakerBoost: true },
    scriptGuidance:
      "Step-by-step narration that describes exactly what is on screen. Do not describe screens or " +
      "features that were not supplied as recordings.",
    targetSeconds: 20,
  },
};

export const STYLE_IDS = Object.keys(VOICEOVER_STYLES);

/**
 * Claims the brand rules forbid in narration.
 *
 * Mirrors the ad slate's compliance list and the `ad-agent` system prompt, so a
 * script can be refused in three places: when OpenAI writes it, when the athlete
 * edits it, and here before anything is billed.
 */
export const FORBIDDEN_SCRIPT_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\bAI[- ]powered\b|\bAI coach\b/i, reason: "AI capabilities are not switched on in the app" },
  { pattern: /\b(free trial|only \$|per month|monthly|discount|% off|price)\b/i, reason: "there is no checkout or pricing yet" },
  { pattern: /\b(guarantee[ds]?|will make you|bulletproof|never get injured)\b/i, reason: "results and injury prevention cannot be promised" },
  { pattern: /\b(clinically proven|doctor[- ]recommended|scientifically proven)\b/i, reason: "clinical claims are not supported" },
  // Note the boundary handling: a trailing \b after `%` can never match, since
  // `%` is not a word character — that made the percentage branch dead code and
  // let "Run 30% faster" through. The guard is on the digits instead.
  { pattern: /\d{1,3}\s?%|\b\d+ (times|percent) (faster|better|stronger)\b/i, reason: "invented statistics are forbidden" },
  { pattern: /\b(athletes say|testimonial|reviewers? (say|agree))\b/i, reason: "testimonials must not be fabricated" },
];

/**
 * Check a script against the brand rules.
 *
 * Returns a reason rather than throwing, so the UI can show the athlete exactly
 * what to change instead of just refusing.
 */
export function validateScript(text: string): { ok: boolean; violations: string[] } {
  const violations: string[] = [];
  for (const { pattern, reason } of FORBIDDEN_SCRIPT_PATTERNS) {
    if (pattern.test(text)) violations.push(reason);
  }
  return { ok: violations.length === 0, violations };
}
