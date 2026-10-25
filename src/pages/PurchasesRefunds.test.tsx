import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const { escalateRefundCase, loadRefundOptions, options } = vi.hoisted(() => {
  const declinedCase = {
    ref: "RF-261023-AB12",
    kind: "purchase",
    sourceType: "credit_purchase",
    reasonCode: "credits_unused",
    details: null,
    feature: null,
    credits: 25,
    amountCents: 499,
    currency: "GBP",
    status: "declined",
    resolution: "auto_rejected",
    decisionNote: "Outside the window the policy allows.",
    escalationRules: [],
    canEscalate: true,
    providerState: null,
    createdAt: "2026-10-23T09:00:00Z",
    updatedAt: "2026-10-23T09:05:00Z",
    decidedAt: "2026-10-23T09:05:00Z",
    completedAt: null,
  };

  return {
    options: {
      balance: { credits: 12, infinite: false },
      charges: [
        {
          id: "charge-1",
          feature: "video_form_analysis",
          reason: "Video form analysis",
          credits: 45,
          createdAt: "2026-10-20T10:00:00Z",
          jobStatus: "failed",
          alreadyRefunded: false,
          existingCase: null,
          reasons: ["ai_not_delivered"],
        },
      ],
      purchases: [],
      subscription: null,
      cases: [declinedCase],
      provider: { id: "none", refundsEnabled: false },
      moneyExecutionEnabled: false,
    },
    loadRefundOptions: vi.fn(),
    escalateRefundCase: vi.fn(async (ref: string) => ({
      case: { ...declinedCase, ref, status: "under_review", resolution: null, canEscalate: false },
      message: "A person will look at this request.",
    })),
  };
});

vi.mock("@/lib/refunds", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/refunds")>();
  return {
    ...actual,
    loadRefundOptions,
    submitRefund: vi.fn(),
    escalateRefundCase,
  };
});

import PurchasesRefunds from "./PurchasesRefunds";
import { submitRefund, type RefundCaseView } from "@/lib/refunds";

const renderScreen = () =>
  render(
    <MemoryRouter>
      <PurchasesRefunds />
    </MemoryRouter>,
  );

beforeEach(() => loadRefundOptions.mockResolvedValue(options));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Purchases & refunds screen", () => {
  it("loads the server's options and states that money cannot move yet", async () => {
    renderScreen();

    await waitFor(() => expect(screen.getByText("RF-261023-AB12")).toBeInTheDocument());
    expect(screen.getByText(/no money can move until a payment provider is connected/i)).toBeInTheDocument();
    expect(screen.getByText("Credit charges")).toBeInTheDocument();
  });

  it("re-opens a declined automatic decision when the athlete asks for a human", async () => {
    renderScreen();

    const ask = await screen.findByRole("button", { name: /ask for a human review/i });
    fireEvent.click(ask);

    await waitFor(() => expect(escalateRefundCase).toHaveBeenCalledWith("RF-261023-AB12"));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /ask for a human review/i })).not.toBeInTheDocument(),
    );
  });

  it("submits from the sheet's footer, so the primary action is never buried", async () => {
    // The bug: Submit request sat in the bottom strip of a hand-rolled overlay,
    // under the Android gesture area, and the tap went to the OS instead of the
    // button. It lives in the bottom sheet's own footer now — outside the
    // scrolling body — and it must actually reach the server.
    vi.mocked(submitRefund).mockResolvedValue({
      case: { ...options.cases[0], status: "completed", credits: 45 } as RefundCaseView,
      message: "Credits returned.",
      balance: 57,
    });

    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: /request a refund/i }));
    await screen.findByRole("dialog");

    fireEvent.click(
      screen.getByRole("radio", { name: /the ai service failed or never delivered/i }),
    );
    fireEvent.change(screen.getByLabelText(/anything else we should know/i), {
      target: { value: "The analysis never arrived." },
    });

    const submit = screen.getByRole("button", { name: "Submit request" });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);

    await waitFor(() =>
      expect(submitRefund).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceType: "ai_service",
          reasonCode: "ai_not_delivered",
          chargeId: "charge-1",
        }),
      ),
    );
  });

  it("offers only the reasons the server returned for that transaction", async () => {
    renderScreen();

    fireEvent.click(await screen.findByRole("button", { name: /request a refund/i }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(/the ai service failed or never delivered/i);
    // Another AI-source reason the server did NOT offer for this charge.
    expect(dialog).not.toHaveTextContent(/the ai result was incomplete or unusable/i);
  });
});
