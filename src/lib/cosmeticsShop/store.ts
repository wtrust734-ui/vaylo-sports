// ============================================================================
// COSMETICS SHOP — ZUSTAND STORE
// ----------------------------------------------------------------------------
// One store owns the shop's client state: the catalogue, the coin balance the
// user sees, what they own, and what is equipped. Two authority modes, because
// this app has two honest situations:
//
//   LOCAL  — demo, offline preview and unit tests. This store IS the truth:
//            purchases deduct from the local balance, ownership accumulates,
//            everything persists to localStorage. Nothing here ever runs the
//            live economy; the mode flag says so.
//
//   SERVER — production. The store is a MIRROR: every mutation is delegated
//            to the SECURITY DEFINER RPCs the rest of the app already uses
//            (purchase_cosmetic / equip_cosmetic / unequip_cosmetic for
//            profile items, purchase_avatar_item_coins for avatar items),
//            and after each one the store re-reads the server's snapshot.
//            The client never deducts a live balance itself. That is not
//            stylistic caution — the client-callable add_coins RPC was
//            removed from this codebase precisely because a client that can
//            author balances is a mint (see 20260921090300_coin_economy_
//            hardening.sql). A shop store that "safely deducted credits" in
//            the client would re-open that hole.
//
// The purchase algorithm the brief asked for (verify ownership → check
// balance → deduct → add → re-render) lives in `purchaseLocal` as ONE
// `set()` call, so the deduction and the grant cannot tear: either the whole
// transition happens or none of it does, and every subscribed component
// re-renders once with the consistent state.
//
// Persistence: zustand/middleware `persist` → localStorage
// `vaylo_cosmetics_shop_v1`, partialised to local-mode-owned data only. In
// server mode persisting would risk showing a stale owner/balance the server
// no longer agrees with, so the partialiser drops it and the snapshot sync
// repopulates on mount.
// ============================================================================

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

import { supabase } from "@/integrations/supabase/client";
import { lsGet, lsSet } from "@/lib/localStore";
import { DEMO_MODE } from "@/lib/demoMode";
import { DEFAULT_CATALOG } from "./catalog";
import {
  EQUIP_SLOT,
  SERVER_CATEGORY,
  isAvailableNow,
  type CosmeticCategory,
  type CosmeticItem,
  type EquipResult,
  type EquipSlot,
  type EquippedItems,
  type PurchaseResult,
} from "./types";

// ---------------------------------------------------------------------------
// Server adapter — the seam between this store and the live backend. Tests
// inject a fake; production uses `supabaseShopAdapter` below, which calls the
// same RPCs the existing screens call.
// ---------------------------------------------------------------------------

export interface ShopSnapshot {
  coins: number;
  ownedItemIds: string[];
  equipped: EquippedItems;
}

export interface ShopServerAdapter {
  purchase(item: CosmeticItem): Promise<{ ok: true } | { ok: false; message: string }>;
  equip(item: CosmeticItem): Promise<{ ok: true } | { ok: false; message: string }>;
  unequip(slot: EquipSlot): Promise<{ ok: true } | { ok: false; message: string }>;
  /** Server-truth inventory. Null when it cannot be read (offline, signed out). */
  snapshot(): Promise<ShopSnapshot | null>;
}

const EMPTY_EQUIPPED: EquippedItems = {
  titles: null,
  borders: null,
  backdrops: null,
  nameColors: null,
  effects: null,
  avatars: null,
};

/** Slot column → shop category (inverse of EQUIP_SLOT). */
const CATEGORY_BY_SLOT: Record<EquipSlot, CosmeticCategory> = {
  title_id: "titles",
  border_id: "borders",
  background_id: "backdrops",
  name_color_id: "nameColors",
  effect_id: "effects",
};

/**
 * Tell the rest of the app ownership changed server-side. useCosmetics (the
 * Collection/Profile hook) listens for this and re-reads, so the two surfaces
 * can never show different inventories after a shop-store RPC.
 */
const notifyCosmeticsChanged = () => {
  try {
    window.dispatchEvent(new CustomEvent("vaylo:cosmetics-changed"));
  } catch { /* non-DOM environment — nothing to notify */ }
};

export const supabaseShopAdapter: ShopServerAdapter = {
  async purchase(item) {
    const { error } =
      item.category === "avatars"
        ? await supabase.rpc("purchase_avatar_item_coins" as never, {
            p_item_id: item.id,
            p_category: item.serverCategory ?? SERVER_CATEGORY.avatars,
            p_rarity: item.rarity,
            p_cost: item.priceCoins,
          } as never)
        : await supabase.rpc("purchase_cosmetic" as never, { p_reward_id: item.id } as never);
    return error ? { ok: false, message: error.message } : { ok: true };
  },

  async equip(item) {
    const slot = EQUIP_SLOT[item.category];
    // Avatar items are worn by the avatar, not the profile card; their equip
    // path lives in the Avatar Studio loadout. Routing an avatar id into
    // equip_cosmetic would be a silent server error, so say so plainly.
    if (!slot) return { ok: false, message: "Avatar items are equipped in the Avatar Studio." };
    const { error } = await supabase.rpc("equip_cosmetic" as never, { p_reward_id: item.id } as never);
    return error ? { ok: false, message: error.message } : { ok: true };
  },

  async unequip(slot) {
    const { error } = await supabase.rpc("unequip_cosmetic" as never, { p_slot: slot } as never);
    return error ? { ok: false, message: error.message } : { ok: true };
  },

  async snapshot() {
    const { data: userData } = await supabase.auth.getUser();
    const user = userData?.user;
    if (!user) return null;
    const [ownedRes, equipRes, profileRes] = await Promise.all([
      supabase.from("user_rewards").select("reward_id").eq("user_id", user.id),
      supabase.from("user_profile_cosmetics").select("*").eq("user_id", user.id).maybeSingle(),
      supabase.from("profiles").select("coins").eq("user_id", user.id).maybeSingle(),
    ]);
    if (ownedRes.error) return null;
    const equipped: EquippedItems = { ...EMPTY_EQUIPPED };
    const row = (equipRes.data ?? {}) as Record<string, unknown>;
    (Object.keys(CATEGORY_BY_SLOT) as EquipSlot[]).forEach((slot) => {
      const v = row[slot];
      if (typeof v === "string" && v) equipped[CATEGORY_BY_SLOT[slot]] = v;
    });
    return {
      coins: ((profileRes.data as { coins?: number } | null)?.coins ?? 0),
      ownedItemIds: (ownedRes.data ?? []).map((r: { reward_id: string }) => r.reward_id),
      equipped,
    };
  },
};

let serverAdapter: ShopServerAdapter = supabaseShopAdapter;
/** Inject a fake adapter (tests) or swap the backend. Returns the previous one. */
export const setShopServerAdapter = (next: ShopServerAdapter): ShopServerAdapter => {
  const prev = serverAdapter;
  serverAdapter = next;
  return prev;
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export type ShopMode = "local" | "server";

export interface CosmeticsShopState {
  mode: ShopMode;
  catalog: readonly CosmeticItem[];
  coins: number;
  ownedItemIds: string[];
  equipped: EquippedItems;
  busy: boolean;

  purchaseItem(itemId: string): Promise<PurchaseResult>;
  equipItem(itemId: string, category: CosmeticCategory): Promise<EquipResult>;
  unequipItem(category: CosmeticCategory): Promise<EquipResult>;
  owns(itemId: string): boolean;
  itemById(itemId: string): CosmeticItem | undefined;

  /** Local-mode faucet for demos and tests. No server equivalent exists on purpose. */
  grantCoins(amount: number): void;
  /** Switch authority mode; server mode refreshes the mirror immediately. */
  setMode(mode: ShopMode): Promise<void>;
  /** Pull the server snapshot into the store (server mode's source of truth). */
  syncFromServer(): Promise<void>;
  /** Local-mode wipe: back to the fresh-athlete state. */
  resetLocalState(): void;
}

const STARTING_COINS = 2000; // demo balance: enough for a few real decisions

const initialState = () => ({
  mode: "local" as ShopMode,
  catalog: DEFAULT_CATALOG,
  coins: STARTING_COINS,
  ownedItemIds: [] as string[],
  equipped: { ...EMPTY_EQUIPPED } as EquippedItems,
  busy: false,
});

export const useCosmeticsShop = create<CosmeticsShopState>()(
  persist(
    (set, get) => ({
      ...initialState(),

      owns: (itemId) => get().ownedItemIds.includes(itemId),
      itemById: (itemId) => get().catalog.find((i) => i.id === itemId),

      async purchaseItem(itemId) {
        const state = get();
        const item = state.catalog.find((i) => i.id === itemId);
        if (!item) return { ok: false, reason: "unknown_item", message: "That item does not exist." };
        if (item.earnOnly)
          return { ok: false, reason: "not_purchasable", message: `${item.name} is earned, never sold.` };
        if (!isAvailableNow(item))
          return { ok: false, reason: "out_of_season", message: `${item.name} is not on sale right now.` };
        if (state.ownedItemIds.includes(item.id))
          return { ok: false, reason: "already_owned", message: "You already own this." };
        if (state.coins < item.priceCoins)
          return {
            ok: false,
            reason: "insufficient_coins",
            message: `You need ${item.priceCoins - state.coins} more Coins.`,
          };

        if (state.mode === "server") {
          set({ busy: true });
          const res = await serverAdapter.purchase(item);
          set({ busy: false });
          if (res.ok === false) return { ok: false, reason: "server_rejected", message: res.message };
          await get().syncFromServer();
          notifyCosmeticsChanged();
          return { ok: true, item, priceCoins: item.priceCoins, coinsRemaining: get().coins };
        }

        // LOCAL: one set() = one atomic transition. Balance and ownership
        // cannot disagree for even one render, and subscribers re-render once.
        const coinsRemaining = state.coins - item.priceCoins;
        set({ coins: coinsRemaining, ownedItemIds: [...state.ownedItemIds, item.id] });
        return { ok: true, item, priceCoins: item.priceCoins, coinsRemaining };
      },

      async equipItem(itemId, category) {
        const state = get();
        const item = state.catalog.find((i) => i.id === itemId);
        if (!item) return { ok: false, reason: "unknown_item", message: "That item does not exist." };
        if (item.category !== category)
          return { ok: false, reason: "category_mismatch", message: `${item.name} cannot go there.` };
        if (!state.ownedItemIds.includes(item.id))
          return { ok: false, reason: "not_owned", message: "Own it before wearing it." };

        if (state.mode === "server") {
          set({ busy: true });
          const res = await serverAdapter.equip(item);
          set({ busy: false });
          if (res.ok === false) return { ok: false, reason: "server_rejected", message: res.message };
          await get().syncFromServer();
          notifyCosmeticsChanged();
          return { ok: true, category, itemId };
        }

        set({ equipped: { ...state.equipped, [category]: item.id } });
        return { ok: true, category, itemId };
      },

      async unequipItem(category) {
        const state = get();
        if (!Object.prototype.hasOwnProperty.call(EQUIP_SLOT, category)) {
          return { ok: false, reason: "unknown_category" };
        }

        if (state.mode === "server") {
          const slot = EQUIP_SLOT[category];
          if (!slot) return { ok: false, reason: "unknown_category", message: "Nothing to remove there." };
          set({ busy: true });
          const res = await serverAdapter.unequip(slot);
          set({ busy: false });
          if (res.ok === false) return { ok: false, reason: "server_rejected", message: res.message };
          await get().syncFromServer();
          notifyCosmeticsChanged();
          return { ok: true, category, itemId: null };
        }

        set({ equipped: { ...state.equipped, [category]: null } });
        return { ok: true, category, itemId: null };
      },

      grantCoins(amount) {
        if (get().mode !== "local") return; // live coins are server-authored, always
        // Production builds refuse the faucet outright (demo builds excepted):
        // a callable "free coins" in a shipped app is a console away from abuse.
        if (import.meta.env.PROD && !DEMO_MODE) return;
        if (!Number.isFinite(amount) || amount <= 0) return;
        set((s) => ({ coins: s.coins + Math.floor(amount) }));
      },

      async setMode(mode) {
        set({ mode });
        if (mode === "server") await get().syncFromServer();
      },

      async syncFromServer() {
        const snap = await serverAdapter.snapshot();
        if (!snap) return; // offline/signed-out: keep the last mirror, change nothing
        set({ coins: snap.coins, ownedItemIds: snap.ownedItemIds, equipped: snap.equipped });
      },

      resetLocalState() {
        set({ ...initialState(), catalog: get().catalog });
      },
    }),
    {
      name: "vaylo_cosmetics_shop_v1",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      // Only LOCAL-mode data is worth persisting; server state is re-read on
      // mount and must never be resurrected from a stale tab.
      partialize: (s) =>
        s.mode === "local"
          ? { coins: s.coins, ownedItemIds: s.ownedItemIds, equipped: s.equipped }
          : {},
    },
  ),
);

// ---------------------------------------------------------------------------
// Derived helpers (plain functions, no re-render of their own) — for screens
// that want answers without subscribing to the whole store.
// ---------------------------------------------------------------------------

/** Items the user can actually buy right now: not owned, on sale, sellable. */
export const purchasableNow = (s: CosmeticsShopState): CosmeticItem[] =>
  s.catalog.filter(
    (i) => !i.earnOnly && !s.ownedItemIds.includes(i.id) && isAvailableNow(i),
  );

/** The equipped look resolved to full items, for rendering a preview card. */
export const equippedItems = (s: CosmeticsShopState): Partial<Record<CosmeticCategory, CosmeticItem>> => {
  const out: Partial<Record<CosmeticCategory, CosmeticItem>> = {};
  (Object.keys(s.equipped) as CosmeticCategory[]).forEach((cat) => {
    const id = s.equipped[cat];
    const item = id ? s.catalog.find((i) => i.id === id) : undefined;
    if (item) out[cat] = item;
  });
  return out;
};

// Small persistence escape hatch for screens that need the raw inventory
// outside React (share cards, deep links) — same key, same shape.
export const peekPersistedInventory = (): Pick<ShopSnapshot, "coins" | "ownedItemIds" | "equipped"> =>
  lsGet("vaylo_cosmetics_shop_v1", { state: { coins: STARTING_COINS, ownedItemIds: [], equipped: EMPTY_EQUIPPED } })
    .state as Pick<ShopSnapshot, "coins" | "ownedItemIds" | "equipped">;

/** Write-through used only by migration/import tooling, never by shop screens. */
export const seedPersistedInventory = (inv: Pick<ShopSnapshot, "coins" | "ownedItemIds" | "equipped">): void => {
  lsSet("vaylo_cosmetics_shop_v1", { state: inv, version: 1 });
};
