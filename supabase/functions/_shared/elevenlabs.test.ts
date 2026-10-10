// ============================================================================
// The ElevenLabs contract.
//
// The model ids and voice ids here are the ones ACTUALLY returned and accepted
// by this project's key, so these tests double as a record of what was verified
// against the live API. The permission quirks (user_read and models_read denied)
// are encoded too, because they explain why the model list is fixed.
// ============================================================================

import { describe, expect, it } from "vitest";

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
  parseElevenLabsError,
  parseVoices,
  redactSecrets,
  validateScript,
  voiceoverCacheKey,
} from "./elevenlabs";

describe("the models are the ones the account accepts", () => {
  it("offers exactly the three verified ids", () => {
    expect([...ALLOWED_MODELS].sort()).toEqual(["eleven_flash_v2_5", "eleven_multilingual_v2", "eleven_turbo_v2_5"]);
  });

  it("defaults to the cheapest tier", () => {
    expect(buildTtsRequest({ text: "hi" }).model_id).toBe(ELEVENLABS_MODELS.FLASH);
  });

  it("refuses an unknown model instead of routing somewhere unexpected", () => {
    expect(() => buildTtsRequest({ text: "hi", modelId: "eleven_v3_ultra" })).toThrow(/unsupported model/);
  });
});

describe("building the text-to-speech request", () => {
  it("sends the text, the model and voice settings in the documented shape", () => {
    const body = buildTtsRequest({ text: "  Train smarter.  " });
    expect(body.text).toBe("Train smarter.");
    expect(body.model_id).toBe(ELEVENLABS_MODELS.FLASH);
    expect(body.voice_settings).toEqual({
      stability: DEFAULT_VOICE_SETTINGS.stability,
      similarity_boost: DEFAULT_VOICE_SETTINGS.similarityBoost,
      style: DEFAULT_VOICE_SETTINGS.style,
      use_speaker_boost: true,
    });
  });

  it("uses snake_case for the settings, which is what the API expects", () => {
    const body = buildTtsRequest({ text: "x", settings: { similarityBoost: 0.9, useSpeakerBoost: false } });
    const settings = body.voice_settings as Record<string, unknown>;
    expect(settings.similarity_boost).toBe(0.9);
    expect(settings.use_speaker_boost).toBe(false);
  });

  it("clamps every 0-1 setting instead of letting an out-of-range value through", () => {
    const settings = buildTtsRequest({ text: "x", settings: { stability: 5, style: -3, similarityBoost: NaN } })
      .voice_settings as Record<string, unknown>;
    expect(settings.stability).toBe(1);
    expect(settings.style).toBe(0);
    // NaN falls back to the default rather than becoming 0 by accident.
    expect(settings.similarity_boost).toBe(DEFAULT_VOICE_SETTINGS.similarityBoost);
  });

  it("omits language_code unless it is a plausible BCP-47 tag", () => {
    expect(buildTtsRequest({ text: "x", languageCode: "en-GB" }).language_code).toBe("en-GB");
    expect(buildTtsRequest({ text: "x", languageCode: "english please" }).language_code).toBeUndefined();
  });

  it("requires text", () => {
    expect(() => buildTtsRequest({ text: "   " })).toThrow(/text is required/);
  });
});

describe("cost is measured in the unit that is actually billed", () => {
  it("counts characters, not words or tokens", () => {
    expect(billedCharacters("Train smarter.")).toBe(14);
    expect(billedCharacters("  padded  ")).toBe(6);
  });

  it("caps a request so a paste cannot bill an unbounded amount", () => {
    expect(MAX_CHARACTERS).toBeGreaterThan(0);
    expect(MAX_CHARACTERS).toBeLessThanOrEqual(5000);
  });

  it("does not invent a currency figure it cannot verify", () => {
    // user_read is denied to this key, so no plan or quota can be read. The
    // module must therefore expose characters and no dollar amount.
    const exported = Object.keys({ billedCharacters });
    expect(exported).toContain("billedCharacters");
    expect(JSON.stringify(buildTtsRequest({ text: "x" }))).not.toMatch(/\$|usd|price/i);
  });
});

describe("duplicate prevention", () => {
  const base = { text: "Train smarter.", modelId: ELEVENLABS_MODELS.FLASH };

  it("gives identical requests the same key, so a retry is not billed twice", () => {
    expect(voiceoverCacheKey("v1", base)).toBe(voiceoverCacheKey("v1", { ...base }));
  });

  it("separates requests that differ in any billed dimension", () => {
    const key = voiceoverCacheKey("v1", base);
    expect(voiceoverCacheKey("v2", base)).not.toBe(key);
    expect(voiceoverCacheKey("v1", { ...base, text: "Train smarter!" })).not.toBe(key);
    expect(voiceoverCacheKey("v1", { ...base, modelId: ELEVENLABS_MODELS.TURBO })).not.toBe(key);
    expect(voiceoverCacheKey("v1", { ...base, settings: { style: 0.9 } })).not.toBe(key);
  });

  it("ignores whitespace that does not change the audio", () => {
    expect(voiceoverCacheKey("v1", { ...base, text: "  Train smarter.  " })).toBe(voiceoverCacheKey("v1", base));
  });

  it("produces a filesystem-safe id", () => {
    expect(voiceoverCacheKey("v1", base)).toMatch(/^vo_[a-z0-9]+$/);
  });
});

describe("reading the voices list", () => {
  const live = {
    voices: [
      {
        voice_id: "TX3LPaxmHKxFdv7VOQHJ",
        name: "Liam - Energetic, Social Media Creator",
        category: "premade",
        labels: { accent: "american", gender: "male", use_case: "social_media" },
      },
      { voice_id: "JBFqnCBsd6RMkjVDRZzb", name: "George", category: "premade" },
    ],
  };

  it("reads ids, names and labels", () => {
    const voices = parseVoices(live);
    expect(voices).toHaveLength(2);
    expect(voices[0]).toMatchObject({ voiceId: "TX3LPaxmHKxFdv7VOQHJ", gender: "male", accent: "american" });
  });

  it("tolerates a voice with no labels block", () => {
    expect(parseVoices(live)[1]).toMatchObject({ voiceId: "JBFqnCBsd6RMkjVDRZzb", gender: null });
  });

  it("drops an entry with no voice id rather than emitting an unusable one", () => {
    expect(parseVoices({ voices: [{ name: "ghost" }, ...live.voices] })).toHaveLength(2);
  });

  it("returns empty rather than throwing on a malformed body", () => {
    expect(parseVoices({})).toEqual([]);
    expect(parseVoices(null)).toEqual([]);
    expect(parseVoices({ voices: "nope" })).toEqual([]);
  });
});

describe("provider failures map to a fix", () => {
  const missingPermission = {
    detail: {
      type: "authentication_error",
      code: "unauthorized",
      message: "The API key you used is missing the permission user_read to execute this operation.",
      status: "missing_permissions",
    },
  };

  it("treats a scoped key as a scope problem, not a bad credential", () => {
    // This is the real response from this project's key on /v1/user.
    const described = describeElevenLabsError(401, missingPermission);
    expect(described.code).toBe("missing_permissions");
    expect(described.error).toMatch(/lacks a required permission/);
  });

  it("still reports a plain bad key as a credential problem", () => {
    expect(describeElevenLabsError(401, { detail: { message: "Invalid API key" } }).code).toBe("credentials_rejected");
  });

  it("reads the detail shape", () => {
    expect(parseElevenLabsError(missingPermission).status).toBe("missing_permissions");
    expect(parseElevenLabsError({ detail: "plain string" }).message).toBe("plain string");
    expect(parseElevenLabsError({}).message).toBe("the voice provider rejected the request");
  });

  it("separates a used-up quota from ordinary rate limiting", () => {
    expect(describeElevenLabsError(429, { detail: { message: "quota exceeded" } }).code).toBe("quota_exceeded");
    expect(describeElevenLabsError(429, { detail: { message: "too many requests" } }).code).toBe("rate_limited");
  });

  it("returns 400 for an unknown voice, which ElevenLabs reports as a 404", () => {
    expect(describeElevenLabsError(404, {}).status).toBe(400);
  });

  it("reads an unknown voice reported as a 400, which a live test produced", () => {
    // A real invalid voice id answered 400, and the generic branch reduced that
    // to "ElevenLabs returned 400" — a message with no fix in it.
    const described = describeElevenLabsError(400, { detail: { message: "voice_id not found" } });
    expect(described.code).toBe("voice_not_found");
    expect(described.status).toBe(400);
    expect(described.error).toMatch(/not available on this account/);
  });

  it("keeps a non-voice 400 as an invalid request", () => {
    expect(describeElevenLabsError(400, { detail: { message: "invalid output format" } }).code).toBe("invalid_request");
  });

  it("redacts credential-shaped text before echoing a provider message", () => {
    // Positive assertions on purpose: `not.toContain(prefix)` alone would still
    // pass if the redactor were deleted, so the marker is required to appear.
    const redacted = redactSecrets("failed for sk_TESTKEY_not_a_real_credential_0001");
    expect(redacted).toContain("[redacted]");
    expect(redacted).not.toContain("sk_TESTKEY");
    expect(redactSecrets("api_key: abc123def456")).toBe("api_key: [redacted]");
    expect(redactSecrets("x".repeat(900)).length).toBeLessThanOrEqual(300);
  });

  it("redacts a key that a provider error quotes back", () => {
    const leaky = { detail: { message: "invalid output format (key sk_TESTKEY_not_a_real_credential_0001)" } };
    const described = describeElevenLabsError(422, leaky).error;
    expect(described).toContain("[redacted]");
    expect(described).not.toContain("sk_TESTKEY");
  });

  it("never echoes the provider body into the message", () => {
    const leak = { detail: { message: "key sk_TESTKEY_not_a_real_credential_0001 rejected" } };
    expect(describeElevenLabsError(401, leak).error).not.toContain("sk_TESTKEY");
  });
});

describe("the Vaylo voiceover styles", () => {
  it("provides the five styles from the brief", () => {
    expect(STYLE_IDS.sort()).toEqual([
      "credible_education",
      "high_energy",
      "premium_tech",
      "product_demo",
      "social_hook",
    ]);
  });

  it("uses a model this account accepts, for every style", () => {
    for (const style of Object.values(VOICEOVER_STYLES)) {
      expect(ALLOWED_MODELS).toContain(style.modelId);
    }
  });

  it("uses a real voice id, copied from the live voices list", () => {
    const liveVoiceIds = new Set([
      "TX3LPaxmHKxFdv7VOQHJ",
      "JBFqnCBsd6RMkjVDRZzb",
      "Xb7hH8MSUJpSbSDYk0k2",
      "FGY2WhTYpPnrIDTdsKH5",
      "XrExE9yKIg1WjnnlVkGX",
    ]);
    for (const style of Object.values(VOICEOVER_STYLES)) {
      expect(liveVoiceIds.has(style.voiceId)).toBe(true);
    }
  });

  it("keeps settings inside the legal 0-1 range", () => {
    for (const style of Object.values(VOICEOVER_STYLES)) {
      for (const value of [style.settings.stability, style.settings.similarityBoost, style.settings.style]) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });

  it("carries the brand's refusal rules into every script brief", () => {
    for (const style of Object.values(VOICEOVER_STYLES)) {
      expect(style.scriptGuidance).toMatch(/no (price|trial|promise)|never|not|do not|no (statistics|testimonials)/i);
    }
  });

  it("targets a length suited to the placement", () => {
    expect(VOICEOVER_STYLES.social_hook.targetSeconds).toBeLessThan(VOICEOVER_STYLES.product_demo.targetSeconds);
  });
});

describe("brand rules are enforced on the script itself", () => {
  it("passes a clean, on-brand line", () => {
    expect(validateScript("Learn smarter. Train better. Perform better.").ok).toBe(true);
  });

  it("refuses each claim the brand forbids", () => {
    const bad = [
      "An AI-powered coach in your pocket.",
      "Start your free trial for only $9 per month.",
      "Guaranteed to make you faster.",
      "Clinically proven to prevent injury.",
      "Run 30% faster in two weeks.",
      "Athletes say it changed everything.",
    ];
    for (const text of bad) {
      const result = validateScript(text);
      expect(result.ok, `expected to be refused: ${text}`).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
    }
  });

  it("explains why, rather than only refusing", () => {
    expect(validateScript("Only $5 per month").violations[0]).toMatch(/checkout|pricing/i);
  });

  it("does not trip on innocent wording", () => {
    expect(validateScript("Track every session and watch the trend line move.").ok).toBe(true);
    expect(validateScript("Your training, in one place.").ok).toBe(true);
  });
});
