import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/hooks/useAchievementStats", () => ({
  useAchievementStats: () => ({
    stats: {},
    earnedAchievements: [],
    earnedIds: new Set(["first_workout", "mental_owner"]),
  }),
}));

import TrophyRoom from "./TrophyRoom";

const renderPage = () =>
  render(
    <MemoryRouter>
      <TrophyRoom />
    </MemoryRouter>,
  );

afterEach(cleanup);

describe("Trophy Room", () => {
  it("shows only what the account holds — earned medals and owned badges", () => {
    renderPage();

    expect(screen.getByText("First Steps")).toBeInTheDocument(); // earned achievement
    expect(screen.getByText("Mental Gym Owner")).toBeInTheDocument(); // owned badge
    // A catalogue rule that has not been earned is not in the case.
    expect(screen.queryByText("Getting Started")).not.toBeInTheDocument();
    expect(screen.queryByText("Locked")).not.toBeInTheDocument();
  });

  it("counts both kinds of trophy in one case", () => {
    renderPage();
    expect(screen.getByText("Medals")).toBeInTheDocument();
    // "Badges" is both a stat label and a shelf heading — both belong here.
    expect(screen.getAllByText("Badges").length).toBeGreaterThan(0);
    // Both shelves state their own progress — one medal, one badge.
    expect(screen.getAllByText(/1 of/)).toHaveLength(2);
  });
});
