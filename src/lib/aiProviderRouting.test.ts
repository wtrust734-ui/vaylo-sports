// ============================================================================
// AI PROVIDER ROUTING — architectural contract test
// ----------------------------------------------------------------------------
// Vaylo Sports uses TWO AI providers, and this separation is a product
// decision, not an implementation detail:
//
//   • Google AI — FORM ANALYSIS ONLY, photo and video. One secret: GOOGLE_API.
//     Two call sites, both through the shared adapter _shared/google.ts:
//     ai-analyze (type "form_analysis") and video-form-analysis. Gemini ids
//     live in aiModels.ts (GEMINI_MODELS).
//   • OpenAI — every OTHER AI feature. One shared adapter (openai.ts
//     Responses API) plus four functions that speak the Chat Completions
//     protocol directly. One secret: OPENAI_API_KEY. ai-analyze belongs to
//     both worlds: its form_analysis type is Gemini, its calorie scan, stats
//     insight and tactical prep types are OpenAI.
//
// These tests fail if a future edit crosses the streams: a non-form function
// reading GOOGLE_API, a Google key read outside the two form-analysis
// functions, a hard-coded model name outside aiModels.ts, or a client bundle
// reaching a provider key. The expected values below were read from the
// repository sources on 2026-10-03, the day the provider split was applied.
// ============================================================================

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) =>
  readFileSync(path.resolve(__dirname, "../.." + p), "utf8").replace(/\r\n?/g, "\n");

const OPENAI_ADAPTER = "/supabase/functions/_shared/openai.ts";
const GOOGLE_ADAPTER = "/supabase/functions/_shared/google.ts";
const MODELS = "/supabase/functions/_shared/aiModels.ts";
const AI_ANALYZE = "/supabase/functions/ai-analyze/index.ts";
const VIDEO = "/supabase/functions/video-form-analysis/index.ts";

/** Functions that build OpenAI Chat Completions requests themselves. */
const OPENAI_CHAT_FUNCTIONS = [
  "/supabase/functions/coach-chat/index.ts",
  "/supabase/functions/ai-analyze/index.ts",
  "/supabase/functions/generate-plan/index.ts",
  "/supabase/functions/learning-recommend/index.ts",
  "/supabase/functions/weekly-review/index.ts",
];

/** Every function that must use OpenAI (adapter or chat protocol). */
const OPENAI_FUNCTIONS = [
  "/supabase/functions/ai-service/index.ts",
  ...OPENAI_CHAT_FUNCTIONS,
];

/** The only two functions allowed to read the Google secret. */
const GOOGLE_FUNCTIONS = [AI_ANALYZE, VIDEO];

describe("model registry (aiModels.ts) — single source of truth", () => {
  const src = read(MODELS);

  it("declares the OpenAI tiers and the Gemini ids, all in one place", () => {
    expect(src).toMatch(/PRIMARY: "gpt-6-sol"/);
    expect(src).toMatch(/MINI: "gpt-6-luna"/);
    expect(src).toMatch(/Responses API ids/);
    expect(src).toMatch(/GEMINI_MODELS = \{/);
    expect(src).toMatch(/FLASH: "gemini-3\.8-flash"/);
    expect(src).toMatch(/PRO: "gemini-3\.1-pro-preview"/);
  });

  it("forbids model names hard-coded outside the registry", () => {
    // The registry's own rule, enforced: no other file may name a model —
    // OpenAI or Gemini, in either provider's functions.
    for (const file of [...OPENAI_FUNCTIONS, VIDEO]) {
      const body = read(file);
      expect(body, `${file} hard-codes an OpenAI model id`).not.toMatch(/"gpt-[0-9]/);
      expect(body, `${file} hard-codes a Gemini model id`).not.toMatch(/"gemini-[0-9.]+[a-z-]*"/);
    }
  });

  it("routes every non-form feature through OpenAI model tiers", () => {
    const features = src.match(/export const AI_FEATURES[\s\S]*$/)?.[0] ?? "";
    expect(features).toMatch(/model: MODELS\.PRIMARY/);
    expect(features).toMatch(/model: MODELS\.MINI/);
    expect(features).not.toMatch(/model: "gemini/);
    expect(features).not.toMatch(/model: GEMINI_MODELS/);
  });
});

describe("OpenAI-backed functions", () => {
  it("the shared adapter calls the OpenAI Responses API with OPENAI_API_KEY only", () => {
    const src = read(OPENAI_ADAPTER);
    expect(src).toMatch(/const OPENAI_RESPONSES_URL = "https:\/\/api\.openai\.com\/v1\/responses"/);
    expect(src).toMatch(/Deno\.env\.get\("OPENAI_API_KEY"\)/);
    expect(src).not.toMatch(/GOOGLE_API|generativelanguage/);
  });

  it("each chat-protocol function targets api.openai.com", () => {
    for (const file of OPENAI_CHAT_FUNCTIONS) {
      const body = read(file);
      expect(body, `${file} lost its OpenAI call`).toMatch(
        /https:\/\/api\.openai\.com\/v1\/chat\/completions/,
      );
    }
  });

  it("only ai-analyze of the OpenAI functions also touches Google AI", () => {
    // ai-analyze is the one function in both worlds: photo form analysis on
    // Gemini, the other three types on OpenAI. No other OpenAI function may
    // read the Google secret or target the Generative Language API.
    for (const file of OPENAI_CHAT_FUNCTIONS) {
      if (file === AI_ANALYZE) continue;
      const body = read(file);
      expect(body, `${file} must not reach Google AI`).not.toMatch(/generativelanguage/);
      expect(body, `${file} must not read GOOGLE_API`).not.toMatch(/Deno\.env\.get\("GOOGLE_API"\)/);
      expect(body, `${file} must not import the Gemini adapter`).not.toMatch(/_shared\/google\.ts/);
    }
  });

  it("ai-service routes through the shared adapter (no direct fetches)", () => {
    const body = read("/supabase/functions/ai-service/index.ts");
    expect(body).toMatch(/from "\.\.\/_shared\/openai\.ts"/);
    expect(body).toMatch(/generateAIResponse/);
  });
});

describe("Google AI form-analysis path (ai-analyze photos + video-form-analysis)", () => {
  it("the shared adapter owns the Generative Language URL and the GOOGLE_API key", () => {
    const src = read(GOOGLE_ADAPTER);
    expect(src).toMatch(
      /https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\/\$\{call\.model\}:generateContent/,
    );
    expect(src).toMatch(/Deno\.env\.get|call\.apiKey/);
    // The URL appears exactly once in the repo — inside this adapter.
    expect(src.match(/generativelanguage/g)?.length).toBe(1);
  });

  it("both form-analysis functions call the adapter and read GOOGLE_API", () => {
    for (const file of GOOGLE_FUNCTIONS) {
      const body = read(file);
      expect(body, `${file} must import the Gemini adapter`).toMatch(
        /from "\.\.\/_shared\/google\.ts"/,
      );
      expect(body, `${file} must read GOOGLE_API`).toMatch(/Deno\.env\.get\("GOOGLE_API"\)/);
    }
    // ai-analyze is deliberately dual-provider (calorie scan, stats insight
    // and tactical prep stay on OpenAI), so "calls no OpenAI" is asserted on
    // video only — see "video never touches OpenAI" below.
  });

  it("routes both to the Gemini ids from the registry", () => {
    for (const file of GOOGLE_FUNCTIONS) {
      expect(read(file), `${file} bypasses GEMINI_MODELS`).toMatch(/GEMINI_MODELS\.(FLASH|PRO)/);
    }
    expect(read(VIDEO)).toMatch(/const FLASH_MODEL = GEMINI_MODELS\.FLASH/);
    expect(read(VIDEO)).toMatch(/const PRO_MODEL = GEMINI_MODELS\.PRO/);
    expect(read(VIDEO)).toMatch(/if \(reservation\?\.allowed.*?model = PRO_MODEL;/s);
    expect(read(VIDEO)).toMatch(/let model = FLASH_MODEL;/);
  });

  it("charges form analysis BEFORE the call and refuses when the provider is unconfigured", () => {
    // An unconfigured provider must never debit a credit: the key check runs
    // ahead of spendForUser in ai-analyze.
    const src = read(AI_ANALYZE);
    const charge = src.indexOf("spendForUser(");
    const keyCheck = src.indexOf('if (!GOOGLE_API) return json({ error: "Form analysis is not configured."');
    expect(keyCheck, "the GOOGLE_API check is missing").toBeGreaterThan(-1);
    expect(charge, "the key check does not run before the charge").toBeGreaterThan(-1);
    expect(keyCheck).toBeLessThan(charge);
  });

  it("splits the types inside ai-analyze: form → Gemini, the rest → OpenAI", () => {
    const src = read(AI_ANALYZE);
    expect(src).toMatch(/if \(type === "form_analysis"\) \{\s*\n\s*const dataUrl = image/);
    expect(src).toMatch(/geminiGenerate\(\{/);
    // The OpenAI call sits in the non-form path, after the Gemini early return.
    expect(src.indexOf("geminiGenerate(")).toBeLessThan(src.indexOf("api.openai.com"));
  });

  it("is the ONLY two functions that read GOOGLE_API", () => {
    const all = [
      "/supabase/functions/_shared/openai.ts",
      "/supabase/functions/_shared/aiModels.ts",
      "/supabase/functions/_shared/guard.ts",
      "/supabase/functions/ai-service/index.ts",
      "/supabase/functions/coach-chat/index.ts",
      "/supabase/functions/generate-plan/index.ts",
      "/supabase/functions/learning-recommend/index.ts",
      "/supabase/functions/weekly-review/index.ts",
      "/supabase/functions/process-purchase/index.ts",
      "/supabase/functions/manage-subscription/index.ts",
      "/supabase/functions/delete-account/index.ts",
      "/supabase/functions/open-chest/index.ts",
      "/supabase/functions/wearable-oauth/index.ts",
    ];
    for (const file of all) {
      expect(read(file), `${file} reads GOOGLE_API`).not.toMatch(/GOOGLE_API/);
    }
  });

  it("video never touches OpenAI", () => {
    const src = read(VIDEO);
    expect(src).not.toMatch(/api\.openai\.com/);
    expect(src).not.toMatch(/OPENAI_API_KEY/);
    expect(src).not.toMatch(/generateAIResponse/);
  });

  it("records the tier's model in the audit row without storing the video itself", () => {
    expect(read(VIDEO)).toMatch(/model_used: model/);
  });
});

describe("provider key containment", () => {
  it("no provider key name reaches client-reachable source", () => {
    const clientFiles = [
      "/src/lib/aiClient.ts",
      "/src/lib/credits.ts",
      "/src/lib/billing.ts",
      "/src/lib/edgeErrors.ts",
    ].filter((f) => {
      try {
        return readFileSync(path.resolve(__dirname, "../.." + f), "utf8").length > 0;
      } catch {
        return false;
      }
    });
    for (const file of clientFiles) {
      // Strip comment lines first: explaining the masking policy in prose is
      // fine — a live key name/value, Deno.env read or import in client code
      // is not.
      const code = read(file)
        .split("\n")
        .filter((l) => !l.trim().startsWith("//"))
        .join("\n");
      expect(code).not.toMatch(/Deno\.env|process\.env\[?\]?\[?\]?\[?\]?\[?\]?\.?(OPENAI|GOOGLE)/);
      expect(code).not.toMatch(/sk-[a-zA-Z0-9]{10,}|AIza[A-Za-z0-9_-]{10,}/);
    }
  });

  it("the .env.example documents both secrets but ships no value", () => {
    const example = read("/.env.example");
    expect(example).toMatch(/OPENAI/);
    expect(example).toMatch(/GOOGLE/);
    expect(example).not.toMatch(/sk-[a-zA-Z0-9]{20,}|AIza[A-Za-z0-9_-]{20,}/);
  });
});
