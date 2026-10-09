// ============================================================================
// COACH DIRECTORY — the roster, rendered
// ----------------------------------------------------------------------------
// The product's first question about this feature was "I should be able to see
// all the people who have signed up to be a coach". That is a rendering claim,
// not a data claim: the query can be right and the screen can still show nobody.
// So this file renders the component with a fake roster rather than asserting
// over its source.
//
// Two states are covered that only a render can distinguish:
//
//   * A coach with no published plans must read "No plans published yet" and
//     have their View plans button disabled — a zero there reads as a score,
//     and a disabled button is the only thing stopping a click that goes
//     nowhere.
//   * The empty roster must say so honestly rather than look broken, because
//     this marketplace ships with zero coaches on purpose.
//
// The tab itself is asserted through the real flag function, both ways: on, the
// Coaches tab is in the nav; off, it is not. That is the whole hiding
// mechanism, and src/config/featureFlags.test.ts pins the shipped default to off.
// ============================================================================

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import CoachDirectory from "@/components/coach/CoachDirectory";
import { fetchCoachRoster, type CoachRosterEntry } from "@/lib/coachMarketplace";

vi.mock("@/lib/coachMarketplace", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/coachMarketplace")>();
  return { ...actual, fetchCoachRoster: vi.fn() };
});

const roster = (): CoachRosterEntry[] => [
  {
    user_id: "u-ada",
    display_name: "Ada Kwarteng",
    bio: "Marathon pacing and threshold work.",
    specialties: ["Running", "Marathon"],
    verified: true,
    coach_since: "2026-10-01",
    listing_count: 3,
    lowest_net_cents: 500,
  },
  {
    user_id: "u-ben",
    display_name: "Ben Osei",
    bio: null,
    specialties: ["Strength"],
    verified: null,
    coach_since: null,
    listing_count: 0,
    lowest_net_cents: null,
  },
];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("the roster", () => {
  it("shows every coach who signed up, with what they teach", async () => {
    vi.mocked(fetchCoachRoster).mockResolvedValue(roster());

    render(<CoachDirectory />);

    // Both coaches appear — not only the one with something for sale, because
    // "who signed up" is the question the screen answers.
    expect(await screen.findByText("Ada Kwarteng")).toBeInTheDocument();
    expect(screen.getByText("Ben Osei")).toBeInTheDocument();
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.getByText("Marathon")).toBeInTheDocument();
    expect(screen.getByText("Strength")).toBeInTheDocument();

    // The fee is stated where a visitor decides whether to trust the price.
    expect(screen.getByText(/buyer pays that price plus Vaylo's 20% fee/)).toBeInTheDocument();
  });

  it("distinguishes a coach with plans from one with none", async () => {
    vi.mocked(fetchCoachRoster).mockResolvedValue(roster());

    // `onSelect` is how the real Coaching section mounts it (it filters the plan
    // list rather than navigating), and the card only offers View plans when it
    // has somewhere to go.
    const onSelect = vi.fn();
    render(<CoachDirectory onSelect={onSelect} />);

    const ada = await screen.findByText("Ada Kwarteng");
    const adaCard = ada.closest(".rounded-2xl") as HTMLElement;
    expect(within(adaCard).getByText(/3 plans/)).toBeInTheDocument();
    const adaButton = within(adaCard).getByRole("button", { name: "View plans" });
    expect(adaButton).toBeEnabled();
    fireEvent.click(adaButton);
    expect(onSelect).toHaveBeenCalledWith("u-ada");

    const ben = screen.getByText("Ben Osei");
    const benCard = ben.closest(".rounded-2xl") as HTMLElement;
    // "no plans yet" rather than a zero, and a button that cannot be pressed.
    expect(within(benCard).getByText("No plans published yet")).toBeInTheDocument();
    expect(within(benCard).getByRole("button", { name: "View plans" })).toBeDisabled();
  });

  it("says so honestly when nobody has signed up yet", async () => {
    vi.mocked(fetchCoachRoster).mockResolvedValue([]);

    render(<CoachDirectory />);

    expect(await screen.findByText("No coaches have joined yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create a coach account" })).toBeInTheDocument();
    // The loading state must not be what a visitor is left looking at.
    expect(screen.queryByText("Loading coaches…")).not.toBeInTheDocument();
  });

  it("offers search once the list is long enough to need it", async () => {
    vi.mocked(fetchCoachRoster).mockResolvedValue([
      ...roster(),
      ...Array.from({ length: 5 }, (_, i) => ({
        user_id: `u-${i}`,
        display_name: `Coach ${i}`,
        bio: null,
        specialties: ["Cycling"],
        verified: null,
        coach_since: null,
        listing_count: 1,
        lowest_net_cents: 900,
      })),
    ]);

    render(<CoachDirectory />);

    const search = await screen.findByPlaceholderText(/Search coaches by name or specialty/);
    fireEvent.change(search, { target: { value: "ada" } });

    await waitFor(() => {
      expect(screen.getByText("Ada Kwarteng")).toBeInTheDocument();
      expect(screen.queryByText("Coach 3")).not.toBeInTheDocument();
    });
  });

  it("survives a roster query that fails", async () => {
    // fetchCoachRoster returns [] and logs rather than throwing, but the
    // component must never be left in the loading state either way.
    vi.mocked(fetchCoachRoster).mockResolvedValue([]);

    render(<CoachDirectory />);

    expect(await screen.findByText("No coaches have joined yet")).toBeInTheDocument();
  });
});

describe("the Coaches tab", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    cleanup();
  });

  it("is in the nav when the flag is on, and absent when it is off", async () => {
    const loadNav = async () => {
      const { default: MarketSectionNav } = await import("@/components/market/MarketSectionNav");
      const { isFlagOn } = await import("@/config/featureFlags");
      return { isFlagOn, MarketSectionNav };
    };

    // Flag on: the tab exists.
    vi.stubEnv("VITE_ENABLE_coachMarketplace", "true");
    vi.resetModules();
    const on = await loadNav();
    expect(on.isFlagOn("coachMarketplace")).toBe(true);
    const shown = render(<on.MarketSectionNav active="packs" onChange={() => {}} />);
    expect(screen.getByRole("button", { name: /Coaches/ })).toBeInTheDocument();
    shown.unmount();

    // Flag off: it is not rendered at all, rather than rendered empty. An empty
    // tab is what a switched-off feature looks like when it is broken.
    vi.unstubAllEnvs();
    vi.resetModules();
    const off = await loadNav();
    expect(off.isFlagOn("coachMarketplace")).toBe(false);
    render(<off.MarketSectionNav active="packs" onChange={() => {}} />);
    expect(screen.queryByRole("button", { name: /Coaches/ })).not.toBeInTheDocument();
  });
});
