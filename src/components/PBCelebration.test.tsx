// ============================================================================
// THE PB CELEBRATION CARD, FIRED FROM NOTHING
// ----------------------------------------------------------------------------
// The card, the trophy claim and the save-flow trigger all existed before
// 2026-10-17 — and the card could still never appear, because it listened for
// a window event that only rendered if some parent mounted <PBCelebration />,
// and no parent did. The event fired; nobody heard it. That is the exact
// failure this file exists to prevent: the trigger must mount the card
// ITSELF, with no help from App.tsx or any route, because the app shell has
// already been rewritten once underneath this feature.
//
// What is pinned here:
//   * triggerPbCelebration, called from the log-save flow with no component
//     tree around it, puts the card on screen — event label, the time, "New
//     Personal Best", and the honest previous best;
//   * trophies earned show their tier medals;
//   * the card carries a Share action (the user's ask: log a PB, get a card,
//     share it);
//   * the source pin: Training.tsx still fires the trigger after the server
//     trophy claim, so the wiring cannot silently drop again.
// ============================================================================

import { readFileSync } from "node:fs";
import path from "node:path";
import { act, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { triggerPbCelebration } from "./PBCelebration";

const fire = (data: Parameters<typeof triggerPbCelebration>[0]) => {
  act(() => {
    triggerPbCelebration(data);
  });
};

describe("PB celebration card", () => {
  it("mounts itself and shows the PB — no parent component required", () => {
    fire({
      eventLabel: "Running · 5K",
      timeSeconds: 1425,
      isPb: true,
      previousSeconds: 1510,
      trophies: [],
    });
    expect(screen.getByText("Running · 5K")).toBeTruthy();
    expect(screen.getByText(/New Personal Best/)).toBeTruthy();
    // 1425s = 23:45 — the time is the point of the card.
    expect(screen.getByText("23:45")).toBeTruthy();
    expect(screen.getByText(/Previous best: 25:10/)).toBeTruthy();
    // The container the trigger created is in the document, proving the
    // self-mount ran rather than some test harness rendering it for us.
    expect(document.getElementById("vaylo-pb-celebration-root")).toBeTruthy();
  });

  it("shows trophy tiers when the time earned them", () => {
    fire({
      eventLabel: "Running · 5K",
      timeSeconds: 1425,
      isPb: true,
      previousSeconds: 1510,
      trophies: [
        { reward_id: "trophy_run_5k_silver", tier: "silver", name: "5K Silver" },
      ],
    });
    expect(screen.getByText("Trophy earned")).toBeTruthy();
    expect(screen.getByText("Silver")).toBeTruthy();
    expect(screen.getByText("Added to your Trophy Case.")).toBeTruthy();
  });

  it("offers a share action", () => {
    fire({
      eventLabel: "Swimming · 100m",
      timeSeconds: 92,
      isPb: true,
      previousSeconds: null,
      trophies: [],
    });
    expect(screen.getByText("Swimming · 100m")).toBeTruthy();
    expect(screen.getByRole("button", { name: /share/i })).toBeTruthy();
  });
});

describe("the save-flow wiring that fires it", () => {
  it("Training.tsx triggers the celebration after claiming event trophies", () => {
    const src = readFileSync(
      path.resolve(__dirname, "../pages/Training.tsx"),
      "utf8",
    );
    // The trigger must sit in the log-save flow, after the server claim, and
    // only fire when there is something to celebrate.
    expect(src).toMatch(/triggerPbCelebration\(\{/);
    expect(src).toMatch(/claim_event_trophies/);
    expect(src).toMatch(/if \(isPb \|\| trophies\.length > 0\)/);
  });
});
