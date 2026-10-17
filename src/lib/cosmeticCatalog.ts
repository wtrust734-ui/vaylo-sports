// ============================================================================
// COSMETIC CATALOG HELPERS — pure, framework-free, testable
// ----------------------------------------------------------------------------
// The shop surfaces (Collection, StyleTab, the sheet) share two rules that must
// never drift apart:
//
//   1. Availability: an item with a season window is only visible on sale
//      inside that window (mirrors the server-side check in purchase_cosmetic).
//   2. Bundles: coins buy a curated SET in one transaction
//      (server: purchase_cosmetic_bundle; this file mirrors the seeded
//      definitions for display — the server price is authoritative, the cost
//      here is only what gets shown before checkout).
//
// Kept free of imports from src/lib/cosmetics.ts, because that module loads
// the Supabase client; this one is imported by unit tests too.
// ============================================================================

/** The shape of the fields the availability rule reads. */
export interface AvailabilityWindow {
  type: string;
  season: string | null;
  available_from: string | null; // ISO timestamp
  available_to: string | null;   // ISO timestamp
}

/**
 * True when a cosmetic may be seen/bought right now. Parity with the server's
 * purchase checks (migration 20261017092000):
 *   - no window → always available... except type `seasonal`, which MUST have
 *     both bounds; a windowless seasonal item is a content defect and is
 *     treated as not on sale on both ends (two legacy seed rows are exactly
 *     that until real dates are set).
 *   - an open-ended bound is allowed on non-seasonal items.
 */
export function isAvailableNow(
  def: Pick<AvailabilityWindow, "type" | "season" | "available_from" | "available_to">,
  now: Date = new Date(),
): boolean {
  const from = def.available_from ? new Date(def.available_from) : null;
  const to = def.available_to ? new Date(def.available_to) : null;
  if (def.type === "seasonal" && (!from || !to)) return false;
  if (from && now < from) return false;
  if (to && now > to) return false;
  return true;
}

export interface CosmeticBundleConfig {
  id: string;
  name: string;
  description: string;
  /** reward_definitions ids, mirroring cosmetic_bundle_items on the server. */
  itemIds: string[];
  /** Server price (cosmetic_bundles.coin_cost). Display only. */
  coinCost: number;
  /** Sum of the mirrored coin ladder — shown as the honest savings line. */
  itemValue: number;
}

/**
 * Mirrors the seed in 20261017093000_cosmetic_bundles.sql. itemValue is the
 * sum of the per-rarity coin prices from the same ladder
 * (common 150 · rare 400 · epic 900 · legendary 2400).
 */
export const COSMETIC_BUNDLES: CosmeticBundleConfig[] = [
  {
    id: "starter_look",
    name: "Starter Look",
    description: "A title, a border and a backdrop — everything an empty profile needs.",
    itemIds: ["title_winner", "border_silver", "bg_arena"],
    coinCost: 500,
    itemValue: 950,
  },
  {
    id: "champions_look",
    name: "Champions Look",
    description: "Gold everything: the Champion title, the gold border and the summit backdrop.",
    itemIds: ["title_champion", "border_gold", "bg_summit"],
    coinCost: 2200,
    itemValue: 2700,
  },
  {
    id: "glow_set",
    name: "Electric Glow Set",
    description: "Electric blue name, tap sparks and the animated neon border.",
    itemIds: ["name_blue", "fx_click_spark", "border_neon"],
    coinCost: 2900,
    itemValue: 3200,
  },
];

/** Bundle economics must stay honest: cost below the sum of the parts. */
export function bundleSavings(bundle: CosmeticBundleConfig): number {
  return bundle.itemValue - bundle.coinCost;
}
