import { beforeEach, describe, expect, it, vi } from "vitest";

// The studio talks to the real backend through these helpers; tests mock the
// supabase-js surface — these are exactly the "mocked providers" tests.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: vi.fn() },
    auth: { getSession: vi.fn(async () => ({ data: { session: { user: { id: "u1" } } } })) },
    storage: { from: () => ({ upload: vi.fn(async () => ({ error: null })), remove: vi.fn(async () => ({ error: null })) }) },
  },
}));

import { supabase } from "@/integrations/supabase/client";
import { AI_NOT_READY_MESSAGE } from "@/lib/edgeErrors";
import { createCampaign, sendChatMessage, uploadLibraryItem } from "./api";

const invoke = vi.mocked(supabase.functions.invoke);

/** Reproduce the error shape supabase-js returns for FunctionsHttpError. */
function httpError(statusCode: number, json: unknown) {
  return {
    context: { json: async () => json },
    name: "FunctionsHttpError",
    message: `${statusCode}`,
  };
}

beforeEach(() => {
  invoke.mockReset();
});

describe("chat submission and provider failure mapping", () => {
  it("sends sessionId and content to ads-chat", async () => {
    invoke.mockResolvedValueOnce({
      data: { sessionId: "s1", assistant: { id: "a1", role: "assistant", content: "ok", createdAt: "2026-10-18T00:00:00.000Z", intent: "video_ad", plan: [], clarification: null, classificationSource: "model" } },
      error: null,
    });
    const res = await sendChatMessage(null, "Make a 15-second video ad");
    expect(invoke).toHaveBeenCalledWith("ads-chat", { body: { sessionId: undefined, content: "Make a 15-second video ad" } });
    expect(res.sessionId).toBe("s1");
    expect(res.assistant.classificationSource).toBe("model");
  });

  it("maps a missing-provider 503 to the friendly AI-not-ready message, naming no secrets", async () => {
    // supabase-js resolves HTTP failures as { data, error }, it does not reject.
    invoke.mockResolvedValueOnce({ data: null, error: httpError(503, { error: "OpenAI is not configured on this deployment (ADS_OPENAI_API_KEY or OPENAI_API_KEY is missing).", code: "not_configured" }) });
    await expect(sendChatMessage("s1", "hello")).rejects.toThrow(AI_NOT_READY_MESSAGE);
  });

  it("passes the server's own failure reason through when it is an operator fact, without leaking key names", async () => {
    invoke.mockResolvedValueOnce({ data: null, error: httpError(429, { error: "Too many messages. Wait a moment and try again." }) });
    await expect(sendChatMessage("s1", "hello")).rejects.toThrow("Too many messages. Wait a moment and try again.");
  });
});

describe("campaign persistence calls", () => {
  it("creates a campaign with planning status and the format brief", async () => {
    invoke.mockResolvedValueOnce({ data: { campaign: { id: "c1", name: "X", brief: { format: "video" } } }, error: null });
    await createCampaign({
      name: "One",
      objective: "awareness",
      audience: "a",
      platform: "tiktok",
      budget_usd: 5,
      message: "m",
      call_to_action: "cta",
      brief: { format: "video", durationSeconds: 15 },
    });
    expect(invoke).toHaveBeenCalledWith("ad-campaigns", {
      body: {
        name: "One",
        objective: "awareness",
        audience: "a",
        platform: "tiktok",
        budget_usd: 5,
        message: "m",
        call_to_action: "cta",
        brief: { format: "video", durationSeconds: 15 },
        status: "planning",
      },
    });
  });
});

describe("library uploads are bounded and owner-scoped", () => {
  it("rejects oversized files before touching storage", async () => {
    const big = new File([new ArrayBuffer(64)], "x.png", { type: "image/png" });
    Object.defineProperty(big, "size", { value: 101 * 1024 * 1024 });
    await expect(uploadLibraryItem(big, "image")).rejects.toThrow("100 MB limit");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("rejects unsupported types", async () => {
    const exe = new File([new ArrayBuffer(8)], "v.exe", { type: "application/vnd.microsoft.portable-executable" });
    await expect(uploadLibraryItem(exe, "document")).rejects.toThrow("not supported");
  });
});
