// ============================================================================
// COSMETICS SHOP — DOMAIN TYPES
// ----------------------------------------------------------------------------
// The type layer of the revamped item shop. Everything here is pure data
// shape: no React, no supabase, no storage. That isolation is what lets the
// same types serve the Zustand store (store.ts), the mock catalogue
// (catalog.ts), every shop UI, and the unit tests without a single cast.
//
// Three grounding decisions, made against the real system rather than in the
// abstract:
//
//   1. THE CURRENCY IS COINS, NOT CREDITS. The brief said "price in credits";
//      this app's economy deliberately separates the two — credits buy
//      FEATURES (AI plans, unlocks), coins buy LOOKS, and the money-mirror
//      integrity tests enforce that no cosmetic is ever priced in credits
//      (MONEY.md, scripts/gen-money-mirror.cjs). Pricing a cosmetic in credits
//      here would be the exact defect those tests exist to catch. The field
//      is therefore `priceCoins`, and `creditsForDisplay` exists for any UI
//      that wants to show the credit-equivalent (1 credit = 7.5 coins,
//      DB-authoritative in the coins config).
//
//   2. THE CATEGORIES ARE THE SHOP'S VOCABULARY, MAPPED EXPLICITLY TO THE
//      STORAGE'S. The brief's camelCase union ('titles' | 'borders' |
//      'backdrops' | 'nameColors' | 'effects' | 'avatars') is the language a
//      user and a shop screen speak. The database speaks 'title' | 'border' |
//      'background' | 'name_color' | 'effect' on user_profile_cosmetics, and
//      the avatar catalogue speaks its own category strings. The mapping
//      table (SERVER_CATEGORY, EQUIP_SLOT) makes that translation explicit
//      and greppable, so no screen ever invents its own.
//
//   3. RESULTS ARE DISCRIMINATED UNIONS, NEVER THROWN. Every mutating action
//      resolves to a PurchaseResult / EquipResult whose `ok` field narrows
//      the shape. Callers handle failure as a value (toast, top-up sheet),
//      which is how the rest of this codebase already treats RPC outcomes.
// ============================================================================

/** Shop-facing cosmetic categories — the brief's union, verbatim. */
export type CosmeticCategory =
  | "titles"
  | "borders"
  | "backdrops"
  | "nameColors"
  | "effects"
  | "avatars";

/**
 * Rarity ladder — five tiers, matching the server seed's own vocabulary
 * (reward_definitions.rarity includes 'mythic'; the coin ladder tops out at
 * mythic 4800). Lower is commoner; the ladder is the single source of price.
 */
export type CosmeticRarity = "common" | "rare" | "epic" | "legendary" | "mythic";

/** The slot column on user_profile_cosmetics that a category equips into. */
export type EquipSlot = "title_id" | "border_id" | "background_id" | "name_color_id" | "effect_id";

/**
 * Category → equip slot. Names are the TABLE'S real columns
 * (user_profile_cosmetics title_id/border_id/… — the same strings the
 * unequip_cosmetic RPC validates p_slot against); a bare "title" here would
 * silently read null from the snapshot and fail unequip server-side. `null`
 * for avatars: avatar items live in the avatar system (avatar_items + the
 * Avatar Studio loadout), not on the profile card's row.
 */
export const EQUIP_SLOT: Record<CosmeticCategory, EquipSlot | null> = {
  titles: "title_id",
  borders: "border_id",
  backdrops: "background_id",
  nameColors: "name_color_id",
  effects: "effect_id",
  avatars: null,
};

/**
 * Category → the exact string the SERVER expects, for the RPCs that take a
 * category argument (purchase_avatar_item_coins wants the avatar-catalogue
 * category; purchase_cosmetic infers everything from the reward id and needs
 * nothing). Mirrors the values in the 2026-07-04 seed migration.
 */
export const SERVER_CATEGORY: Record<CosmeticCategory, string> = {
  titles: "title",
  borders: "border",
  backdrops: "background",
  nameColors: "name_color",
  effects: "profile_effect",
  avatars: "victory_poses", // per-item override lives on CosmeticItem.serverCategory
};

/**
 * Visual description of an item. This app's cosmetics are drawn in code (SVG
 * / CSS), so styling properties — not asset URLs — are the primary form;
 * assetUrl exists for the minority that ship a raster/Lottie file.
 */
export interface CosmeticStyle {
  /** Hex colour for text/border tints. */
  color?: string;
  /** Animated items require an active subscription to wear (server-enforced). */
  animated?: boolean;
  /** Optional gradient spec for backdrops and effects. */
  gradient?: string;
}

/** One item in the shop. Immutable by convention — the store never mutates it. */
export interface CosmeticItem {
  readonly id: string;
  readonly name: string;
  readonly category: CosmeticCategory;
  readonly rarity: CosmeticRarity;
  /** Price in COINS. Always equals RARITY_LADDER[rarity].priceCoins in live data. */
  readonly priceCoins: number;
  readonly description: string;
  readonly style: CosmeticStyle;
  /**
   * Asset reference: a lucide icon NAME ("crown", "sparkles", "dog"), which
   * is how the production seed stores every cosmetic's glyph
   * (reward_definitions.icon). The brief called this `assetValue`; naming it
   * after what it actually holds keeps the grid renderer honest — it resolves
   * the name through one ICON_BY_NAME map instead of guessing at URLs. Raster
   * cosmetics would use `assetUrl` instead.
   */
  readonly icon: string;
  readonly assetUrl?: string;
  /**
   * Per-item server category override (avatar items carry their catalogue
   * category, e.g. 'outfits'; profile items use SERVER_CATEGORY).
   */
  readonly serverCategory?: string;
  /**
   * Earn-only items can never be bought at any price — the server RPC refuses
   * badge/founder purchases outright. The shop's job is to not offer them.
   */
  readonly earnOnly?: boolean;
  /** Seasonal availability window (ISO dates, inclusive). Absent = always on. */
  readonly availableFrom?: string;
  readonly availableTo?: string;
}

/** The equipped look: one item id (or null) per category. */
export type EquippedItems = Record<CosmeticCategory, string | null>;

/**
 * The user's inventory slice the shop reads. Coins are the SERVER's number in
 * live mode — this shape is what the store mirrors after each sync, never
 * what it authors (see store.ts, "authority").
 */
export interface InventoryState {
  readonly coins: number;
  readonly ownedItemIds: readonly string[];
  readonly equipped: EquippedItems;
}

// ---------------------------------------------------------------------------
// Results — discriminated unions. `ok` narrows; failures carry a machine
// reason (switch on it) and a human message (toast it).
// ---------------------------------------------------------------------------

export type PurchaseFailureReason =
  | "unknown_item"
  | "not_purchasable" // earnOnly
  | "out_of_season"
  | "already_owned"
  | "insufficient_coins"
  | "server_rejected";

export type PurchaseResult =
  | { ok: true; item: CosmeticItem; priceCoins: number; coinsRemaining: number }
  | { ok: false; reason: PurchaseFailureReason; message?: string };

export type EquipFailureReason =
  | "unknown_item"
  | "unknown_category"
  | "category_mismatch" // item exists but belongs to another category
  | "not_owned"
  | "server_rejected";

export type EquipResult =
  | { ok: true; category: CosmeticCategory; itemId: string | null }
  | { ok: false; reason: EquipFailureReason; message?: string };

// ---------------------------------------------------------------------------
// Price ladder — mirrors the server (20260921090500_profile_cosmetics.sql:
// common 150 → mythic 4800). The client copy drives previews; the server
// re-prices every purchase, so a tampered client can at worst be wrong, never
// cheap.
// ---------------------------------------------------------------------------

export const RARITY_LADDER: Record<
  CosmeticRarity,
  { priceCoins: number; label: string; color: string }
> = {
  common:    { priceCoins: 150,  label: "Common",    color: "#94a3b8" },
  rare:      { priceCoins: 400,  label: "Rare",      color: "#38bdf8" },
  epic:      { priceCoins: 900,  label: "Epic",      color: "#a78bfa" },
  legendary: { priceCoins: 2400, label: "Legendary", color: "#fbbf24" },
  mythic:    { priceCoins: 4800, label: "Mythic",    color: "#f472b6" },
};

/** 1 credit = 7.5 coins, DB-authoritative. Display only — never a price input. */
export const COINS_PER_CREDIT = 7.5;
export const creditsForDisplay = (coins: number): number => coins / COINS_PER_CREDIT;

/** True when the item is inside its seasonal window (or has no window). */
export const isAvailableNow = (item: CosmeticItem, now = new Date()): boolean => {
  if (item.availableFrom && now < new Date(item.availableFrom)) return false;
  if (item.availableTo && now > new Date(`${item.availableTo}T23:59:59`)) return false;
  return true;
};
