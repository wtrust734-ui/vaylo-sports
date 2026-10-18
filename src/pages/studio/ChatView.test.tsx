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

import { sendChatMessage } from "./api";
import ChatView from "./ChatView";

const send = vi.mocked(sendChatMessage);

function typeInto(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } });
}

beforeEach(() => {
  send.mockReset();
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
