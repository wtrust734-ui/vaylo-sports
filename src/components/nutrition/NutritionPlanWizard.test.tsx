// ============================================================================
// THE NUTRITION PLAN QUESTIONNAIRE AND THE SAVED PLAN, RENDERED
// ----------------------------------------------------------------------------
// The screen this replaces asked for calorie and macro targets and stored
// whatever the athlete typed. Two things have to be true now, and both are
// silent failures if they are not:
//
//   * the app asks the questions it needs — training days, session length, how
//     active the rest of the day is, dietary pattern, the food they avoid — and
//     shows the athlete the amounts it recommends WITH the reason, because the
//     whole point was that a beginner cannot answer "how many calories",
//   * and the plan they paid for per week can actually be read back afterwards.
//
// The second one is why this file also renders a stored plan: paying for a meal
// plan and being shown a one-line receipt is the bug the viewer exists to fix,
// and a plan whose meals cannot be read must say so instead of rendering empty.
// ============================================================================

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import NutritionPlanWizard from "@/components/nutrition/NutritionPlanWizard";
import SavedNutritionPlan from "@/components/nutrition/SavedNutritionPlan";
import { NUTRITION_INTAKE_DEFAULTS } from "@/lib/nutritionTargets";

afterEach(cleanup);

const renderWizard = (
  overrides: {
    age?: number | null;
    onSaveDob?: (dob: string) => Promise<string | null>;
    savingDob?: boolean;
  } = {},
) => {
  const onSubmit = vi.fn();
  const onClose = vi.fn();
  const onSaveDob = overrides.onSaveDob ?? vi.fn(async () => null);
  render(
    <NutritionPlanWizard
      initial={{ ...NUTRITION_INTAKE_DEFAULTS, weightKg: 80, heightCm: 180 }}
      age={overrides.age === undefined ? 25 : overrides.age}
      onSaveDob={onSaveDob}
      savingDob={overrides.savingDob ?? false}
      costPerWeek={8}
      busy={false}
      onSubmit={onSubmit}
      onClose={onClose}
    />,
  );
  return { onSubmit, onClose, onSaveDob };
};

describe("the nutrition plan questionnaire", () => {
  it("opens on the athlete's own details, with the recommended amounts already worked out", () => {
    renderWizard();

    expect(screen.getByText(/step 1 of 3/i)).toBeTruthy();
    // The recommendation is the answer to "how much should I eat", so it is on
    // screen from the first step rather than hidden behind the last one.
    expect(screen.getByText(/recommended/i)).toBeTruthy();
    expect(screen.getByText(/base metabolism/i)).toBeTruthy();
    expect(screen.getByText(/maintenance about/i)).toBeTruthy();
  });

  it("asks how much they train, not just what they weigh", () => {
    renderWizard();

    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(screen.getByText(/step 2 of 3/i)).toBeTruthy();
    expect(screen.getByText(/days a week/i)).toBeTruthy();
    expect(screen.getByText(/typical session \(minutes\)/i)).toBeTruthy();
    expect(screen.getByText(/mostly seated/i)).toBeTruthy();
    expect(screen.getByText(/physical work/i)).toBeTruthy();
  });

  it("asks what they eat around the plan, and what to keep out of it", () => {
    renderWizard();

    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(screen.getByText(/step 3 of 3/i)).toBeTruthy();
    expect(screen.getByText(/vegan/i)).toBeTruthy();
    expect(screen.getByText(/halal/i)).toBeTruthy();
    expect(screen.getByText(/avoid or react to/i)).toBeTruthy();
  });

  it("hands the screen the recommended numbers, the answers, and the real price", () => {
    const { onSubmit } = renderWizard();

    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    // 8 credits a week x the default 4 weeks.
    const submit = screen.getByRole("button", { name: /write my plan \(32 credits\)/i });
    fireEvent.click(submit);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const draft = onSubmit.mock.calls[0][0];
    expect(draft.usedRecommended).toBe(true);
    // A real derivation, not a placeholder: an 80 kg athlete needs more than
    // 1500 kcal and less than 4000, and the macros sum to roughly the calories.
    expect(draft.targets.calories).toBeGreaterThan(1500);
    expect(draft.targets.calories).toBeLessThan(4000);
    expect(draft.targets.protein_g).toBeGreaterThan(80);
    expect(draft.intake.trainingDaysPerWeek).toBe(NUTRITION_INTAKE_DEFAULTS.trainingDaysPerWeek);
  });

  it("lets the athlete overrule the recommendation instead of hiding the fields", () => {
    const { onSubmit } = renderWizard();

    // Step 1 carries the "I'll set my own numbers" route.
    fireEvent.click(screen.getByRole("button", { name: /set my own numbers/i }));
    const calories = screen.getByLabelText(/calories/i) as HTMLInputElement;
    fireEvent.change(calories, { target: { value: "3100" } });

    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    fireEvent.click(screen.getByRole("button", { name: /write my plan/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0].targets.calories).toBe(3100);
    expect(onSubmit.mock.calls[0][0].usedRecommended).toBe(false);
  });
});

// ============================================================================
// NO DATE OF BIRTH — the dead end this screen used to be
// ----------------------------------------------------------------------------
// Calorie and macro targets are adult-only, and an unknown date of birth counts
// as not-adult (`profiles.date_of_birth` is optional, and almost every account
// has none). The rule stays. What changed is that the question can be ANSWERED
// on this form: the panel that used to say "add it in Profile" now takes it, and
// the request button refuses to look pressable while the fact is missing.
// ============================================================================
describe("an athlete whose date of birth we do not have", () => {
  it("is asked for it here, and it is saved from here", async () => {
    const onSaveDob = vi.fn(async () => null);
    renderWizard({ age: null, onSaveDob });

    const field = screen.getByLabelText(/date of birth/i);
    fireEvent.change(field, { target: { value: "1995-04-02" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(onSaveDob).toHaveBeenCalledWith("1995-04-02"));
  });

  it("cannot ask for a plan that cannot be written", () => {
    renderWizard({ age: null });
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    // The reason is on the button, not in a toast after a tap that could never
    // have worked.
    expect(screen.getByRole("button", { name: /add your date of birth to continue/i })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /write my plan/i })).toBeNull();
  });

  it("is told why a date is refused, rather than it being swallowed", async () => {
    renderWizard({ age: null, onSaveDob: vi.fn(async () => "That date doesn't look right.") });

    fireEvent.change(screen.getByLabelText(/date of birth/i), { target: { value: "2030-01-01" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    expect(await screen.findByText(/doesn't look right/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(screen.getByRole("button", { name: /add your date of birth to continue/i })).toBeDisabled();
  });
});

describe("a saved plan is readable after the week it was bought in", () => {
  const stored = {
    summary: "Two weeks: base, then build.",
    weeks: [
      {
        week: 1,
        focus: "Base",
        calories: 2600,
        protein_g: 160,
        carbs_g: 300,
        fat_g: 80,
        days: [
          {
            day: 1,
            dayName: "Monday",
            meals: [
              { slot: "Breakfast", name: "Oats with berries", description: "80g oats", calories: 520, protein_g: 24, carbs_g: 70, fat_g: 14 },
              { slot: "Lunch", name: "Chicken and rice", description: "180g chicken", calories: 700, protein_g: 55, carbs_g: 75, fat_g: 18 },
            ],
            notes: "",
          },
        ],
      },
    ],
  };

  it("renders the week, the day and the meals that were paid for", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render(<SavedNutritionPlan plan={{ plan_data: stored as any, goal: "Maintain", weeks: 1 }} />);

    expect(screen.getByText(/Monday/)).toBeTruthy();
    expect(screen.getByText(/Oats with berries/)).toBeTruthy();
    expect(screen.getByText(/Chicken and rice/)).toBeTruthy();
  });

  it("says so when a stored plan has no readable meals, rather than showing nothing", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render(<SavedNutritionPlan plan={{ plan_data: { weeks: "not-a-plan" } as any, goal: "Cut", weeks: 4 }} />);

    // The screen's own wording for an unreadable plan (the parser's message),
    // never silence: a paid plan that cannot be read has to say that.
    expect(screen.getByText(/the plan came back empty|no readable meals/i)).toBeTruthy();
  });
});
