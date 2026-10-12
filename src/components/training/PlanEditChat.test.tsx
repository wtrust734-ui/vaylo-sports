// ============================================================================
// THE PLAN COACH, RENDERED
// ----------------------------------------------------------------------------
// `planEdit.test.ts` already proves the pure half: the instruction check, the
// week selection and the week-numbered splice. What it cannot prove is the half
// that spends money — that a short instruction never reaches the server, that a
// refused edit opens the top-up instead of dying, and that a retry after buying
// credits reuses the SAME request id (a fresh one would be a second charge for
// one edit).
//
// So the server call is the only thing mocked here. The validator, the week
// selection, the splice and the prices are the real modules, which is the point:
// this file would catch a change that made the sheet send more weeks than the
// price buys, or that spliced by position.
// ============================================================================

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requestPlanEdit = vi.fn();
const requestCreditTopUp = vi.fn();

vi.mock("@/lib/planEdit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/planEdit")>()),
  requestPlanEdit: (...args: unknown[]) => requestPlanEdit(...args),
}));

vi.mock("@/lib/topUpStore", () => ({
  requestCreditTopUp: (...args: unknown[]) => requestCreditTopUp(...args),
}));

import PlanEditChat from "@/components/training/PlanEditChat";
import { editCost } from "@/lib/planEdit";

/** A five-week plan; week 5 is the one these edits target. */
const plan = [
  { week: 4, sessions: [{ day: 1, title: "Easy run" }] },
  { week: 5, sessions: [{ day: 1, title: "Tempo run" }, { day: 3, title: "Long run" }] },
];

const edited = [{ week: 5, sessions: [{ day: 1, title: "Swim" }, { day: 3, title: "Long run" }] }];

const renderChat = (onApplied = vi.fn()) => {
  render(
    <PlanEditChat
      open
      onClose={() => {}}
      weeks={plan}
      defaultWeek={5}
      sport="Running"
      level="intermediate"
      durationWeeks={5}
      onApplied={onApplied}
    />,
  );
  return onApplied;
};

const type = (value: string) =>
  fireEvent.change(screen.getByLabelText("What should the coach change?"), { target: { value } });

const send = () => fireEvent.click(screen.getByRole("button", { name: /send/i }));

beforeEach(() => {
  requestPlanEdit.mockReset();
  requestCreditTopUp.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("the plan coach", () => {
  it("shows what each scope costs before anything is typed", () => {
    renderChat();

    // Two prices, and the one the sheet opens on is on the button that spends.
    expect(screen.getByText(`${editCost("week")} credits`)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `One week · ${editCost("week")}` })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `Whole plan · ${editCost("plan")}` })).toBeInTheDocument();
  });

  it("applies the edited week in place and says what was charged", async () => {
    requestPlanEdit.mockResolvedValue({ ok: true, weeks: edited, cost: 10, balance: 42 });
    const onApplied = renderChat();

    type("swap the tempo run for a swim");
    send();

    await screen.findByText(/Done — week 5 rewritten\. 10 credits used\. You have 42 left\./);

    expect(requestPlanEdit).toHaveBeenCalledTimes(1);
    const request = requestPlanEdit.mock.calls[0][0] as {
      scope: string;
      week: number;
      weeks: unknown[];
      instruction: string;
      requestId: string;
    };
    expect(request.scope).toBe("week");
    expect(request.week).toBe(5);
    // A week edit sends exactly one week — the price is for one week.
    expect(request.weeks).toHaveLength(1);
    expect(request.instruction).toBe("swap the tempo run for a swim");
    expect(request.requestId).toBeTruthy();

    // The whole plan goes back to the caller, with week 5's session swapped and
    // the week it does not own untouched.
    expect(onApplied).toHaveBeenCalledTimes(1);
    const [splicedPlan, meta] = onApplied.mock.calls[0] as [
      { week: number; sessions: { title: string }[] }[],
      { scope: string; week: number; cost: number },
    ];
    expect(splicedPlan.map((w) => w.week)).toEqual([4, 5]);
    expect(splicedPlan[1].sessions[0].title).toBe("Swim");
    expect(splicedPlan[0].sessions[0].title).toBe("Easy run");
    expect(meta).toEqual({ scope: "week", week: 5, cost: 10 });
  });

  it("never sends an instruction too short to act on", async () => {
    renderChat();

    type("hi");
    send();

    // The exact sentence, not /a few words is enough/ — the sheet's own subtitle
    // carries those words too, and a loose match would pass on the header.
    await screen.findByText(/Tell the coach what to change/i);
    expect(requestPlanEdit).not.toHaveBeenCalled();
  });

  it("opens the top-up when the credits are short, and retries the same edit", async () => {
    requestPlanEdit
      .mockResolvedValueOnce({
        ok: false,
        error: "Not enough credits. You need 10 credits — you are 4 short.",
        shortfall: 4,
        cost: 10,
        quotaExceeded: true,
      })
      .mockResolvedValueOnce({ ok: true, weeks: edited, cost: 10, balance: 30 });
    requestCreditTopUp.mockResolvedValue({ purchased: true, dismissed: false, plan: null });

    const onApplied = renderChat();
    type("swap the tempo run for a swim");
    send();

    await screen.findByText(/Done — week 5 rewritten\./);

    expect(requestCreditTopUp).toHaveBeenCalledWith(
      expect.objectContaining({ shortfall: 4 }),
    );
    expect(requestPlanEdit).toHaveBeenCalledTimes(2);
    // Same intent, same key: the refused attempt was never charged, so the retry
    // must not look like a new edit.
    const first = requestPlanEdit.mock.calls[0][0] as { requestId: string };
    const second = requestPlanEdit.mock.calls[1][0] as { requestId: string };
    expect(second.requestId).toBe(first.requestId);
    expect(onApplied).toHaveBeenCalledTimes(1);
  });

  it("charges nothing and applies nothing when the athlete dismisses the top-up", async () => {
    requestPlanEdit.mockResolvedValue({
      ok: false,
      error: "Not enough credits.",
      shortfall: 4,
      quotaExceeded: true,
    });
    requestCreditTopUp.mockResolvedValue({ purchased: false, dismissed: true, plan: null });

    const onApplied = renderChat();
    type("swap the tempo run for a swim");
    send();

    await screen.findByText(/nothing was charged/i);
    expect(onApplied).not.toHaveBeenCalled();
    await waitFor(() => expect(requestPlanEdit).toHaveBeenCalledTimes(1));
  });
});
