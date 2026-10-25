import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/hooks/useAchievementStats", () => ({
  useAchievementStats: () => ({
    stats: {},
    earnedAchievements: [],
    earnedIds: new Set(["first_workout"]),
  }),
}));

import Achievements from "./Achievements";
import { achievementShelf } from "@/lib/achievements";

const renderPage = () =>
  render(
    <MemoryRouter>
      <Achievements />
    </MemoryRouter>,
  );

afterEach(cleanup);

describe("Achievements", () => {
  it("shows the whole catalogue, with locked medals naming what earns them", () => {
    renderPage();

    // Earned.
    expect(screen.getByText("First Steps")).toBeInTheDocument();
    expect(screen.getAllByText("✓ Earned").length).toBeGreaterThan(0);

    // Locked, but present — this is the list of things you can do, not a
    // receipt for things already done. "Getting Started" requires 10 workouts.
    expect(screen.getByText("Getting Started")).toBeInTheDocument();
    expect(screen.getByText("Complete 10 workouts")).toBeInTheDocument();
    expect(screen.getAllByText("Locked").length).toBeGreaterThan(0);
  });

  it("carries more than one hundred earnable achievements", () => {
    renderPage();
    const shelf = achievementShelf();
    expect(shelf.length).toBeGreaterThan(100);
    // Every rule has a written requirement, because that is what the locked
    // row shows an athlete.
    for (const item of shelf) expect(item.desc.trim().length).toBeGreaterThan(0);
  });

  it("filters to only what has been earned", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Earned" }));

    expect(screen.getByText("First Steps")).toBeInTheDocument();
    expect(screen.queryByText("Getting Started")).not.toBeInTheDocument();
  });

  it("has no Personal Bests panel any more", () => {
    renderPage();
    expect(screen.queryByText(/Personal Bests/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Monthly Personal Bests/i)).not.toBeInTheDocument();
  });
});
