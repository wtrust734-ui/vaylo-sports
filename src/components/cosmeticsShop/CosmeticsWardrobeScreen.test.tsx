// ============================================================================
// THE WARDROBE SCREEN, DRIVEN
// ----------------------------------------------------------------------------
// Renders the real screen against the real store in LOCAL mode (the mode the
// store exists for: demo, offline preview, tests). What is pinned:
//
//   * the live preview reflects the store's equipped map and UPDATES when the
//     store changes — that is the screen's whole reason to exist;
//   * the category tabs filter the grid;
//   * the buy → equip → equipped lifecycle, end to end through the UI;
//   * a broke athlete cannot tap Buy (disabled with the shortfall);
//   * earn-only items show no buy button at all.
// ============================================================================

import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import CosmeticsWardrobeScreen from "./CosmeticsWardrobeScreen";
import { useCosmeticsShop } from "@/lib/cosmeticsShop/store";
import { DEFAULT_CATALOG } from "@/lib/cosmeticsShop/catalog";
import type { EquippedItems } from "@/lib/cosmeticsShop/types";

const EMPTY_EQUIPPED: EquippedItems = {
  titles: null, borders: null, backdrops: null, nameColors: null, effects: null, avatars: null,
};

beforeEach(() => {
  useCosmeticsShop.setState({
    mode: "local",
    catalog: DEFAULT_CATALOG,
    coins: 2000,
    ownedItemIds: [],
    equipped: { ...EMPTY_EQUIPPED },
    busy: false,
  });
});

describe("CosmeticsWardrobeScreen", () => {
  it("renders the preview card and the titles grid by default", () => {
    render(<CosmeticsWardrobeScreen athleteName="James" />);
    expect(screen.getByTestId("live-preview")).toBeTruthy();
    expect(screen.getByText("James")).toBeTruthy();
    // Titles tab is default: Underdog visible, borders hidden.
    expect(screen.getByText("Underdog")).toBeTruthy();
    expect(screen.queryByText("Silver Border")).toBeNull();
  });

  it("switches categories with the tab bar", () => {
    render(<CosmeticsWardrobeScreen />);
    fireEvent.click(screen.getByRole("tab", { name: "Borders" }));
    expect(screen.getByText("Silver Border")).toBeTruthy();
    expect(screen.queryByText("Underdog")).toBeNull();
  });

  it("the preview updates live when the store equips an item", async () => {
    // Equip through the STORE, not the UI — the preview must react to state
    // changes from anywhere (deep links, share flows, another tab).
    useCosmeticsShop.getState().resetLocalState();
    await useCosmeticsShop.getState().purchaseItem("name_blue");
    render(<CosmeticsWardrobeScreen athleteName="James" />);
    // Before: the name carries no tint.
    expect(screen.getByText("James").style.color).toBe("");
    await act(() => useCosmeticsShop.getState().equipItem("name_blue", "nameColors"));
    // After: Electric Blue (#00E5FF) is applied — however jsdom serialises it.
    await waitFor(() => {
      const color = screen.getByText("James").style.color.toLowerCase();
      expect(color === "#00e5ff" || color === "rgb(0, 229, 255)").toBe(true);
    });
  });

  it("buy → equip → equipped lifecycle works through the UI", async () => {
    render(<CosmeticsWardrobeScreen />);
    fireEvent.click(screen.getByRole("tab", { name: "Borders" }));

    // Locked: shows the ladder price (Silver Border = Rare = 400) and Buy.
    fireEvent.click(screen.getByRole("button", { name: "Buy Silver Border" }));
    await waitFor(() => expect(useCosmeticsShop.getState().ownedItemIds).toContain("border_silver"));
    expect(useCosmeticsShop.getState().coins).toBe(1600);

    // Owned: the button becomes Equip; tapping it equips…
    fireEvent.click(await screen.findByRole("button", { name: "Equip Silver Border" }));
    await waitFor(() => expect(useCosmeticsShop.getState().equipped.borders).toBe("border_silver"));

    // …and the same slot now reads "Equipped", and the preview says so.
    const equippedBtn = await screen.findByRole("button", { name: "Unequip Silver Border" });
    expect(within(equippedBtn).getByText(/Equipped/)).toBeTruthy();
    expect(screen.getByTestId("live-preview").textContent).toContain("Silver Border");
  });

  it("disables Buy with the shortfall when coins are short", () => {
    useCosmeticsShop.setState({ coins: 100 });
    render(<CosmeticsWardrobeScreen />);
    fireEvent.click(screen.getByRole("tab", { name: "Titles" }));
    const goatBuy = screen.getByRole("button", { name: "Buy GOAT" });
    expect((goatBuy as HTMLButtonElement).disabled).toBe(true);
    expect(goatBuy.textContent).toContain("4,700"); // 4800 − 100
  });

  it("earn-only items show no buy button", () => {
    render(<CosmeticsWardrobeScreen />);
    expect(screen.getByText("Earned, never sold")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Buy Founder" })).toBeNull();
  });

  it("the mythic GOAT title is on sale at the ladder price", () => {
    render(<CosmeticsWardrobeScreen />);
    const goat = screen.getByText("GOAT").closest("div")!;
    expect(goat.textContent).toContain("4,800");
  });
});

describe("try-on — tap any card, the preview changes instantly", () => {
  it("previews an UNOWNED item without buying it, and Cancel clears", () => {
    render(<CosmeticsWardrobeScreen />);
    fireEvent.click(screen.getByRole("tab", { name: "Borders" }));

    // Baseline: nothing worn in the border slot.
    expect(screen.getByTestId("live-preview").textContent).toContain("No border");

    // Tap the Gold Border card — not owned, no purchase happened…
    fireEvent.click(screen.getByRole("button", { name: "Preview Gold Border" }));
    // …but the preview wears it instantly.
    expect(screen.getByText("Trying on Gold Border")).toBeTruthy();
    expect(screen.getByTestId("live-preview").textContent).toContain("Gold Border");
    expect(useCosmeticsShop.getState().ownedItemIds).toEqual([]);
    expect(useCosmeticsShop.getState().equipped.borders).toBeNull();

    // Cancel puts the card back to the real look.
    fireEvent.click(screen.getByRole("button", { name: "Cancel preview" }));
    expect(screen.getByTestId("live-preview").textContent).toContain("No border");
  });

  it("tapping the same card again toggles the preview off", () => {
    render(<CosmeticsWardrobeScreen />);
    fireEvent.click(screen.getByRole("tab", { name: "Borders" }));
    const card = screen.getByRole("button", { name: "Preview Gold Border" });
    fireEvent.click(card);
    expect(screen.getByText("Trying on Gold Border")).toBeTruthy();
    fireEvent.click(card);
    expect(screen.queryByText("Trying on Gold Border")).toBeNull();
  });

  it("a try-on preview survives an equip elsewhere and shows the equipped item when idle", async () => {
    // Equip a border through the store, clear try-on: the card must show it.
    await useCosmeticsShop.getState().purchaseItem("border_silver");
    await useCosmeticsShop.getState().equipItem("border_silver", "borders");
    render(<CosmeticsWardrobeScreen />);
    fireEvent.click(screen.getByRole("tab", { name: "Borders" }));
    expect(screen.getByTestId("live-preview").textContent).toContain("Silver Border");

    // Try-on overrides it visually…
    fireEvent.click(screen.getByRole("button", { name: "Preview Gold Border" }));
    expect(screen.getByTestId("live-preview").textContent).toContain("Gold Border");
    // …without changing what is actually equipped.
    expect(useCosmeticsShop.getState().equipped.borders).toBe("border_silver");
  });

  it("switching category tabs clears the try-on", () => {
    render(<CosmeticsWardrobeScreen />);
    fireEvent.click(screen.getByRole("tab", { name: "Borders" }));
    fireEvent.click(screen.getByRole("button", { name: "Preview Gold Border" }));
    expect(screen.getByText("Trying on Gold Border")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Effects" }));
    expect(screen.queryByText("Trying on Gold Border")).toBeNull();
  });
});
