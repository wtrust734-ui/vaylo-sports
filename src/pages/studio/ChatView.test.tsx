import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

// Component-level mocked-provider test: the real network is stubbed at the
// API boundary; everything above it (typing, submit guard, bubbles, plan
// chips, error surface) runs for real.
vi.mock("./api", () => ({
  listChatSessions: vi.fn(async () => []),
  listChatMessages: vi.fn(async () => []),
  sendChatMessage: vi.fn(),
}));

// The build runner stays hermetic: the network pipeline is stubbed with the
// deliverable the caller asks for.
vi.mock("./chatRun", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./chatRun")>()),
  runChatBuild: vi.fn(),
  persistRunResult: vi.fn(async () => undefined),
}));

import { sendChatMessage } from "./api";
import { runChatBuild, persistRunResult } from "./chatRun";
import ChatView from "./ChatView";

const send = vi.mocked(sendChatMessage);
const runBuild = vi.mocked(runChatBuild);
const persist = vi.mocked(persistRunResult);

function typeInto(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } });
}

beforeEach(() => {
  send.mockReset();
  runBuild.mockReset();
  persist.mockReset();
});

describe("ChatView", () => {
  it("submits the typed request and renders the assistant's plan honestly", async () => {
    send.mockResolvedValueOnce({
      sessionId: "s1",
      assistant: {
        id: "a1",
        role: "assistant",
        content: "Understood. Planned route: competitor research (Strava) → video ad (15s). Nothing has been generated yet.",
        createdAt: "2026-10-18T00:00:00.000Z",
        intent: "video_ad",
        plan: [
          { type: "competitor_research", options: { competitors: ["strava"] } },
          { type: "video_ad", options: { format: "video", durationSeconds: 15 } },
        ],
        clarification: null,
        classificationSource: "model",
      },
    });

    render(<ChatView />);
    const input = screen.getByPlaceholderText(/Type your request/i);
    typeInto(input, "Research Strava then make a 15-second video ad");
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => {
      expect(send).toHaveBeenCalledWith(null, "Research Strava then make a 15-second video ad");
    });
    await waitFor(() => {
      expect(screen.getByText(/Nothing has been generated yet/)).toBeTruthy();
    });
    // Plan steps are shown as planned, not as finished creative.
    expect(screen.getAllByText("planned").length).toBe(2);
    // The intent badge and the plan item both carry the label — assert presence.
    expect(screen.getAllByText(/Video ad/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Competitor research/).length).toBeGreaterThan(0);
  });

  it("disables sending while a request is in flight (duplicate-submission guard)", async () => {
    let release!: (v: unknown) => void;
    send.mockImplementationOnce(() => new Promise((v) => (release = v)));
    render(<ChatView />);
    typeInto(screen.getByPlaceholderText(/Type your request/i), "hello");
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    expect(await screen.findByText(/Routing your request/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /send/i })).toBeDisabled();
    release({
      sessionId: "x",
      assistant: { id: "a", role: "assistant", content: "Routed.", intent: "campaign_ideation", plan: [], clarification: null, classificationSource: "rules" },
    });
  });

  it("runs the build from one click and streams live updates, with no credit card", async () => {
    send.mockResolvedValueOnce({
      sessionId: "s2",
      assistant: {
        id: "a2",
        role: "assistant",
        content: "Understood. Planned route: video ad (15s).",
        createdAt: "2026-10-18T00:00:00.000Z",
        intent: "video_ad",
        plan: [{ type: "video_ad", options: { format: "video", durationSeconds: 15 } }],
        clarification: null,
        classificationSource: "model",
      },
    });
    runBuild.mockResolvedValueOnce({
      kind: "video",
      conceptId: "c-uuid-c-uuid-c-uuid-c-uuid",
      jobId: "job-uuid-job-uuid-job-uuid-job-uuid",
      publicUrl: "https://example.com/finished.mp4",
      shotsDone: 2,
      shotsFailed: 0,
      researchProjectId: null,
      notes: [],
    });

    render(<ChatView />);
    typeInto(screen.getByPlaceholderText(/Type your request/i), "Make a 15-second video ad");
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    // One click starts the build. Nothing asks for credits or a balance.
    expect(await screen.findByText(/Press Run and I'll build it end to end/)).toBeTruthy();
    expect(screen.queryByText(/credits/i)).toBeNull();
    const run = screen.getByRole("button", { name: /Run it/i });
    fireEvent.click(run);
    expect(await screen.findByText(/Build started/)).toBeTruthy();

    await waitFor(() => {
      expect(runBuild).toHaveBeenCalledWith(
        { brief: "Make a 15-second video ad", steps: [{ type: "video_ad", options: { format: "video", durationSeconds: 15 } }] },
        expect.any(Function),
      );
    });
    // The finished video is handed back into the chat.
    expect(await screen.findByTestId("chat-delivered-video")).toBeTruthy();
    expect(screen.getByText(/Build complete/)).toBeTruthy();
    // Once the run output exists on the bubble, the manual hand-off is retired:
    // the finished ad was already delivered here.
    expect(screen.queryByRole("button", { name: /Open in the Video Ads workspace instead/i })).toBeNull();
    // The result was persisted for the conversation history.
    await waitFor(() => {
      expect(persist).toHaveBeenCalledWith(
        "s2",
        "video_ad",
        expect.stringMatching(/Video ad complete/),
        expect.objectContaining({ run: expect.anything() }),
      );
    });
  });

  it("disables the send button when the input is empty", () => {
    render(<ChatView />);
    expect(screen.getByRole("button", { name: /send/i })).toBeDisabled();
  });

  it("shows a readable failure when the server errors", async () => {
    send.mockRejectedValueOnce(new Error("This feature isn't switched on yet. Everything else works — check back soon."));
    render(<ChatView />);
    typeInto(screen.getByPlaceholderText(/Type your request/i), "make something");
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    expect(await screen.findByText(/isn't switched on yet/)).toBeTruthy();
  });
});
