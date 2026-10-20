/**
 * voiceover — ElevenLabs narration for Vaylo Ads.
 *
 * Four actions:
 *   list      → the styles and the account's real voices (never the key)
 *   validate  → brand-rule check on a script; free, no provider call
 *   draft     → write a script with OpenAI, then validate it
 *   generate  → narrate it with ElevenLabs, returning MP3 bytes
 *
 * WHY THE AUDIO COMES BACK AS BYTES
 *
 * There is no storage bucket in this project, and a service-role key is not
 * available to create one. So generation returns base64 audio the client can
 * play, save and hand straight to the render worker, which accepts a data URL
 * for its voiceover input. Nothing is silently written anywhere.
 *
 * COST POSTURE
 *
 * ElevenLabs bills per character. This function therefore:
 *   - refuses a script above ELEVENLABS_MAX_CHARACTERS (default 5000),
 *   - reports the billed character count with every result,
 *   - de-duplicates identical requests, so a retry is not billed twice,
 *   - never falls back to a more expensive model on failure.
 * The account's remaining quota cannot be read: this key is scoped without
 * `user_read`. That is reported rather than guessed at.
 */

import { aiCallAllowed, authenticate, readJsonBody, spendForUser } from "../_shared/guard.ts";
import {
  ALLOWED_MODELS,
  DEFAULT_VOICE_SETTINGS,
  ELEVENLABS_MODELS,
  MAX_CHARACTERS,
  STYLE_IDS,
  VOICEOVER_STYLES,
  billedCharacters,
  buildTtsRequest,
  describeElevenLabsError,
  parseVoices,
  validateScript,
  voiceoverCacheKey,
  type VoiceOutputFormat,
  type VoiceSettings,
} from "../_shared/elevenlabs.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY");
// Vaylo Ads, so ad spend is metered on its own OpenAI project: prefer
// ADS_OPENAI_API_KEY, fall back to the app key (see ad-agent).
const OPENAI_API_KEY = Deno.env.get("ADS_OPENAI_API_KEY") ?? Deno.env.get("OPENAI_API_KEY");
const ELEVENLABS_BASE = "https://api.elevenlabs.io/v1";
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
/** Verified at integration time: the Responses API accepts function-free text. */
const DRAFT_MODEL = Deno.env.get("VOICEOVER_DRAFT_MODEL") ?? "gpt-6-luna";

const characterLimit = (() => {
  const configured = Number(Deno.env.get("ELEVENLABS_MAX_CHARACTERS") ?? "");
  return Number.isFinite(configured) && configured > 0 ? configured : MAX_CHARACTERS;
})();

/**
 * Per-isolate cache of recently generated audio.
 *
 * Deliberately small and disposable: it exists to stop a double-click or a
 * retried request being billed twice, not to be a library. A durable store would
 * need the storage bucket this project does not have yet.
 */
const audioCache = new Map<string, { audio: string; mimeType: string; characters: number; createdAt: number }>();
const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_MAX_ENTRIES = 40;

function rememberInCache(key: string, value: { audio: string; mimeType: string; characters: number }) {
  if (audioCache.size >= CACHE_MAX_ENTRIES) {
    const oldest = [...audioCache.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt)[0];
    if (oldest) audioCache.delete(oldest[0]);
  }
  audioCache.set(key, { ...value, createdAt: Date.now() });
}

const VOICEOVER_DRAFT_RULES = `You write narration scripts for Vaylo Sports advertising.

Vaylo Sports is an all-sports training and performance-improvement app for athletes aged roughly 18-30. Slogan: "Learn smarter. Train better. Perform better." The brand is premium sports technology: dark navy and black, restrained purple accents, modern, competitive, credible. It must never sound like a generic AI startup, a supplement brand or a gambling product.

Write ONE narration script that will be read aloud. Rules:
- Concise sentences. Natural spoken phrasing, easy to pronounce.
- No stage directions, no speaker labels, no quotation marks around the whole script, no scene descriptions.
- Never state a price, a free trial, a discount or a monthly cost: there is no checkout.
- Never claim AI features; they are not switched on.
- Never promise athletic results, injury prevention or prediction, and never claim clinical proof.
- Never invent statistics, percentages, testimonials or reviews.
- Never name wearables, health sync or the coach marketplace; all are off at launch.
- Do not fabricate app screens or features.
Return only the script text.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const userId = await authenticate(req);
    if (!userId) return json({ error: "Unauthorized" }, 401);
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const body = await readJsonBody(req);
    if (!body) return json({ error: "Invalid request body" }, 400);

    const action = typeof body.action === "string" ? body.action : "";

    // ---- validate: free, no provider call ---------------------------------
    if (action === "validate") {
      const text = typeof body.text === "string" ? body.text : "";
      return json({ action, ...validateScript(text), characters: billedCharacters(text) });
    }

    if (!ELEVENLABS_API_KEY) {
      // An honest answer, not a silent mock.
      return json(
        {
          error: "Voiceovers are not configured on this deployment (ELEVENLABS_API_KEY is missing).",
          code: "not_configured",
        },
        503,
      );
    }

    // ---- list: the real voices, and the styles ----------------------------
    if (action === "list") {
      const res = await fetch(`${ELEVENLABS_BASE}/voices`, { headers: { "xi-api-key": ELEVENLABS_API_KEY } });
      if (!res.ok) {
        const described = describeElevenLabsError(res.status, await res.json().catch(() => ({})));
        console.error(`[voiceover] list failed status=${res.status} code=${described.code}`);
        return json({ error: described.error, code: described.code }, 502);
      }
      const voices = parseVoices(await res.json());
      return json({
        action,
        voices,
        styles: Object.values(VOICEOVER_STYLES),
        models: ALLOWED_MODELS,
        limits: { maxCharacters: characterLimit },
        // Stated plainly, because the UI should not imply a quota it cannot see.
        quotaVisibility: {
          readable: false,
          note: "This ElevenLabs key is scoped without user_read, so the plan and remaining character quota cannot be read. Usage is tracked per request instead.",
        },
      });
    }

    // ---- draft: OpenAI writes the script, then the brand rules check it ----
    if (action === "draft") {
      if (!OPENAI_API_KEY) return json({ error: "OpenAI is not configured on this deployment.", code: "not_configured" }, 503);
      if (!(await aiCallAllowed(req, userId, "voiceover-draft", { max: 20, windowSeconds: 60 }))) {
        return json({ error: "Too many script drafts. Wait a moment and try again." }, 429);
      }

      const styleId = typeof body.styleId === "string" ? body.styleId : "";
      const style = VOICEOVER_STYLES[styleId];
      if (!style) return json({ error: `styleId must be one of: ${STYLE_IDS.join(", ")}` }, 400);

      const brief = typeof body.brief === "string" ? body.brief.trim().slice(0, 600) : "";

      const res = await fetch(OPENAI_RESPONSES_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: DRAFT_MODEL,
          instructions: VOICEOVER_DRAFT_RULES,
          input: [
            {
              role: "user",
              content:
                `Style: ${style.label} — ${style.intent}\n` +
                `Guidance: ${style.scriptGuidance}\n` +
                `Target length: about ${style.targetSeconds} seconds of speech.\n` +
                (brief ? `What it is about: ${brief}` : "Choose a relevant angle for the brand."),
            },
          ],
        }),
      });

      if (!res.ok) {
        // The body is never echoed; only the status is logged.
        console.error(`[voiceover] draft failed status=${res.status}`);
        return json({ error: `OpenAI returned ${res.status}.`, code: "provider_error" }, 502);
      }

      const payload = (await res.json()) as { output?: Array<Record<string, unknown>> };
      const text = (payload.output ?? [])
        .filter((item) => item.type === "message")
        .flatMap((item) => (Array.isArray(item.content) ? item.content : []))
        .map((part) => (part as { text?: unknown }).text)
        .filter((t): t is string => typeof t === "string")
        .join("")
        .trim();

      if (!text) return json({ error: "The model returned no script.", code: "empty_result" }, 502);

      return json({ action, styleId, text, ...validateScript(text), characters: billedCharacters(text) });
    }

    // ---- generate: the paid call -----------------------------------------
    if (action !== "generate") {
      return json({ error: "action must be one of: list, validate, draft, generate" }, 400);
    }

    if (!(await aiCallAllowed(req, userId, "voiceover", { max: 20, windowSeconds: 60 }))) {
      return json({ error: "Too many voiceover requests. Wait a moment and try again." }, 429);
    }

    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) return json({ error: "text is required" }, 400);

    const characters = billedCharacters(text);
    if (characters > characterLimit) {
      return json(
        {
          error: `That script is ${characters} characters, over the ${characterLimit} limit. Shorten it or raise ELEVENLABS_MAX_CHARACTERS.`,
          code: "too_long",
        },
        400,
      );
    }

    // Brand rules are enforced before anything is billed, not after.
    const rules = validateScript(text);
    if (!rules.ok && body.allowUnsafe !== true) {
      return json(
        {
          error: "This script breaks the brand rules.",
          code: "brand_rules",
          violations: rules.violations,
          hint: "Edit the script, or pass allowUnsafe: true to override after review.",
        },
        400,
      );
    }

    const styleId = typeof body.styleId === "string" ? body.styleId : "";
    const style = styleId ? VOICEOVER_STYLES[styleId] : undefined;
    if (styleId && !style) return json({ error: `styleId must be one of: ${STYLE_IDS.join(", ")}` }, 400);

    const voiceId = typeof body.voiceId === "string" && body.voiceId.trim()
      ? body.voiceId.trim()
      : style?.voiceId;
    if (!voiceId) return json({ error: "voiceId is required, or choose a style that supplies one" }, 400);

    const modelId = typeof body.modelId === "string" && body.modelId.trim()
      ? body.modelId.trim()
      : style?.modelId ?? ELEVENLABS_MODELS.FLASH;

    const settings: Partial<VoiceSettings> = {
      ...(style?.settings ?? DEFAULT_VOICE_SETTINGS),
      ...((body.settings ?? {}) as Partial<VoiceSettings>),
    };

    const outputFormat: VoiceOutputFormat =
      body.outputFormat === "mp3_44100_192" || body.outputFormat === "pcm_44100" ? body.outputFormat : "mp3_44100_128";

    let requestBody: Record<string, unknown>;
    try {
      requestBody = buildTtsRequest({ text, modelId, settings, outputFormat });
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : "invalid request" }, 400);
    }

    // Duplicate prevention: identical input returns the same audio uncharged.
    const cacheKey = voiceoverCacheKey(voiceId, { text, modelId, settings, outputFormat });
    const cached = audioCache.get(cacheKey);
    if (cached && Date.now() - cached.createdAt < CACHE_TTL_MS) {
      return json({
        action,
        cacheKey,
        cached: true,
        voiceId,
        modelId,
        outputFormat,
        mimeType: cached.mimeType,
        characters: cached.characters,
        audio: cached.audio,
      });
    }

    // Beta cost control (placed AFTER the cache lookup on purpose): a narration
    // billed by ElevenLabs is metered in the same credit ledger as every other
    // AI feature, for every plan type. An identical re-request answers from the
    // cache above uncharged, so a retry cannot double-bill the same audio.
    const metered = await spendForUser(req, userId, "ads_video_narration", `Ad narration (${characters} chars)`, {
      source: "voiceover",
      billUnlimited: true,
      idempotencyKey: `vo:${cacheKey}`,
    });
    if (!metered.success) {
      return json(
        {
          error: metered.error === "insufficient_credits"
            ? `Not enough credits for the narration (${metered.cost ?? "?"} needed; you have ${metered.balance ?? 0}). Nothing was charged.`
            : metered.error ?? "Could not record the credit charge",
          code: metered.error === "insufficient_credits" ? "insufficient_credits" : "metering_failed",
        },
        metered.error === "insufficient_credits" ? 402 : 500,
      );
    }

    const res = await fetch(`${ELEVENLABS_BASE}/text-to-speech/${encodeURIComponent(voiceId)}`, {
      method: "POST",
      headers: {
        "xi-api-key": ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify(requestBody),
    });

    if (!res.ok) {
      const detail = await res.json().catch(() => ({}));
      const described = describeElevenLabsError(res.status, detail);
      console.error(`[voiceover] tts failed status=${res.status} code=${described.code}`);
      return json({ error: described.error, code: described.code }, described.status === 429 ? 429 : 502);
    }

    const mimeType = (res.headers.get("content-type") ?? "audio/mpeg").split(";")[0];
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength === 0) {
      console.error("[voiceover] tts returned an empty body");
      return json({ error: "ElevenLabs returned no audio.", code: "empty_result" }, 502);
    }

    // Base64 without a data-URL prefix: the client can play it directly and the
    // worker accepts it as `data:audio/mpeg;base64,<audio>`.
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    const audio = btoa(binary);

    rememberInCache(cacheKey, { audio, mimeType, characters });

    return json({
      action,
      cacheKey,
      cached: false,
      voiceId,
      modelId,
      styleId: styleId || null,
      outputFormat,
      mimeType,
      bytes: bytes.byteLength,
      characters,
      audio,
    });
  } catch (err) {
    console.error("[voiceover] unhandled", err);
    return json({ error: "Voiceover generation failed.", code: "unhandled" }, 500);
  }
});
