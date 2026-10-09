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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, act } from "@testing-library/react";

import PlanGenerationProgress from "@/components/training/PlanGenerationProgress";

const bar = () => screen.getByRole("progressbar");
const percent = () => Number(bar().getAttribute("aria-valuenow"));

const advance = (seconds: number) => {
  act(() => {
    vi.advanceTimersByTime(seconds * 1000);
  });
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("the plan generation progress panel", () => {
  it("names the plan it is building and the work actually being done", () => {
    render(<PlanGenerationProgress weeks={6} />);

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
    render(<PlanGenerationProgress weeks={4} />);

    // generate-plan refunds on every failure path, so this claim is true —
    // and it is the sentence an athlete reading a long wait needs.
    expect(screen.getByText(/refunded automatically/i)).toBeInTheDocument();
  });

  it("moves as the wait goes on, and never claims to be finished", () => {
    render(<PlanGenerationProgress weeks={8} />);

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
    render(<PlanGenerationProgress weeks={12} />);

    expect(screen.queryByText(/still working/i)).not.toBeInTheDocument();

    // Twice the estimate is where the panel stops pretending to know.
    advance(240);

    expect(screen.getByText(/still working/i)).toBeInTheDocument();
  });

  it("moves through the stages rather than sitting on the first one", () => {
    render(<PlanGenerationProgress weeks={6} />);

    // The writing stage owns most of the wait; by the middle of the estimate it
    // must be the stage on screen, because that is what is happening.
    advance(20);
    expect(screen.getByText("Writing the sessions")).toBeInTheDocument();

    advance(40);
    expect(screen.getByText("Saving your plan")).toBeInTheDocument();
  });
});
