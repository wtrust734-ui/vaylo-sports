import { describe, expect, it } from "vitest";
import { calorieRangeLabel, parseCalorieScan } from "./calorieScan";

const scan = (overrides: Record<string, unknown> = {}) => ({
  name: "Chicken rice bowl",
  calories: 500,
  protein: 40,
  carbs: 55,
  fat: 12,
  fiber: 4,
  confidence: "medium",
  ...overrides,
});

describe("parseCalorieScan", () => {
  it("uses the components, not a headline that disagrees with them", () => {
    const parsed = parseCalorieScan(
      scan({
        calories: 900,
        items: [
          { name: "Cooked white rice", grams: 200, calories: 260, protein: 5, carbs: 56, fat: 1, fiber: 1 },
          { name: "Chicken breast", grams: 150, calories: 250, protein: 46, carbs: 0, fat: 6, fiber: 0 },
          { name: "Olive oil", grams: 10, calories: 90, protein: 0, carbs: 0, fat: 10, fiber: 0 },
        ],
      }),
    );
    expect(parsed).not.toBeNull();
    // 260 + 250 + 90 = 600, not the invented 900.
    expect(parsed!.calories).toBe(600);
    expect(parsed!.items).toHaveLength(3);
    expect(parsed!.protein).toBe(51);
  });

  it("measures a component from its quantity and density, not its stated calories", () => {
    const parsed = parseCalorieScan(
      scan({
        items: [
          // 200 g at 130 kcal/100 g = 260 kcal, whatever headline it repeats.
          { name: "Cooked white rice", grams: 200, kcal_per_100g: 130, calories: 999 },
          // 150 g at 165 kcal/100 g = 247.5 → 250 kcal.
          { name: "Chicken breast", grams: 150, kcal_per_100g: 165, calories: 120 },
        ],
      }),
    );
    expect(parsed!.items.map((item) => item.calories)).toEqual([260, 250]);
    expect(parsed!.calories).toBe(510);
    expect(parsed!.items[0]?.kcalPer100g).toBe(130);
  });

  it("derives a component's calories from its macros when it has no calorie field", () => {
    const parsed = parseCalorieScan(
      scan({
        items: [
          { name: "Greek yoghurt", grams: 170, protein: 17, carbs: 6, fat: 0, fiber: 0 },
        ],
      }),
    );
    // 4×17 + 4×6 + 9×0 + 2×0 = 92 → 90 (nearest 5).
    expect(parsed!.calories).toBe(90);
  });

  it("keeps a usable range around the reconciled total", () => {
    const parsed = parseCalorieScan(scan({ calories: 520, confidence: "low" }));
    expect(parsed!.calories_low).toBeLessThan(parsed!.calories);
    expect(parsed!.calories_high).toBeGreaterThan(parsed!.calories);
    expect(calorieRangeLabel(parsed!)).toContain("kcal");
  });

  it("rejects an answer that is not a meal instead of logging zero calories", () => {
    expect(parseCalorieScan(scan({ name: "Not a meal", calories: 0 }))).toBeNull();
    expect(parseCalorieScan(null)).toBeNull();
    expect(parseCalorieScan({ name: "Salad" })).toBeNull();
  });

  it("drops malformed components but keeps the ones that can be logged", () => {
    const parsed = parseCalorieScan(
      scan({
        items: [
          { name: "", calories: 100 },
          { name: "Rice", grams: "150", calories: 200 },
          { nonsense: true },
        ],
      }),
    );
    expect(parsed!.items).toHaveLength(1);
    expect(parsed!.items[0]?.name).toBe("Rice");
    expect(parsed!.calories).toBe(200);
  });
});
