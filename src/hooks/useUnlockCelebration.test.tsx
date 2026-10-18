// ============================================================================
// USE UNLOCK CELEBRATION — when the flex fires, and when it must not
// ----------------------------------------------------------------------------
// The trigger's whole value is its restraint: it must fire for an epic+ unlock
// that happens while the athlete is shopping, and it must NOT fire for
// common/rare purchases, for items already owned at mount (a snapshot sync
// must not re-celebrate a month-old mythic), or twice for the same item.
// ============================================================================

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useUnlockCelebration } from "./useUnlockCelebration";
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
    coins: 20000,
    ownedItemIds: [],
    equipped: { ...EMPTY_EQUIPPED },
    busy: false,
  });
});

const buy = async (id: string) => {
  const res = await useCosmeticsShop.getState().purchaseItem(id);
  expect(res.ok).toBe(true);
};

describe("useUnlockCelebration", () => {
  it("stays quiet at baseline and for common/rare purchases", async () => {
    const { result } = renderHook(() => useUnlockCelebration());
    expect(result.current.item).toBeNull();

    await act(() => buy("title_underdog")); // common
    expect(result.current.item).toBeNull();
    await act(() => buy("name_blue")); // rare
    expect(result.current.item).toBeNull();
  });

  it("celebrates an epic unlock the moment it lands", async () => {
    const { result } = renderHook(() => useUnlockCelebration());
    await act(() => buy("border_gold")); // epic
    expect(result.current.item?.id).toBe("border_gold");
    expect(result.current.item?.name).toBe("Gold Border");
  });

  it("does NOT re-celebrate items owned before the hook mounted", () => {
    useCosmeticsShop.setState({ ownedItemIds: ["title_goat", "bg_galaxy"] });
    const { result } = renderHook(() => useUnlockCelebration());
    expect(result.current.item).toBeNull();
    // A store re-sync that re-lists the same ids is also not news.
    act(() => useCosmeticsShop.setState({ ownedItemIds: ["title_goat", "bg_galaxy"] }));
    expect(result.current.item).toBeNull();
  });

  it("dismiss clears the card and the same item never re-fires", async () => {
    const { result } = renderHook(() => useUnlockCelebration());
    await act(() => buy("border_gold"));
    expect(result.current.item?.id).toBe("border_gold");

    act(() => result.current.dismiss());
    expect(result.current.item).toBeNull();

    // A later unrelated store change must not resurrect the dismissed card.
    act(() => useCosmeticsShop.setState({ coins: 1234 }));
    expect(result.current.item).toBeNull();
  });

  it("a second unlock celebrates the newest one", async () => {
    const { result } = renderHook(() => useUnlockCelebration());
    await act(() => buy("border_gold")); // epic
    await act(() => buy("bg_galaxy"));   // legendary, later
    expect(result.current.item?.id).toBe("bg_galaxy");
  });
});
