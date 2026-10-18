// ============================================================================
// FLEX CARD — what the share image actually says
// ----------------------------------------------------------------------------
// The card is captured verbatim by html2canvas, so its rendered text IS the
// shared message. These tests pin the parts an athlete's friends would read:
// the rarity headline, the item showcase, the athlete strip, and the
// branded footer — for the tiers where the hype copy changes.
// ============================================================================

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import FlexCard from "./FlexCard";
import { MOCK_CATALOG } from "@/lib/cosmeticsShop/catalog";
import type { CosmeticItem } from "@/lib/cosmeticsShop/types";

const item = (id: string): CosmeticItem => MOCK_CATALOG.find((i) => i.id === id)!;

describe("FlexCard", () => {
  it("shouts the mythic headline over the mythic item", () => {
    render(<FlexCard item={item("title_goat")} athleteName="James" />);
    expect(screen.getByText("NEW MYTHIC UNLOCKED!")).toBeTruthy();
    expect(screen.getByText("GOAT")).toBeTruthy();
    expect(screen.getByText("Greatest of all time.")).toBeTruthy();
    expect(screen.getByText("Mythic")).toBeTruthy();
  });

  it("uses the legendary headline for legendary unlocks", () => {
    render(<FlexCard item={item("bg_galaxy")} athleteName="James" />);
    expect(screen.getByText("LEGENDARY STATUS ACHIEVED")).toBeTruthy();
    expect(screen.getByText("Galaxy Background")).toBeTruthy();
  });

  it("shows the athlete strip with streak, level and worn look when given", () => {
    render(
      <FlexCard
        item={item("title_goat")}
        athleteName="James"
        streakDays={42}
        level={7}
        look={{ title: "GOAT", border: "Gold Border", backdrop: "Galaxy Background" }}
      />,
    );
    expect(screen.getByText("James")).toBeTruthy();
    expect(screen.getByText(/42-day streak/)).toBeTruthy();
    expect(screen.getByText(/Level 7/)).toBeTruthy();
    expect(screen.getByText("GOAT · Gold Border · Galaxy Background")).toBeTruthy();
  });

  it("carries the branded footer CTA", () => {
    render(<FlexCard item={item("title_underdog")} athleteName="James" />);
    expect(screen.getByText(/Vaylo Sports · Train like a pro/)).toBeTruthy();
  });
});
