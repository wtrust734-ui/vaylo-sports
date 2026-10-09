// ============================================================================
// THE RECOMMENDATION PANEL, RENDERED
// ----------------------------------------------------------------------------
// The wizard asks ten questions a beginner cannot answer. This panel is the
// answer to nine of them, and the two ways it can fail are both silent:
//
//   * it renders but the taps do nothing (a suggestion that cannot be accepted
//     is a label, not a recommendation), or
//   * it hides the reasoning, so "3 days" is just another number an athlete has
//     to take on trust.
//
// Both are what this file checks, plus the one deliberate gap: an advanced
// athlete is told the fields are theirs, rather than being quietly pre-filled.
// ============================================================================

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { AdvicePanel, AdvancedFreedomNote, RecommendedChip } from "@/components/training/PlanSetupAdvice";
import { recommendSetup } from "@/lib/planSetupAdvice";

afterEach(cleanup);

const advice = recommendSetup({ level: "beginner" }); // 3 days, 2 rest, short, ~2.5h

function renderPanel(step: 1 | 2 | 3) {
  const onApplyAll = vi.fn();
  const onApplyField = vi.fn();
  render(
    <AdvicePanel
      step={step}
      advice={advice}
      onApplyAll={onApplyAll}
      onApplyField={onApplyField}
      applied={{}}
    />,
  );
  return { onApplyAll, onApplyField };
}

describe("the recommendation panel", () => {
  it("offers the whole step in one tap", () => {
    const { onApplyAll } = renderPanel(2);

    fireEvent.click(screen.getByRole("button", { name: /use these/i }));

    expect(onApplyAll).toHaveBeenCalledTimes(1);
  });

  it("lets the athlete take one answer at a time", () => {
    const { onApplyField } = renderPanel(2);

    fireEvent.click(screen.getByRole("button", { name: /^3 days$/ }));
    expect(onApplyField).toHaveBeenCalledWith("daysPerWeek");

    fireEvent.click(screen.getByRole("button", { name: /^2 full rest$/ }));
    expect(onApplyField).toHaveBeenCalledWith("restDays");

    // ...and the whole-step button was not involved.
    expect(onApplyField).toHaveBeenCalledTimes(2);
  });

  it("shows the numbers it is recommending, not a generic suggestion", () => {
    renderPanel(2);

    expect(screen.getByRole("button", { name: /^3 days$/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^2 full rest$/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /~2.5h\/wk/ })).toBeInTheDocument();
  });

  it("explains itself on request, and stays quiet until then", () => {
    renderPanel(2);

    expect(screen.queryByText(/three full-body sessions/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /why\?/i }));

    expect(screen.getByText(/three full-body sessions/i)).toBeInTheDocument();
    expect(screen.getByText(/where the adaptation you trained for/i)).toBeInTheDocument();
  });

  it("says plainly that the two unanswerable questions are the athlete's", () => {
    // Equipment is an inventory question and time of day is a life question, so
    // neither gets a recommendation — but the panel must say so rather than
    // leave a blank that reads as an oversight.
    renderPanel(2);
    expect(screen.getByText(/slot you can keep/i)).toBeInTheDocument();

    cleanup();
    renderPanel(3);
    expect(screen.getByText(/only you can give/i)).toBeInTheDocument();
  });

  it("tells an advanced athlete the fields are theirs", () => {
    render(<AdvancedFreedomNote />);

    expect(screen.getByText(/advanced/i)).toBeInTheDocument();
    expect(screen.getByText(/nothing here is pre-filled/i)).toBeInTheDocument();
  });
});

describe("the recommended chip on a single field", () => {
  it("shows the value and applies it on tap", () => {
    const onApply = vi.fn();
    render(<RecommendedChip value="4 days" onApply={onApply} applied={false} />);

    const chip = screen.getByRole("button", { name: /Recommended: 4 days/ });
    fireEvent.click(chip);

    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it("reads as already-applied when the field holds the recommended value", () => {
    render(<RecommendedChip value="4 days" onApply={() => {}} applied />);
    expect(screen.getByRole("button", { name: /Recommended: 4 days/ })).toHaveClass("text-primary");
  });
});
