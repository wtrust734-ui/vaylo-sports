import { describe, expect, it, vi, beforeEach } from "vitest";

// Mocked supabase-js surface: these are the exact "mocked provider" tests that
// verify the feedback path cannot leak secrets (the invoke body carries only
// category, email, body, subject — no tokens, no prompts-as-data).
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: vi.fn(async () => ({ data: { reference: "SR-TEST", error: null } })) },
    auth: { getSession: vi.fn(async () => ({ data: { session: { user: { email: "tester@example.com" } } } })) },
  },
}));

import { supabase } from "@/integrations/supabase/client";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import BetaFeedback from "./BetaFeedback";

// Minimal props; the component reads the open state from props.
const onClose = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
});

describe("BetaFeedback", () => {
  it("sends through support-request with the studio view and no secret fields", async () => {
    render(<BetaFeedback view="video" open onClose={onClose} />);
    fireEvent.change(screen.getByPlaceholderText(/what happened/i), { target: { value: "Render failed after narration was stored." } });
    fireEvent.click(screen.getByText("Send feedback"));
    await waitFor(() => expect(supabase.functions.invoke).toHaveBeenCalledTimes(1));
    const [fn, opts] = vi.mocked(supabase.functions.invoke).mock.calls[0];
    expect(fn).toBe("support-request");
    const body = (opts as { body: Record<string, unknown> }).body;
    expect(body.category).toBe("bug");
    expect(body.email).toBe("tester@example.com");
    expect(String(body.body)).toContain("[Ads Studio beta · video]");
    expect(String(body.body)).toContain("Render failed after narration");
    expect(JSON.stringify(body)).not.toMatch(/api[_-]?key|token|secret/i);
    expect(await screen.findByText(/SR-TEST/)).toBeTruthy();
  });
});
