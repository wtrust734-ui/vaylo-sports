import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

import PlanBuildProgress, { buildSecondsFor } from "./PlanBuildProgress";

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

const percent = () => Number(screen.getByRole("progressbar").getAttribute("aria-valuenow"));

describe("the plan build screen", () => {
  it("runs a real counter from 0% to 100%", () => {
    vi.useFakeTimers();
    const onComplete = vi.fn();
    render(<PlanBuildProgress weeks={4} seconds={10} onComplete={onComplete} />);

    expect(percent()).toBe(0);
    act(() => vi.advanceTimersByTime(5_000));
    const midway = percent();
    expect(midway).toBeGreaterThan(0);
    expect(midway).toBeLessThan(100);
    expect(onComplete).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(5_500));
    expect(percent()).toBe(100);
    // Holds 100% for a beat before handing over, so completion is visible.
    act(() => vi.advanceTimersByTime(500));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("calls onComplete only once, even if the timer overruns", () => {
    vi.useFakeTimers();
    const onComplete = vi.fn();
    render(<PlanBuildProgress weeks={2} seconds={10} onComplete={onComplete} />);

    act(() => vi.advanceTimersByTime(30_000));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("takes 10-20 seconds depending on the plan length", () => {
    expect(buildSecondsFor(1)).toBeGreaterThanOrEqual(10);
    expect(buildSecondsFor(4)).toBeGreaterThan(10);
    expect(buildSecondsFor(12)).toBeGreaterThan(buildSecondsFor(4));
    expect(buildSecondsFor(52)).toBeLessThanOrEqual(20);
    // Dirty input must not produce NaN seconds.
    expect(Number.isFinite(buildSecondsFor(Number.NaN))).toBe(true);
  });

  it("shows the athlete's own answers going in, not just the work", () => {
    render(
      <PlanBuildProgress
        weeks={6}
        details={["4 training days a week", "2 full rest days", "Your notes applied to every session"]}
        onComplete={() => undefined}
      />,
    );
    // A build screen that lists only the stages reads as a template being
    // filled in; these are the answers the plan is actually built from.
    expect(screen.getByLabelText("What this plan is built from")).toBeInTheDocument();
    expect(screen.getByText("4 training days a week")).toBeInTheDocument();
    expect(screen.getByText("Your notes applied to every session")).toBeInTheDocument();
  });

  it("says what is being built and lists the real stages", () => {
    render(<PlanBuildProgress weeks={6} onComplete={() => undefined} />);
    expect(screen.getByText(/6-week plan/i)).toBeInTheDocument();
    expect(screen.getByText("Reading your answers")).toBeInTheDocument();
    expect(screen.getByText("Building the week")).toBeInTheDocument();
    expect(screen.getByText("Writing the sessions")).toBeInTheDocument();
    expect(screen.getByText("Saving your plan")).toBeInTheDocument();
  });
});
