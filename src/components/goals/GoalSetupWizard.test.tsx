// ============================================================================
// THE GOAL QUIZ, RENDERED
// ----------------------------------------------------------------------------
// src/lib/goalSetup.test.ts pins the rules and the rows. That cannot tell an
// athlete-visible truth about the quiz itself, and there are two of those worth
// a render:
//
//   * a habit-only goal NEVER walks through a target form. That is the whole
//     reason the quiz exists — a weekly habit with no target above it had no
//     entry point before, and a quiz that asks for the target anyway is the same
//     wall with more steps.
//
//   * the taps do something. A template that fills nothing, or a suggested
//     daily action that cannot be ticked, is a label rather than a suggestion.
//
// The wizard is presentational on purpose (the request belongs to the screen),
// so this file needs no Supabase mock: it renders the real component against
// real state and reads what comes out.
// ============================================================================

import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import GoalSetupWizard from "@/components/goals/GoalSetupWizard";
import { emptyDraft, type GoalDraft, type GoalIntent } from "@/lib/goalSetup";

afterEach(cleanup);

/** The page's own shape: the draft is state, and the wizard edits it. */
function renderWizard(intent: GoalIntent = "both") {
  const onCreate = vi.fn();
  const onClose = vi.fn();

  const Harness = () => {
    const [draft, setDraft] = useState<GoalDraft>(() => emptyDraft(intent));
    return (
      <GoalSetupWizard
        draft={draft}
        onDraftChange={setDraft}
        busy={false}
        onCreate={onCreate}
        onClose={onClose}
      />
    );
  };

  render(<Harness />);
  return { onCreate, onClose };
}

const next = () => fireEvent.click(screen.getByRole("button", { name: /next/i }));
/**
 * Answer step 1. Picking an intent advances the quiz by itself (the answer to
 * "what are you setting up?" decides which questions come next), so this lands
 * on the habit step for a habit-inclusive goal and on the target step for a
 * target-only one.
 */
const chooseIntent = (name: RegExp) =>
  fireEvent.click(screen.getByRole("button", { name }));

describe("what the quiz asks", () => {
  it("opens by asking which of the three things is being set up", () => {
    renderWizard();
    expect(screen.getByText(/What are you setting up\?/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /A target I'm chasing/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /A habit I'll do every week/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Both — the habit that gets me there/ })).toBeInTheDocument();
  });

  it("never asks a habit-only goal for a target", () => {
    renderWizard();
    chooseIntent(/A habit I'll do every week/);

    // Straight to the habit...
    expect(screen.getByLabelText("The habit")).toBeInTheDocument();
    // ...and no target question anywhere on the way.
    expect(screen.queryByLabelText("Where you want to be")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Where you are now")).not.toBeInTheDocument();
    expect(screen.queryByText(/What kind of goal is it\?/)).not.toBeInTheDocument();
  });

  it("walks a target-only goal through the numbers and stops", () => {
    renderWizard();
    chooseIntent(/A target I'm chasing/);

    // The target step first.
    expect(screen.getByLabelText(/What do you want to achieve\?/)).toBeInTheDocument();
    next();
    expect(screen.getByLabelText("Where you are now")).toBeInTheDocument();
    expect(screen.getByLabelText("Where you want to be")).toBeInTheDocument();
    next();

    // Review, with no habit step in between.
    expect(screen.queryByLabelText("The habit")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Create my goal/ })).toBeInTheDocument();
  });

  it("counts the steps it will actually ask", () => {
    renderWizard();
    expect(screen.getByText(/step 1 of 6/)).toBeInTheDocument();
    chooseIntent(/A habit I'll do every week/);
    // Four, not six: the target's two questions are gone.
    expect(screen.getByText(/step 2 of 4/)).toBeInTheDocument();
  });
});

describe("the taps do something", () => {
  it("fills the habit and its daily work from a template", () => {
    renderWizard();
    chooseIntent(/A habit I'll do every week/);
    fireEvent.click(screen.getByRole("button", { name: /Run 4× a week/ }));

    expect(screen.getByLabelText("The habit")).toHaveValue("Run 4 times a week");
    expect(screen.getByLabelText("Times a week")).toHaveValue(4);

    next();
    // The template's own actions arrive ticked, because they are the habit.
    const easyRun = screen.getByRole("button", { name: "Easy run" });
    expect(easyRun).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(easyRun);
    expect(screen.getByRole("button", { name: "Easy run" })).toHaveAttribute("aria-pressed", "false");
  });

  it("suggests the daily work from the athlete's own words", () => {
    renderWizard();
    chooseIntent(/A habit I'll do every week/);

    // Nothing picked from the templates: typed by hand instead.
    fireEvent.change(screen.getByLabelText("The habit"), {
      target: { value: "Swim twice a week" },
    });
    next();

    expect(screen.getByRole("button", { name: "Pool session" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Pool session" }));
    expect(screen.getByRole("button", { name: "Pool session" })).toHaveAttribute("aria-pressed", "true");
  });

  it("takes a daily action the suggestions did not name", () => {
    renderWizard();
    chooseIntent(/A habit I'll do every week/);
    fireEvent.change(screen.getByLabelText("The habit"), {
      target: { value: "Lift three times a week" },
    });
    next();

    fireEvent.change(screen.getByLabelText("Add a daily action"), {
      target: { value: "Log the session" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(screen.getByRole("button", { name: "Log the session" })).toHaveAttribute("aria-pressed", "true");
  });

  it("lets a second habit be added rather than forcing one at a time", () => {
    renderWizard();
    chooseIntent(/A habit I'll do every week/);
    fireEvent.click(screen.getByRole("button", { name: /Add another habit/ }));

    expect(screen.getByLabelText("Habit 2")).toBeInTheDocument();
  });
});

describe("the review step", () => {
  it("refuses to create a target with no name, and says why", () => {
    renderWizard("target");
    chooseIntent(/A target I'm chasing/); // → target step
    next(); // → where you are now
    next(); // → review

    expect(screen.getByText(/Give the target a name/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Create my goal/ })).toBeDisabled();
  });

  it("enables creation and hands the screen the answers once they are usable", () => {
    const { onCreate } = renderWizard("habit");
    chooseIntent(/A habit I'll do every week/); // → habit step
    fireEvent.click(screen.getByRole("button", { name: /Run 4× a week/ }));
    next(); // → daily
    next(); // → review

    const create = screen.getByRole("button", { name: /Create my goal/ });
    expect(create).toBeEnabled();
    fireEvent.click(create);

    expect(onCreate).toHaveBeenCalledTimes(1);
    const draft = onCreate.mock.calls[0][0] as GoalDraft;
    expect(draft.intent).toBe("habit");
    expect(draft.habits[0].title).toBe("Run 4 times a week");
    expect(draft.habits[0].dailyActions).toEqual(["Easy run", "Session from the plan"]);
  });

  it("says what is about to be created, and that it is free", () => {
    renderWizard("habit");
    chooseIntent(/A habit I'll do every week/);
    fireEvent.click(screen.getByRole("button", { name: /Run 4× a week/ }));
    next();
    next();

    expect(screen.getByText(/Creates 1 weekly habit/)).toBeInTheDocument();
    expect(screen.getByText(/Weekly Coach Review.*charged separately/s)).toBeInTheDocument();
  });
});
