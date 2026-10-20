// ============================================================================
// videoAdsApi.test.ts — contract tests for the real video pipeline client.
// ----------------------------------------------------------------------------
// Mocked supabase-js surface (deterministic); assertions pin the HONESTY
// contracts rather than happy-path noise:
//   • refuse to start a paid shot without a server cost quote;
//   • pass the caller's caption/asset payload through unmodified;
//   • a stored narration lands in the caller's own storage folder.
// Real-provider verification happens separately in deployment smoke tests —
// these are clearly mock-backed unit tests.
// ============================================================================

import { beforeEach, describe, expect, it, vi } from "vitest";

const uploadMock = vi.fn(async (_path: string, _opts?: Record<string, unknown>) => ({ error: null }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: vi.fn() },
    auth: { getSession: vi.fn(async () => ({ data: { session: { user: { id: "user-1" } } } })) },
    storage: { from: () => ({ upload: uploadMock }) },
  },
}));

import { supabase } from "@/integrations/supabase/client";
import {
  quoteShot,
  startShot,
  renderVideo,
  uploadNarration,
  type ShotQuote,
} from "./videoAdsApi";

const invoke = vi.mocked(supabase.functions.invoke);

beforeEach(() => {
  invoke.mockReset();
  uploadMock.mockClear();
});

describe("cost gate", () => {
  it("startShot re-sends the quoted shape with confirm:true", async () => {
    const quote: ShotQuote = { requiresConfirmation: true, model: "veo-3.1-generate-preview", durationSeconds: 8, estimatedCostUsd: 1.2, shot: 2, conceptId: "11111111-1111-4111-8111-111111111111" };
    invoke.mockResolvedValueOnce({ data: { shotId: "s1", conceptId: quote.conceptId, operationId: "models/veo/op1", state: "running", estimatedCostUsd: 1.2 }, error: null });
    const res = await startShot(quote);
    expect(invoke).toHaveBeenCalledWith("ads-video", {
      body: expect.objectContaining({ action: "start", confirm: true, model: quote.model, durationSeconds: 8, shot: 2 }),
    });
    expect(res.operationId).toBe("models/veo/op1");
  });

  it("quotes without a requiresConfirmation marker are refused, not spent", async () => {
    invoke.mockResolvedValueOnce({ data: { estimatedCostUsd: 1.2 }, error: null });
    await expect(
      quoteShot({ conceptId: "11111111-1111-4111-8111-111111111111", shot: 1 } as never),
    ).rejects.toThrow(/refusing to start a paid shot/i);
  });
});

describe("render + narration", () => {
  it("renderVideo passes captions and asset paths through untouched", async () => {
    invoke.mockResolvedValueOnce({ data: { jobId: "j1", state: "queued", progress: 0 }, error: null });
    const captions = [{ startSeconds: 0, endSeconds: 2, text: "Train smarter" }];
    await renderVideo({
      conceptId: "11111111-1111-4111-8111-111111111111",
      voiceover: "script",
      captions,
      narrationPath: null,
      assetPaths: { "1": "/uri/shot1.mp4" },
    });
    expect(invoke).toHaveBeenCalledWith("ads-video", {
      body: expect.objectContaining({
        action: "render",
        captions,
        assetPaths: { "1": "/uri/shot1.mp4" },
      }),
    });
    // narrationPath:null must NOT be sent — the server treats an absent path
    // as "no narration file yet", never as some default audio.
    const passed = JSON.stringify((invoke.mock.calls[0] as unknown[])[1]);
    expect(passed).not.toContain('"narrationPath"');
  });

  it("uploadNarration writes into the caller's folder and returns the storage path", async () => {
    const bytes = btoa("audio-bytes");
    const path = await uploadNarration(bytes, "audio/mpeg");
    expect(uploadMock).toHaveBeenCalledTimes(1);
    const calledPath = String(uploadMock.mock.calls[0]?.[0]);
    expect(calledPath.startsWith("user-1/narration-")).toBe(true);
    expect(path.startsWith("ads/user-1/narration-")).toBe(true);
    expect(path.endsWith(".mp3")).toBe(true);
  });
});
