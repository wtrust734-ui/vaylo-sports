// ============================================================================
// VAYLO AD STUDIO — the ad-editing agent's tool contract.
//
// This is the "reasoning AI that understands natural-language editing
// instructions and coordinates tools" the app did not have. `ai-service` is a
// single-shot text endpoint with no tool calling at all, so nothing in the
// product could previously choose between "this is a deterministic edit" and
// "this needs the image model".
//
// The design rule that matters: the model does NOT edit anything. It chooses a
// tool and fills its arguments. The actual work is done by code that is already
// tested — `applyOps` on the client and `buildEditPayload` on the server — so a
// hallucinated argument produces a rejected op, never a silently wrong asset.
//
// Pure functions only: no Deno globals, no network, no imports, so this is
// unit-testable beside the rest of `_shared`.
// ============================================================================

/**
 * Op names the deterministic executor accepts.
 *
 * MIRRORS `AD_OP_NAMES` in `src/lib/ads/adOps.ts`, which the server cannot
 * import. `adToolSchema.test.ts` asserts the two lists are identical — adding an
 * op on one side and not the other fails the test suite.
 */
export const AD_AGENT_OP_NAMES = [
  "setText",
  "setTextSize",
  "nudgeTextSize",
  "setBackground",
  "nudgeBackground",
  "setLogoScale",
  "nudgeLogoScale",
  "setPalette",
  "setAspect",
  "moveText",
  "setPace",
  "nudgePace",
  "trimEnd",
  "trimStart",
  "removeClip",
  "reorderClip",
  "replaceClipSource",
  "setClipTransition",
  "addCaptionsFromClips",
  "removeCaptions",
  "setCaptionSize",
  "nudgeCaptionSize",
] as const;

/** The default reasoning model. Verified to resolve for this account. */
export const AD_AGENT_MODEL = "gpt-6-luna";

/**
 * The tools the agent may call, in OpenAI function-calling form.
 *
 * Deliberately only four. A long tool list makes a model guess; each of these
 * maps to one capability that genuinely exists in the codebase today.
 */
export const AD_AGENT_TOOLS = [
  {
    type: "function",
    function: {
      name: "apply_edit_ops",
      description:
        "Make a deterministic edit to the ad: change copy, resize or move text, darken or lighten the " +
        "background, resize or move the logo, change the palette, change the aspect ratio for a placement, " +
        "trim or reorder clips, change pacing, or add/remove/resize captions. " +
        "Use this for ANY request that does not need new or altered pixels. It is free and instant. " +
        "Only include ops needed for the request — every op you add changes the asset.",
      parameters: {
        type: "object",
        properties: {
          ops: {
            type: "array",
            description: "The edits to apply, in the order they should be applied.",
            items: {
              type: "object",
              properties: {
                op: { type: "string", enum: AD_AGENT_OP_NAMES as unknown as string[] },
                role: { type: "string", enum: ["headline", "subhead", "cta"] },
                text: { type: "string" },
                fontSize: { type: "number" },
                delta: { type: "number" },
                toneDelta: { type: "number" },
                gradientDelta: { type: "number" },
                vignetteDelta: { type: "number" },
                accent: { type: "string" },
                background: { type: "string" },
                backgroundDeep: { type: "string" },
                scale: { type: "number" },
                aspect: { type: "string", enum: ["9:16", "4:5", "1:1", "16:9"] },
                to: { type: "string", enum: ["top", "center", "bottom"] },
                seconds: { type: "number" },
                pace: { type: "number" },
                index: { type: "number" },
                from: { type: "number" },
                src: { type: "string" },
                label: { type: "string" },
                size: { type: "number" },
                transition: {
                  type: "object",
                  properties: {
                    type: { type: "string", enum: ["cut", "dissolve", "punchIn"] },
                    duration: { type: "number" },
                  },
                  required: ["type", "duration"],
                },
              },
              required: ["op"],
            },
          },
          explanation: {
            type: "string",
            description: "One short sentence for the athlete describing what changed.",
          },
        },
        required: ["ops", "explanation"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_image",
      description:
        "Generate a brand-new advertising image from a prompt. Costs a paid provider call. " +
        "Use only when the request needs imagery that does not exist yet.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "The full generation prompt." },
          size: { type: "string", description: "e.g. 1024x1024, 1024x1536, or a divisible-by-16 size on the 2.5 models." },
          outputFormat: { type: "string", enum: ["png", "jpeg", "webp"] },
        },
        required: ["prompt"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "edit_image",
      description:
        "Alter the pixels of an existing image with the image model, optionally conditioned on reference " +
        "images such as the real Vaylo logo or an uploaded app screenshot. Costs a paid provider call. " +
        "Use this for \"make the background photographic\", not for \"make the headline bigger\".",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "What should change, and what must stay identical." },
          referenceAssetIds: {
            type: "array",
            items: { type: "string" },
            description: "Ids of uploaded assets to supply as reference images, e.g. the official logo.",
          },
          size: { type: "string" },
          outputFormat: { type: "string", enum: ["png", "jpeg", "webp"] },
        },
        required: ["prompt"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "ask_clarification",
      description:
        "Ask one short question when a missing detail would materially change the result — for example a " +
        "new headline with no wording given. Do NOT use this when a sensible interpretation exists.",
      parameters: {
        type: "object",
        properties: {
          question: { type: "string" },
          options: { type: "array", items: { type: "string" } },
        },
        required: ["question"],
      },
    },
  },
] as const;

export const AD_AGENT_TOOL_NAMES = AD_AGENT_TOOLS.map((t) => t.function.name);

/**
 * The system prompt.
 *
 * Ported from the brand knowledge base and the ad slate's compliance rules. The
 * last two paragraphs exist because the very first live generation invented a
 * fictitious "VERIDIAN SPORTS TECH" logo and an "AI-POWERED INSIGHTS" badge —
 * both forbidden. Prompt-level instruction is necessary but not sufficient, so
 * the server also blocks these locally before any provider call.
 */
export const AD_AGENT_SYSTEM_PROMPT = `You edit Vaylo Sports advertising assets.

Vaylo Sports is an all-sports training and athlete-development app. Slogan: "Learn smarter. Train better. Perform better." The brand is a serious sports-technology company: dark navy and black foundations, restrained purple accents, modern clean type, strong contrast. It must never read as a generic AI startup, a supplement brand, or a gamble/crypto product.

You choose tools; you never edit the asset yourself. Prefer apply_edit_ops. It is free, instant and deterministic, and it is correct for copy changes, sizes, positions, palette, aspect ratio, trims, reordering, pacing and captions. Only reach for generate_image or edit_image when the request genuinely needs new or altered pixels.

Change ONLY what was asked. If the athlete says "make the headline bigger", do not also touch the background, the palette or the logo. If they say "keep everything the same but change the headline", apply exactly one op.

Refuse, and say why, if asked for copy that breaks advertising rules:
- never claim AI capabilities ("AI-powered", "AI coach") — they are not switched on;
- never state a price, a free trial or a monthly cost — there is no checkout;
- never promise guaranteed results, injury prevention or prediction, or clinical proof;
- never invent statistics, testimonials or reviews;
- never name wearables, health sync or the coach marketplace — all are off at launch.

Never invent product features, app screens, numbers or branding. Never fabricate a logo or wordmark: the only logo is the supplied Vaylo mark. If a request would need a screenshot or the real logo, ask for the asset rather than inventing one.

Never claim a change has been made. The application executes your tool call and reports the result.`;

export interface AdAgentMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** A compact, token-cheap description of the asset the athlete is looking at. */
export interface DocSummary {
  kind: "image" | "video";
  aspect: string;
  text?: Record<string, string>;
  logoScale?: number;
  backgroundTone?: number;
  palette?: { accent?: string; background?: string };
  clips?: Array<{ index: number; label: string; src: string; seconds: number }>;
  duration?: number;
  captions?: number;
  pace?: number;
}

export interface BuildAgentRequestInput {
  instruction: string;
  doc: DocSummary;
  /** Uploaded assets the instruction may refer to, e.g. "the screen recording I uploaded". */
  assets?: Array<{ id: string; label: string; kind: string; screenRecording?: boolean }>;
  /** Previous turns, oldest first, for context-aware editing. */
  history?: AdAgentMessage[];
  model?: string;
}

export const summariseDocForPrompt = (doc: DocSummary): string => {
  const lines: string[] = [`Asset: ${doc.kind} ad, ${doc.aspect}.`];
  if (doc.kind === "video") {
    lines.push(`Runtime: ${doc.duration ?? 0}s at ${doc.pace ?? 1}x.`);
    lines.push(`Clips: ${(doc.clips ?? []).map((c) => `#${c.index + 1} "${c.label}" (${c.seconds}s)`).join(", ") || "none"}.`);
    lines.push(`Captions: ${doc.captions ?? 0}.`);
  } else {
    const text = doc.text ?? {};
    lines.push(`Headline: "${text.headline ?? ""}". Subhead: "${text.subhead ?? ""}". CTA: "${text.cta ?? ""}".`);
    lines.push(`Logo scale: ${doc.logoScale ?? 0}. Background tone: ${doc.backgroundTone ?? 0}.`);
    if (doc.palette) lines.push(`Palette accent: ${doc.palette.accent ?? "?"}, background: ${doc.palette.background ?? "?"}.`);
  }
  return lines.join("\n");
};

/**
 * Flatten the tool definitions into the Responses API's form.
 *
 * The two APIs disagree about where a tool's name lives: Chat Completions nests
 * it under `function`, Responses puts it at the top level. Rather than keep two
 * copies of eleven op parameters — which would drift — the nested definitions
 * above are the single source and this maps them.
 */
export function toResponsesTools(
  tools: ReadonlyArray<{ type: "function"; function: Record<string, unknown> }> = AD_AGENT_TOOLS as unknown as ReadonlyArray<{
    type: "function";
    function: Record<string, unknown>;
  }>,
): Array<Record<string, unknown>> {
  return tools.map((tool) => ({ type: "function", ...tool.function }));
}

/**
 * Build the request body for the agent.
 *
 * The Responses API, NOT Chat Completions. This is not a style preference: the
 * live API rejects `gpt-6-luna` on `/v1/chat/completions` with
 *
 *   "Function tools with reasoning_effort are not supported for gpt-6-luna in
 *    /v1/chat/completions. To use function tools, use /v1/responses or set
 *    reasoning_effort to 'none'."
 *
 * Setting reasoning to 'none' would have silenced the error and made the agent
 * dumber at exactly the job it exists for, so the whole request moved instead.
 * The system prompt goes in `instructions` (a top-level field here, not a
 * message) and the athlete's turn goes in `input`.
 */
export function buildAdAgentRequest(input: BuildAgentRequestInput): Record<string, unknown> {
  const context: string[] = [summariseDocForPrompt(input.doc)];
  if (input.assets && input.assets.length > 0) {
    context.push(
      `Uploaded assets available to reference by id: ${input.assets
        .map((a) => `${a.id} ("${a.label}", ${a.kind}${a.screenRecording ? ", screen recording" : ""})`)
        .join("; ")}.`,
    );
  } else {
    context.push("No uploaded assets are available. If a request needs one, ask for it rather than inventing it.");
  }

  return {
    model: input.model ?? AD_AGENT_MODEL,
    instructions: AD_AGENT_SYSTEM_PROMPT,
    // Prior turns, minus any system role: `instructions` is the only place a
    // system message may appear on this endpoint.
    input: [
      ...(input.history ?? []).filter((m) => m.role !== "system").map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: `${context.join("\n\n")}\n\nInstruction: ${input.instruction}` },
    ],
    tools: toResponsesTools(),
    // Let the model answer without a tool when it is refusing a forbidden claim,
    // but never let it "chat" its way out of an editing request silently.
    tool_choice: "auto",
    parallel_tool_calls: false,
  };
}

export interface ParsedToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface ParsedAgentResponse {
  /** Tool calls the model asked for, in order. */
  toolCalls: ParsedToolCall[];
  /** Plain-text reply, present when the model chose not to call a tool. */
  message: string | null;
  /** Set when the provider returned an error instead of a result. */
  error?: string;
}

/** Turn a tool-call's JSON argument string into an object, or null if unusable. */
const parseArguments = (raw: unknown): Record<string, unknown> | null => {
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

/**
 * Read tool calls out of a provider response.
 *
 * Returns an `error` rather than throwing, so the caller answers the athlete
 * with a reason. Malformed JSON in a tool argument drops that one call instead
 * of crashing the whole edit.
 *
 * Reads the Responses shape (`output[]` of `function_call` / `message` items),
 * and falls back to the Chat Completions shape so that pointing
 * AD_AGENT_MODEL at a chat-class model degrades into "still works" rather than
 * "silently unreadable".
 */
export function parseAdAgentResponse(body: unknown): ParsedAgentResponse {
  const error = (body as { error?: { message?: string } })?.error;
  if (error) return { toolCalls: [], message: null, error: error.message ?? "provider error" };

  const toolCalls: ParsedToolCall[] = [];
  let content: string | null = null;

  // ---- Responses API ----------------------------------------------------
  const output = (body as { output?: unknown })?.output;
  if (Array.isArray(output)) {
    for (const item of output) {
      const record = item as Record<string, unknown>;
      if (record?.type === "function_call" && typeof record.name === "string") {
        const args = parseArguments(record.arguments);
        if (args) toolCalls.push({ name: record.name, args });
        continue;
      }
      if (record?.type === "message") {
        const parts = Array.isArray(record.content) ? record.content : [];
        const text = parts
          .map((p) => (p as { text?: unknown })?.text)
          .filter((t): t is string => typeof t === "string")
          .join("")
          .trim();
        if (text) content = text;
      }
    }

    if (toolCalls.length === 0 && !content) {
      // A refusal (status "incomplete") is a legitimate answer, not a bug.
      const incomplete = (body as { incomplete_details?: { reason?: string } })?.incomplete_details?.reason;
      if (incomplete) return { toolCalls: [], message: null, error: `the model stopped early: ${incomplete}` };
      return { toolCalls: [], message: null, error: "the model returned neither a tool call nor text" };
    }
    return { toolCalls, message: content };
  }

  // ---- Chat Completions fallback ----------------------------------------
  const choices = (body as { choices?: unknown })?.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return { toolCalls: [], message: null, error: "provider returned no output" };
  }
  const message = (choices[0] as { message?: Record<string, unknown> })?.message;
  if (!message) return { toolCalls: [], message: null, error: "provider returned no message" };

  const raw = message.tool_calls;
  if (Array.isArray(raw)) {
    for (const call of raw) {
      const fn = (call as { function?: { name?: unknown; arguments?: unknown } })?.function;
      if (!fn || typeof fn.name !== "string") continue;
      const args = parseArguments(fn.arguments);
      if (args) toolCalls.push({ name: fn.name, args });
    }
  }
  if (typeof message.content === "string" && message.content.trim()) content = message.content.trim();

  if (toolCalls.length === 0 && !content) {
    return { toolCalls: [], message: null, error: "provider returned neither a tool call nor text" };
  }
  return { toolCalls, message: content };
}
