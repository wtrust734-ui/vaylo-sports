import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

import InjuryPlanProgress from "./InjuryPlanProgress";
import { INJURY_PROGRESS_CEILING } from "@/lib/injuryPlan";

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

const percent = () =>
  Number(screen.getByRole("progressbar").getAttribute("aria-valuenow"));

describe("the injury plan wait screen", () => {
  it("shows a real percentage that climbs but never claims 100% before the plan exists", () => {
    vi.useFakeTimers();
    render(<InjuryPlanProgress bodyPart="Knee" severity={5} done={false} seconds={12} />);

    expect(percent()).toBe(0);
    expect(screen.getByText("0%")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(6_000));
    const midway = percent();
    expect(midway).toBeGreaterThan(0);
    expect(midway).toBeLessThan(INJURY_PROGRESS_CEILING);

    act(() => vi.advanceTimersByTime(20_000));
    // The answer has not arrived, so the bar holds — a plan screen must not
    // reach 100% on a timer.
    expect(percent()).toBe(INJURY_PROGRESS_CEILING);
    expect(screen.getByText(`${INJURY_PROGRESS_CEILING}%`)).toBeInTheDocument();
  });

  it("completes only when the plan has been written and saved", () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <InjuryPlanProgress bodyPart="Hamstring" severity={6} done={false} seconds={12} />,
    );
    act(() => vi.advanceTimersByTime(4_000));
    expect(percent()).toBeLessThan(100);

    rerender(<InjuryPlanProgress bodyPart="Hamstring" severity={6} done seconds={12} />);
    expect(percent()).toBe(100);
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("names the injury it is writing for and the stages the plan goes through", () => {
    render(<InjuryPlanProgress bodyPart="Achilles" severity={4} done={false} />);
    expect(screen.getByText("Achilles · severity 4/10")).toBeInTheDocument();
    expect(screen.getByText("Reading your injury log")).toBeInTheDocument();
    expect(screen.getByText("Checking your training week")).toBeInTheDocument();
    expect(screen.getByText("Writing the rehab work")).toBeInTheDocument();
    expect(screen.getByText("Saving it to this injury")).toBeInTheDocument();
    // The wait is stated, not implied, and the refund rule is on screen.
    expect(screen.getByText(/10–20 seconds/i)).toBeInTheDocument();
    expect(screen.getByText(/credits are only kept/i)).toBeInTheDocument();
  });
});
