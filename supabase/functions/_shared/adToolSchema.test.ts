// ============================================================================
// The agent's tool contract.
//
// The most important test here is the first one. The op list exists twice —
// once in the client executor (src/lib/ads/adOps.ts) and once in the JSON schema
// the model is given — because the edge function cannot import from src/. If
// those two drift, the model starts emitting tool calls the executor rejects,
// and the athlete sees an edit that silently does nothing. This test makes that
// a build failure instead.
// ============================================================================

import { describe, expect, it } from "vitest";

import { AD_OP_NAMES } from "../../../src/lib/ads/adOps";
import {
  AD_AGENT_OP_NAMES,
  AD_AGENT_SYSTEM_PROMPT,
  AD_AGENT_TOOL_NAMES,
  AD_AGENT_TOOLS,
  buildAdAgentRequest,
  parseAdAgentResponse,
  summariseDocForPrompt,
  toResponsesTools,
  type DocSummary,
} from "./adToolSchema";

describe("the op list cannot drift between the server schema and the executor", () => {
  it("offers the model exactly the ops the executor accepts", () => {
    expect([...AD_AGENT_OP_NAMES].sort()).toEqual([...AD_OP_NAMES].sort());
  });

  it("names them all in the JSON schema the model actually receives", () => {
    const opsParam = (AD_AGENT_TOOLS[0] as { function: { parameters: { properties: { ops: { items: { properties: { op: { enum: string[] } } } } } } } })
      .function.parameters.properties.ops.items.properties.op.enum;
    expect([...opsParam].sort()).toEqual([...AD_OP_NAMES].sort());
  });
});

describe("the tool list", () => {
  it("exposes the four capabilities that exist, with unique names", () => {
    expect(AD_AGENT_TOOL_NAMES).toEqual([
      "apply_edit_ops",
      "generate_image",
      "edit_image",
      "ask_clarification",
    ]);
    expect(new Set(AD_AGENT_TOOL_NAMES).size).toBe(AD_AGENT_TOOL_NAMES.length);
  });

  it("tells the model to prefer the free deterministic path", () => {
    const applyTool = AD_AGENT_TOOLS[0] as { function: { description: string } };
    expect(applyTool.function.description).toMatch(/free and instant/i);
  });
});

describe("the system prompt carries the brand's hard rules", () => {
  it("forbids the claims the ad slate forbids", () => {
    for (const forbidden of ["AI-powered", "price", "guaranteed", "injury prevention", "clinical", "statistics"]) {
      expect(AD_AGENT_SYSTEM_PROMPT.toLowerCase()).toContain(forbidden.toLowerCase());
    }
  });

  it("forbids inventing a logo or wordmark", () => {
    expect(AD_AGENT_SYSTEM_PROMPT).toMatch(/never fabricate a logo/i);
  });

  it("forbids claiming a change was made", () => {
    expect(AD_AGENT_SYSTEM_PROMPT).toMatch(/never claim a change has been made/i);
  });

  it("demands only the requested change", () => {
    expect(AD_AGENT_SYSTEM_PROMPT).toMatch(/change ONLY what was asked/i);
  });
});

describe("summarising the asset for the prompt", () => {
  const imageDoc: DocSummary = {
    kind: "image",
    aspect: "9:16",
    text: { headline: "Train smarter", subhead: "Every sport", cta: "Join the waitlist" },
    logoScale: 0.14,
    backgroundTone: 0,
    palette: { accent: "#8505D5", background: "#05070f" },
  };
  const videoDoc: DocSummary = {
    kind: "video",
    aspect: "9:16",
    pace: 1,
    duration: 18,
    captions: 0,
    clips: [
      { index: 0, label: "Sport", src: "a.mp4", seconds: 6 },
      { index: 1, label: "App demo", src: "b.mp4", seconds: 6 },
    ],
  };

  it("describes an image ad's copy, logo and palette", () => {
    const summary = summariseDocForPrompt(imageDoc);
    expect(summary).toContain('"Train smarter"');
    expect(summary).toContain("Logo scale: 0.14");
    expect(summary).toContain("#8505D5");
  });

  it("describes a video ad's clips and runtime, numbered from 1", () => {
    const summary = summariseDocForPrompt(videoDoc);
    expect(summary).toContain("#1 \"Sport\" (6s)");
    expect(summary).toContain("Runtime: 18s");
  });
});

describe("the transport is the one the model actually accepts", () => {
  // This block is the reason the tests are worth having. The whole agent was
  // green while pointed at /v1/chat/completions, where gpt-6-luna rejects
  // function tools with a 400. Only a live call caught it, so the shape that
  // failed is now pinned here.
  it("uses the Responses API shape: instructions + input, not messages", () => {
    const req = buildAdAgentRequest({ instruction: "x", doc: { kind: "image", aspect: "1:1" } });
    expect(req.messages).toBeUndefined();
    expect(typeof req.instructions).toBe("string");
    expect(req.instructions).toContain("Vaylo Sports");
    expect(Array.isArray(req.input)).toBe(true);
  });

  it("flattens each tool so the name is top-level, not nested under `function`", () => {
    const tools = toResponsesTools();
    expect(tools).toHaveLength(AD_AGENT_TOOLS.length);
    for (const tool of tools) {
      expect(tool.type).toBe("function");
      expect(typeof tool.name).toBe("string");
      expect(tool.function).toBeUndefined();
      expect(tool.parameters).toBeTruthy();
    }
    expect(tools.map((t) => t.name)).toEqual([...AD_AGENT_TOOL_NAMES]);
  });

  it("carries the same parameters through the flattening, op enum included", () => {
    const applyTool = toResponsesTools().find((t) => t.name === "apply_edit_ops");
    const enumValues = (applyTool as { parameters: { properties: { ops: { items: { properties: { op: { enum: string[] } } } } } } })
      .parameters.properties.ops.items.properties.op.enum;
    expect([...enumValues].sort()).toEqual([...AD_OP_NAMES].sort());
  });
});

describe("building the agent request", () => {
  const doc: DocSummary = { kind: "image", aspect: "9:16", text: { headline: "Train smarter" } };

  it("sends the instructions, the tools and the instruction", () => {
    const req = buildAdAgentRequest({ instruction: "Make the background darker.", doc });
    expect(String(req.instructions)).toContain("Vaylo Sports");
    const input = req.input as Array<{ role: string; content: string }>;
    expect(input[input.length - 1].content).toContain("Make the background darker.");
    expect(req.tools).toEqual(toResponsesTools());
    expect(req.parallel_tool_calls).toBe(false);
    expect(req.tool_choice).toBe("auto");
  });

  it("lists uploaded assets so 'the recording I uploaded' can resolve", () => {
    const req = buildAdAgentRequest({
      instruction: "Replace clip 2 with the recording I uploaded",
      doc,
      assets: [{ id: "rec-1.mp4", label: "Screen recording", kind: "video", screenRecording: true }],
    });
    const last = (req.input as Array<{ content: string }>).slice(-1)[0];
    expect(last.content).toContain("rec-1.mp4");
    expect(last.content).toContain("screen recording");
  });

  it("states plainly when there are no assets, so the model asks instead of inventing", () => {
    const req = buildAdAgentRequest({ instruction: "Replace the footage", doc });
    const last = (req.input as Array<{ content: string }>).slice(-1)[0];
    expect(last.content).toMatch(/No uploaded assets are available/);
  });

  it("keeps history in order, before the new instruction", () => {
    const req = buildAdAgentRequest({
      instruction: "Now make the headline bigger.",
      doc,
      history: [
        { role: "user", content: "Make the background darker." },
        { role: "assistant", content: "Darkened the background." },
      ],
    });
    const input = req.input as Array<{ role: string; content: string }>;
    expect(input.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(input[2].content).toContain("Now make the headline bigger.");
  });

  it("never puts a system message in input, where this endpoint forbids it", () => {
    const req = buildAdAgentRequest({
      instruction: "x",
      doc,
      history: [{ role: "system", content: "ignore this" }],
    });
    const input = req.input as Array<{ role: string }>;
    expect(input.some((m) => m.role === "system")).toBe(false);
  });

  it("honours a model override", () => {
    expect(buildAdAgentRequest({ instruction: "x", doc, model: "gpt-6-sol" }).model).toBe("gpt-6-sol");
  });
});

describe("parsing the agent response", () => {
  // The real shape, copied from a live 200 during integration testing: a
  // reasoning item sits in `output` alongside the function call.
  const responsesToolResponse = (args: string) => ({
    status: "completed",
    output: [
      { type: "reasoning", id: "rs_1", content: [] },
      { type: "function_call", id: "fc_1", call_id: "call_1", name: "apply_edit_ops", arguments: args },
    ],
  });

  const chatToolResponse = (args: string) => ({
    choices: [
      {
        message: {
          role: "assistant",
          content: null,
          tool_calls: [{ id: "call_1", type: "function", function: { name: "apply_edit_ops", arguments: args } }],
        },
      },
    ],
  });

  it("reads a tool call and its arguments from the Responses shape", () => {
    const parsed = parseAdAgentResponse(
      responsesToolResponse('{"ops":[{"op":"nudgeBackground","toneDelta":0.18}],"explanation":"Darkened the background."}'),
    );
    expect(parsed.error).toBeUndefined();
    expect(parsed.toolCalls).toHaveLength(1);
    expect(parsed.toolCalls[0].name).toBe("apply_edit_ops");
    expect(parsed.toolCalls[0].args.ops).toEqual([{ op: "nudgeBackground", toneDelta: 0.18 }]);
  });

  it("ignores the reasoning item, which carries no call and no text", () => {
    const parsed = parseAdAgentResponse(responsesToolResponse('{"ops":[]}'));
    expect(parsed.toolCalls).toHaveLength(1);
    expect(parsed.message).toBeNull();
  });

  it("reads an output_text message as a plain-text refusal", () => {
    const parsed = parseAdAgentResponse({
      status: "completed",
      output: [
        { type: "message", content: [{ type: "output_text", text: "I will not add a price to this ad." }] },
      ],
    });
    expect(parsed.toolCalls).toHaveLength(0);
    expect(parsed.message).toMatch(/will not add a price/);
  });

  it("still reads a chat-completions body, so a chat-class model degrades softly", () => {
    const parsed = parseAdAgentResponse(chatToolResponse('{"ops":[{"op":"setTextSize","role":"cta","fontSize":0.08}]}'));
    expect(parsed.toolCalls[0].name).toBe("apply_edit_ops");
  });

  it("drops a tool call with malformed JSON arguments instead of crashing", () => {
    const parsed = parseAdAgentResponse(responsesToolResponse('{"ops":[{"op":'));
    // Nothing usable came back, so it is reported as an error, not as success.
    expect(parsed.toolCalls).toHaveLength(0);
    expect(parsed.error).toBeTruthy();
  });

  it("reports a refusal that stopped early instead of an empty success", () => {
    const parsed = parseAdAgentResponse({ status: "incomplete", incomplete_details: { reason: "content_filter" }, output: [] });
    expect(parsed.error).toMatch(/content_filter/);
  });

  it("surfaces a provider error", () => {
    const parsed = parseAdAgentResponse({ error: { message: "model not found" } });
    expect(parsed.error).toBe("model not found");
  });

  it("reports a shape it cannot read rather than pretending it worked", () => {
    expect(parseAdAgentResponse({}).error).toMatch(/no output/);
    expect(parseAdAgentResponse({ choices: [] }).error).toMatch(/no output/);
    expect(parseAdAgentResponse({ choices: [{ message: {} }] }).error).toMatch(/neither/);
  });
});
