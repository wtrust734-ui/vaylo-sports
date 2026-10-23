// ============================================================================
// PURCHASES & REFUNDS — rendered against a fake backend
// ----------------------------------------------------------------------------
// `src/lib/refunds.test.ts` proves the policy and the contract. This file
// proves the screen an athlete actually sees: that it lists only what the
// server returned, offers only the reasons attached to the chosen transaction,
// sends the ids and no amount, and shows the honest money caveat when no
// provider is connected.
// ============================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const loadRefundOptions = vi.fn();
const submitRefund = vi.fn();
const loadRefundCase = vi.fn();
const escalateRefundCase = vi.fn();

vi.mock("@/lib/refunds", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/refunds")>();
  return {
    ...actual,
    loadRefundOptions: (...args: unknown[]) => loadRefundOptions(...args),
    submitRefund: (...args: unknown[]) => submitRefund(...args),
    loadRefundCase: (...args: unknown[]) => loadRefundCase(...args),
    escalateRefundCase: (...args: unknown[]) => escalateRefundCase(...args),
  };
});

vi.mock("@/contexts/AuthContext", () => {
  // A STABLE user object. Returning a fresh one per call made the page's
  // [user]-keyed load effect re-run on every render, which cleared the screen
  // back to "Loading…" the moment a transaction was selected.
  const user = { id: "11111111-1111-4111-8111-111111111111" };
  return { useAuth: () => ({ user, loading: false }) };
});

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import PurchasesRefunds from "@/pages/PurchasesRefunds";

const CHARGE_ID = "33333333-3333-4333-8333-333333333333";

const options = {
  balance: { credits: 210, infinite: false },
  charges: [
    {
      id: CHARGE_ID,
      feature: "video_form_analysis",
      reason: "AI video form analysis",
      credits: 45,
      createdAt: "2026-10-20T09:00:00.000Z",
      jobStatus: "failed" as const,
      alreadyRefunded: false,
      existingCase: null,
      reasons: ["ai_not_delivered", "ai_incomplete"],
    },
  ],
  purchases: [],
  subscription: null,
  cases: [
    {
      ref: "RF-261018-AAAA",
      kind: "money" as const,
      sourceType: "credit_purchase" as const,
      reasonCode: "credits_unused",
      details: null,
      feature: null,
      credits: null,
      amountCents: 999,
      currency: "USD",
      status: "awaiting_provider",
      resolution: "awaiting_provider",
      decisionNote: null,
      escalationRules: ["provider_not_connected"],
      canEscalate: false,
      providerState: "awaiting_provider",
      createdAt: "2026-10-18T09:00:00.000Z",
      updatedAt: "2026-10-18T09:00:00.000Z",
      decidedAt: "2026-10-18T10:00:00.000Z",
      completedAt: null,
    },
  ],
  provider: { id: "unconfigured", refundsEnabled: false },
  moneyExecutionEnabled: false,
};

const renderPage = () =>
  render(
    <MemoryRouter>
      <PurchasesRefunds />
    </MemoryRouter>
  );

describe("Purchases & refunds screen", () => {
  beforeEach(() => {
    loadRefundOptions.mockReset();
    submitRefund.mockReset();
    loadRefundCase.mockReset();
    escalateRefundCase.mockReset();
  });

  afterEach(cleanup);

  it("lists the transactions and says money cannot move without a provider", async () => {
    loadRefundOptions.mockResolvedValue(options);
    renderPage();

    const chargeRow = await screen.findByRole("button", { name: /video form analysis/i });
    expect(chargeRow.textContent).toContain("45 credits");
    expect(screen.getByText(/no money can move until a payment provider is connected/i)).toBeInTheDocument();
    // The open money case is shown as awaiting the provider, not as refunded.
    expect(screen.getByText("Awaiting payment provider")).toBeInTheDocument();
    expect(screen.getByText(/no money has moved yet/i)).toBeInTheDocument();
  });

  it("offers only the reasons the server attached, then submits ids and a submission key", async () => {
    loadRefundOptions.mockResolvedValue(options);
    submitRefund.mockResolvedValue({
      case: {
        ...options.cases[0],
        ref: "RF-261023-BBBB",
        status: "completed",
        kind: "credits",
        credits: 45,
        amountCents: null,
        canEscalate: false,
      },
      message: "45 credits are on their way back to your balance.",
      balance: 255,
    });
    renderPage();

    const chargeButton = await screen.findByRole("button", { name: /video form analysis/i });
    fireEvent.click(chargeButton);

    // Only the two AI reasons the charge allows are offered.
    expect(await screen.findByLabelText(/The AI service failed or never delivered/)).toBeInTheDocument();
    expect(screen.getByLabelText(/The AI result was incomplete or unusable/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/I bought credits and have not used them/)).toBeNull();

    fireEvent.click(screen.getByLabelText(/The AI service failed or never delivered/));
    fireEvent.click(screen.getByRole("button", { name: /Submit request/i }));

    await waitFor(() => expect(submitRefund).toHaveBeenCalledTimes(1));
    const payload = submitRefund.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.sourceType).toBe("ai_service");
    expect(payload.reasonCode).toBe("ai_not_delivered");
    expect(payload.chargeId).toBe(CHARGE_ID);
    expect(payload.submissionKey).toEqual(expect.any(String));
    // No client-supplied amount or status is ever sent.
    expect(payload).not.toHaveProperty("credits");
    expect(payload).not.toHaveProperty("amountCents");
    expect(payload).not.toHaveProperty("status");

    expect(await screen.findByText("Request RF-261023-BBBB")).toBeInTheDocument();
  });

  it("surfaces a load failure instead of an empty screen", async () => {
    loadRefundOptions.mockRejectedValue(new Error("That transaction was not found on this account."));
    renderPage();
    expect(await screen.findByText(/That transaction was not found/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Try again/i })).toBeInTheDocument();
  });
});
