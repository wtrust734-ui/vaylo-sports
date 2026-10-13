// ============================================================================
// THE WAIT SCREEN, RENDERED
// ----------------------------------------------------------------------------
// The unit test next to the estimate proves the numbers are sane. What it
// cannot prove is that an athlete looking at the screen sees anything move —
// and a progress panel that renders one frozen frame is exactly as unhelpful as
// no panel at all, which is what this replaces.
//
// So this file advances the clock and asserts the bar actually advanced, that
// the stage names are the real work (so nobody reads a fake step), and that the
// screen admits when it has run past its own estimate instead of sitting at
// 99% forever.
// ============================================================================

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, act } from "@testing-library/react";

import PlanGenerationProgress from "@/components/training/PlanGenerationProgress";

const bar = () => screen.getByRole("progressbar");
const percent = () => Number(bar().getAttribute("aria-valuenow"));

const advance = (seconds: number) => {
  act(() => {
    vi.advanceTimersByTime(seconds * 1000);
  });
};

/** The component's only timer is a `setInterval` inside `useEffect`, so the
 *  fake clock has to be on before the component mounts, or the interval is
 *  scheduled on the real clock and advancing the fake one moves nothing. No
 *  `runAllTimers` here: the interval never ends, so flushing "all" timers
 *  would run until the runner aborts. Effects flush inside `render` already. */
const renderWith = (children: React.ReactNode) => {
  vi.useFakeTimers();
  const utils = render(children);
  return utils;
};



afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("the plan generation progress panel", () => {
  it("names the plan it is building and the work actually being done", () => {
    const utils = renderWith(<PlanGenerationProgress weeks={6} />);

    expect(screen.getByText(/Building your 6-week plan/i)).toBeInTheDocument();
    // The stages are the function's real pipeline, in order. If a stage name
    // stops matching what the server does, this is where it is noticed.
    expect(screen.getByText("Reading your training history")).toBeInTheDocument();
    expect(screen.getByText("Setting the periodisation")).toBeInTheDocument();
    expect(screen.getByText("Writing the sessions")).toBeInTheDocument();
    expect(screen.getByText("Checking the safety limits")).toBeInTheDocument();
    expect(screen.getByText("Saving your plan")).toBeInTheDocument();
  });

  it("promises only what the server actually does on failure", () => {
    const utils = renderWith(<PlanGenerationProgress weeks={4} />);

    // generate-plan refunds on every failure path, so this claim is true —
    // and it is the sentence an athlete reading a long wait needs.
    expect(screen.getByText(/refunded automatically/i)).toBeInTheDocument();
  });

  it("moves as the wait goes on, and never claims to be finished", () => {
    const utils = renderWith(<PlanGenerationProgress weeks={8} />);

    const start = percent();
    expect(start).toBeGreaterThanOrEqual(0);

    advance(6);
    const later = percent();
    expect(later).toBeGreaterThan(start);

    advance(30);
    expect(percent()).toBeGreaterThan(later);

    // Hard ceiling below 100: the app cannot know when the call returns, so the
    // bar must never be the thing that says it is done.
    advance(600);
    expect(percent()).toBeLessThanOrEqual(94);
  });

  it("stops promising a time and says it is still working instead", () => {
    const utils = renderWith(<PlanGenerationProgress weeks={12} />);

    expect(screen.queryByText(/still working/i)).not.toBeInTheDocument();

    // Twice the estimate is where the panel stops pretending to know. It says
    // so in the header and in the bar track, so there is more than one match.
    advance(240);

    expect(screen.getAllByText(/still working/i).length).toBeGreaterThanOrEqual(1);
  });

  it("covers the screen, and can be dismissed without cancelling the wait", () => {
    const onHide = vi.fn();
    const utils = renderWith(<PlanGenerationProgress weeks={6} onHide={onHide} />);

    // Full screen, and above the floating tab bar (BottomNav is z-50) — a
    // request in flight must not leave a tappable Create button underneath it.
    const overlay = screen.getByTestId("plan-generation-overlay");
    expect(overlay.className).toContain("fixed");
    expect(overlay.className).toContain("inset-0");
    expect(overlay.className).toContain("z-[70]");

    // The way out. Covered-screen with no exit would be a trap, because the
    // request cannot be cancelled from this component.
    fireEvent.click(screen.getByRole("button", { name: /hide/i }));
    expect(onHide).toHaveBeenCalledTimes(1);
  });

  it("shows the same status inline once the overlay is hidden, with no second exit", () => {
    const utils = renderWith(<PlanGenerationProgress weeks={6} variant="inline" />);

    expect(screen.queryByTestId("plan-generation-overlay")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /hide/i })).not.toBeInTheDocument();
    // Same bar, same stages: hiding the overlay is not a downgrade in honesty.
    expect(percent()).toBeGreaterThanOrEqual(0);
    expect(screen.getByText(/refunded automatically/i)).toBeInTheDocument();
  });

  it("moves through the stages rather than sitting on the first one", () => {
    const utils = renderWith(<PlanGenerationProgress weeks={6} />);

    // Asserted on the DETAIL line, not the stage name. Every stage name is on
    // screen from the first render — the list is the pipeline — so `getByText(
    // "Writing the sessions")` passed at any elapsed time and would have kept
    // passing with the stage selector deleted. The detail is rendered for the
    // current stage only, so it is the thing that actually moves.
    expect(screen.queryByText(/Every day of every week/)).not.toBeInTheDocument();

    // The writing stage owns most of the wait; by the middle of the estimate it
    // must be the stage on screen, because that is what is happening.
    advance(20);
    expect(screen.getByText(/Every day of every week/)).toBeInTheDocument();

    advance(40);
    expect(screen.getByText("Almost there")).toBeInTheDocument();
    expect(screen.queryByText(/Every day of every week/)).not.toBeInTheDocument();
  });
});
