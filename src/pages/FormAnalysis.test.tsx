// ============================================================================
// THE FORM TAB, RENDERED — what an athlete is actually shown
// ----------------------------------------------------------------------------
// src/lib/formDrills.test.ts pins the selection rules; this file renders the
// screen so that rule is checked where the athlete meets it. The promise of the
// tab is narrow enough to test literally:
//
//   * a runner reads running drills and never a lifter's or a footballer's
//   * a lifter reads lifting drills and never a runner's
//   * an athlete whose sport the app cannot classify reads everything, with the
//     line that says why — never an empty tab
//   * the paid AI analysis is on the tab for everyone and priced from the
//     credit config, while the drills carry no price
//
// The last one is the pricing contract in one assertion: the tab is free to
// open, the analysis is what costs.
// ============================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import FormAnalysis from "@/pages/FormAnalysis";
import { usePersonalization } from "@/hooks/usePersonalization";
import { familiesForProfile } from "@/lib/personalization/engine";
import { creditCost } from "@/lib/credits";
import "@/i18n"; // initialises i18next with the English bundle (main.tsx does this in the app)

vi.mock("@/hooks/usePersonalization", () => ({
  usePersonalization: vi.fn(),
}));

const mocked = vi.mocked(usePersonalization);

/** Sign in as an athlete whose profile says `sports`, wired the real way. */
function asAthlete(sports: string[]) {
  const athlete = { sports, experience: "established" as const };
  mocked.mockReturnValue({
    athlete,
    families: familiesForProfile(athlete),
    active: sports.length > 0,
    visible: (items: unknown) => items,
  } as unknown as ReturnType<typeof usePersonalization>);
}

function renderForm() {
  render(
    <MemoryRouter>
      <FormAnalysis />
    </MemoryRouter>,
  );
}

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

describe("a runner's Form tab", () => {
  beforeEach(() => asAthlete(["Running"]));

  it("lists running drills and the shared foundations, and nobody else's", () => {
    renderForm();

    expect(screen.getByText("A-Skips")).toBeInTheDocument();
    expect(screen.getByText("Cadence Ladder")).toBeInTheDocument();
    expect(screen.getByText("Hip Hinge (Broomstick)")).toBeInTheDocument(); // foundations

    // Drills written for other sports, by name.
    expect(screen.queryByText("Squat Form")).not.toBeInTheDocument();
    expect(screen.queryByText("Split Step Timing")).not.toBeInTheDocument();
    expect(screen.queryByText("Agility Ladder Patterns")).not.toBeInTheDocument();
    expect(screen.queryByText("Sprawl")).not.toBeInTheDocument();
  });

  it("names the sport the list was tuned to", () => {
    renderForm();
    expect(screen.getByText("Tuned for Running")).toBeInTheDocument();
    expect(screen.getByText("Foundations — every sport")).toBeInTheDocument();
    expect(screen.getByText("For your sport")).toBeInTheDocument();
  });

  it("opens a drill into the why, the how-to and the cues", () => {
    renderForm();

    // Collapsed to start with: the labels only exist once a drill is open.
    expect(screen.queryByText("How to do it")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("A-Skips"));

    expect(screen.getByText("Why it helps")).toBeInTheDocument();
    expect(screen.getByText("How to do it")).toBeInTheDocument();
    expect(screen.getByText("Cues")).toBeInTheDocument();
    expect(screen.getByText(/Drive one knee up to waist height/)).toBeInTheDocument();
    expect(screen.getByText("Knee to waist height")).toBeInTheDocument();
  });
});

describe("a lifter's Form tab", () => {
  beforeEach(() => asAthlete(["Weightlifting"]));

  it("lists lifting drills and never a runner's", () => {
    renderForm();

    expect(screen.getByText("Squat Form")).toBeInTheDocument();
    expect(screen.getByText("Deadlift Setup")).toBeInTheDocument();
    expect(screen.queryByText("A-Skips")).not.toBeInTheDocument();
    expect(screen.queryByText("First Touch (Wall)")).not.toBeInTheDocument();
    expect(screen.getByText("Tuned for Weightlifting")).toBeInTheDocument();
  });
});

describe("an athlete with two sports", () => {
  it("gets both of their own sports in one list", () => {
    asAthlete(["Running", "Tennis"]);
    renderForm();

    expect(screen.getByText("A-Skips")).toBeInTheDocument();
    expect(screen.getByText("Split Step Timing")).toBeInTheDocument();
    expect(screen.queryByText("Squat Form")).not.toBeInTheDocument();
    expect(screen.getByText("Tuned for Running, Tennis")).toBeInTheDocument();
  });
});

describe("an athlete the app cannot classify", () => {
  it("gets every drill rather than an empty tab, and is told why", () => {
    asAthlete([]);
    renderForm();

    expect(screen.getByText("A-Skips")).toBeInTheDocument();
    expect(screen.getByText("Squat Form")).toBeInTheDocument();
    expect(screen.getByText("Sprawl")).toBeInTheDocument();
    expect(screen.getByText(/add a sport to your profile to tune these/)).toBeInTheDocument();
    // No "your sport" heading, because there is no sport to head it with.
    expect(screen.queryByText("For your sport")).not.toBeInTheDocument();
  });

  it("treats the 'Other' bucket as unknown rather than as a sport", () => {
    asAthlete(["Other"]);
    renderForm();

    expect(screen.getByText("A-Skips")).toBeInTheDocument();
    expect(screen.getByText("Squat Form")).toBeInTheDocument();
    expect(screen.getByText(/add a sport to your profile to tune these/)).toBeInTheDocument();
  });
});

describe("the free half and the paid half", () => {
  it("marks the drills free and prices the analysis from the credit config", () => {
    asAthlete(["Running"]);
    renderForm();

    expect(screen.getByText("Free")).toBeInTheDocument();

    const cost = creditCost("video_form_analysis");
    expect(cost).toBeGreaterThan(0);
    expect(screen.getByText(new RegExp(`Analyse a video · ${cost} credits`))).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`${cost} credits per analysis`))).toBeInTheDocument();
  });

  it("keeps the paid analysis on the tab for an athlete with no sport", () => {
    asAthlete([]);
    renderForm();
    expect(screen.getByText("AI Form Analysis")).toBeInTheDocument();
  });

  it("puts no price on the drills themselves", () => {
    asAthlete(["Running"]);
    renderForm();

    // Nothing in the free list carries a credit charge; the only price on the
    // screen belongs to the analysis card.
    const priced = screen.getAllByText(/credits?/i);
    for (const node of priced) {
      expect(node.textContent ?? "").toMatch(/per analysis|Analyse a video|no unlock needed/);
    }
  });
});
