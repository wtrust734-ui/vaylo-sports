// ============================================================================
// COSMETICS SHOP — THE CONTRACT
// ----------------------------------------------------------------------------
// Pins the behaviour the shop promises, in the order the brief stated it:
//
//   purchaseItem  → unknown / earn-only / out-of-season / already-owned /
//                   insufficient-coins are all REFUSED, and a refused
//                   purchase changes nothing (atomicity); a successful one
//                   deducts exactly the ladder price and grants ownership
//                   exactly once.
//   equipItem     → must own it, must be the right category, replaces the
//                   current item in that slot; unequip clears it.
//   server mode   → the client never authors balances: every mutation is
//                   delegated to the adapter and the mirror adopts the
//                   server's snapshot; adapter rejection leaves state
//                   untouched; cheap refusals never reach the network.
//   catalogue     → ≥15 items, every category, every rarity, unique ids,
//                   prices exactly on the rarity ladder.
// ============================================================================

import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_CATALOG, MOCK_CATALOG, SEASONAL_XMAS_HAT } from "./catalog";
import {
  useCosmeticsShop,
  setShopServerAdapter,
  purchasableNow,
  equippedItems,
  type ShopServerAdapter,
  type ShopSnapshot,
} from "./store";
import {
  RARITY_LADDER,
  isAvailableNow,
  type CosmeticCategory,
  type CosmeticItem,
  type EquippedItems,
} from "./types";

const EMPTY_EQUIPPED: EquippedItems = {
  titles: null, borders: null, backdrops: null, nameColors: null, effects: null, avatars: null,
};

const store = () => useCosmeticsShop.getState();

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

// ---------------------------------------------------------------------------
describe("purchaseItem — local mode", () => {
  it("refuses an item that does not exist", async () => {
    const res = await store().purchaseItem("title_nothing");
    expect(res).toMatchObject({ ok: false, reason: "unknown_item" });
  });

  it("refuses an earn-only item at any price", async () => {
    const res = await store().purchaseItem("title_founder");
    expect(res).toMatchObject({ ok: false, reason: "not_purchasable" });
    expect(store().coins).toBe(2000);
  });

  it("refuses a seasonal item outside its window", async () => {
    // Store-level: swap in a catalogue with an item windowed far in the past.
    const past: CosmeticItem = {
      id: "seasonal_test", name: "Old Hat", category: "avatars", rarity: "epic",
      priceCoins: 900, description: "", style: {}, icon: "gift",
      availableFrom: "2020-12-01", availableTo: "2021-01-05",
    };
    useCosmeticsShop.setState({ catalog: [past] });
    const res = await store().purchaseItem("seasonal_test");
    expect(res).toMatchObject({ ok: false, reason: "out_of_season" });
    expect(store().coins).toBe(2000);
  });

  it("succeeds: deducts the ladder price and grants ownership exactly once", async () => {
    const res = await store().purchaseItem("title_underdog"); // common = 150
    expect(res).toMatchObject({ ok: true, priceCoins: 150, coinsRemaining: 1850 });
    expect(store().coins).toBe(1850);
    expect(store().ownedItemIds).toEqual(["title_underdog"]);
    expect(store().owns("title_underdog")).toBe(true);

    const again = await store().purchaseItem("title_underdog");
    expect(again).toMatchObject({ ok: false, reason: "already_owned" });
    expect(store().coins).toBe(1850); // no double deduction
    expect(store().ownedItemIds).toHaveLength(1);
  });

  it("refuses when coins are short, and the refusal is atomic", async () => {
    useCosmeticsShop.setState({ coins: 4799 }); // 1 short of the mythic price
    const res = await store().purchaseItem("aura_champion");
    expect(res).toMatchObject({ ok: false, reason: "insufficient_coins" });
    // Atomicity: balance and inventory are exactly as they were.
    expect(store().coins).toBe(4799);
    expect(store().ownedItemIds).toEqual([]);
  });

  it("refusing never mutates, so a later affordable purchase still works", async () => {
    useCosmeticsShop.setState({ coins: 100 });
    await store().purchaseItem("border_gold"); // 900 → refused
    useCosmeticsShop.setState({ coins: 400 });
    const ok = await store().purchaseItem("name_blue"); // 400 → exact balance
    expect(ok.ok).toBe(true);
    expect(store().coins).toBe(0);
    expect(store().ownedItemIds).toEqual(["name_blue"]);
  });
});

// ---------------------------------------------------------------------------
describe("equipItem / unequipItem — local mode", () => {
  beforeEach(async () => {
    await store().purchaseItem("border_gold");
    await store().purchaseItem("border_silver");
  });

  it("refuses to equip what you do not own", async () => {
    const res = await store().equipItem("border_neon", "borders");
    expect(res).toMatchObject({ ok: false, reason: "not_owned" });
    expect(store().equipped.borders).toBeNull();
  });

  it("refuses an item aimed at the wrong category", async () => {
    const res = await store().equipItem("border_gold", "titles");
    expect(res).toMatchObject({ ok: false, reason: "category_mismatch" });
  });

  it("equips, replaces within the slot, and unequip clears", async () => {
    expect((await store().equipItem("border_gold", "borders")).ok).toBe(true);
    expect(store().equipped.borders).toBe("border_gold");

    // A second item in the same slot replaces the first — one border at a time.
    expect((await store().equipItem("border_silver", "borders")).ok).toBe(true);
    expect(store().equipped.borders).toBe("border_silver");

    // Other slots are untouched.
    expect(store().equipped.titles).toBeNull();

    expect((await store().unequipItem("borders")).ok).toBe(true);
    expect(store().equipped.borders).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("server mode — the client mirrors, never authors", () => {
  const makeFake = () => {
    const server: { coins: number; owned: string[]; equipped: EquippedItems } = {
      coins: 1000,
      owned: [],
      equipped: { ...EMPTY_EQUIPPED },
    };
    const adapter: ShopServerAdapter = {
      purchase: vi.fn(async (item: CosmeticItem) => {
        server.coins -= item.priceCoins;
        server.owned.push(item.id);
        return { ok: true as const };
      }),
      equip: vi.fn(async (item: CosmeticItem) => {
        server.equipped = { ...server.equipped, [item.category]: item.id };
        return { ok: true as const };
      }),
      unequip: vi.fn(async (slot) => {
        // Real column names — mirrors the unequip_cosmetic p_slot validation.
        const bySlot: Record<string, CosmeticCategory> = {
          title_id: "titles", border_id: "borders", background_id: "backdrops",
          name_color_id: "nameColors", effect_id: "effects",
        };
        server.equipped = { ...server.equipped, [bySlot[slot]]: null };
        return { ok: true as const };
      }),
      snapshot: vi.fn(async (): Promise<ShopSnapshot> => ({
        coins: server.coins,
        ownedItemIds: [...server.owned],
        equipped: { ...server.equipped },
      })),
    };
    return { adapter, server };
  };

  it("delegates the purchase and adopts the server's snapshot", async () => {
    const { adapter, server } = makeFake();
    setShopServerAdapter(adapter);
    await store().setMode("server");

    const res = await store().purchaseItem("border_gold"); // 900 of 1000
    expect(res).toMatchObject({ ok: true, coinsRemaining: 100 });
    expect(adapter.purchase).toHaveBeenCalledTimes(1);
    // The STORE's balance is whatever the server says, not a client deduction.
    expect(store().coins).toBe(100);
    expect(store().ownedItemIds).toEqual(["border_gold"]);
    expect(server.coins).toBe(100);
  });

  it("a cheap refusal never reaches the network", async () => {
    const { adapter } = makeFake();
    setShopServerAdapter(adapter);
    await store().setMode("server");
    useCosmeticsShop.setState({ coins: 100 }); // below the 150 common price

    const res = await store().purchaseItem("title_underdog");
    expect(res).toMatchObject({ ok: false, reason: "insufficient_coins" });
    expect(adapter.purchase).not.toHaveBeenCalled();
  });

  it("an adapter rejection changes nothing", async () => {
    const { adapter } = makeFake();
    adapter.purchase = vi.fn(async () => ({ ok: false as const, message: "server said no" }));
    setShopServerAdapter(adapter);
    await store().setMode("server");
    const before = { ...store() };

    const res = await store().purchaseItem("title_underdog");
    expect(res).toMatchObject({ ok: false, reason: "server_rejected", message: "server said no" });
    expect(store().coins).toBe(before.coins);
    expect(store().ownedItemIds).toEqual(before.ownedItemIds);
  });

  it("equip/unequip route through the adapter and resync", async () => {
    const { adapter } = makeFake();
    setShopServerAdapter(adapter);
    await store().setMode("server");
    useCosmeticsShop.setState({ coins: 5000, ownedItemIds: ["border_gold"] });

    await store().equipItem("border_gold", "borders");
    expect(adapter.equip).toHaveBeenCalledTimes(1);
    expect(store().equipped.borders).toBe("border_gold");

    await store().unequipItem("borders");
    expect(adapter.unequip).toHaveBeenCalledTimes(1);
    expect(store().equipped.borders).toBeNull();
  });

  it("grantCoins is inert in server mode", async () => {
    const { adapter } = makeFake();
    setShopServerAdapter(adapter);
    await store().setMode("server");
    store().grantCoins(9999);
    expect(store().coins).toBe(1000); // server snapshot, untouched
  });
});

// ---------------------------------------------------------------------------
describe("catalogue integrity", () => {
  it("carries at least 15 items across every category and rarity", () => {
    expect(MOCK_CATALOG.length).toBeGreaterThanOrEqual(15);
    const cats = new Set(MOCK_CATALOG.map((i) => i.category));
    for (const c of ["titles", "borders", "backdrops", "nameColors", "effects", "avatars"] as const) {
      expect(cats.has(c), `missing category ${c}`).toBe(true);
    }
    const rarities = new Set(MOCK_CATALOG.map((i) => i.rarity));
    for (const r of ["common", "rare", "epic", "legendary", "mythic"] as const) {
      expect(rarities.has(r), `missing rarity ${r}`).toBe(true);
    }
  });

  it("has unique ids, icon references, and prices exactly on the server ladder", () => {
    const ids = MOCK_CATALOG.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const item of MOCK_CATALOG) {
      expect(item.priceCoins, item.id).toBe(RARITY_LADDER[item.rarity].priceCoins);
      expect(item.icon, `${item.id} icon`).toBeTruthy();
    }
  });

  it("includes the five items the brief named", () => {
    const names = MOCK_CATALOG.map((i) => i.name);
    for (const n of ["Underdog", "Gold Border", "Galaxy Background", "Electric Blue Name", "Click Spark Effect"]) {
      expect(names, n).toContain(n);
    }
  });
});

// ---------------------------------------------------------------------------
describe("seasonal availability + derived helpers", () => {
  it("isAvailableNow honours windows inclusively", () => {
    // The seasonal hat is its own export (deliberately excluded from both
    // catalogs so the Avatar Studio stays the only avatar seller).
    const hat = SEASONAL_XMAS_HAT;
    expect(isAvailableNow(hat, new Date("2026-12-25T12:00:00"))).toBe(true);
    expect(isAvailableNow(hat, new Date("2026-10-17T12:00:00"))).toBe(false);
    expect(isAvailableNow(hat, new Date("2027-01-05T23:00:00"))).toBe(true);
    expect(isAvailableNow(hat, new Date("2027-01-06T00:00:01"))).toBe(false);
    const plain = MOCK_CATALOG[0];
    expect(isAvailableNow(plain, new Date("1999-01-01"))).toBe(true);
  });

  it("purchasableNow hides owned, earn-only and out-of-season items", () => {
    useCosmeticsShop.setState({ ownedItemIds: ["title_underdog"], coins: 99999 });
    const list = purchasableNow(store());
    expect(list.some((i) => i.id === "title_underdog")).toBe(false); // owned
    expect(list.some((i) => i.id === "title_founder")).toBe(false); // earn-only
    expect(list.some((i) => i.id === "seasonal_xmas_hat")).toBe(false); // out of season (Oct 2026)
    expect(list.length).toBeGreaterThanOrEqual(20);
  });

  it("equippedItems resolves the look to full items for preview", async () => {
    await store().purchaseItem("border_gold");
    await store().equipItem("border_gold", "borders");
    const look = equippedItems(store());
    expect(look.borders?.name).toBe("Gold Border");
    expect(look.titles).toBeUndefined();
  });
});
