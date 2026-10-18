// ============================================================================
// DEF → FLEX ITEM — the bridge between the production catalogue and the flex
// ----------------------------------------------------------------------------
// The Collection page's reward_definitions rows (CosmeticDef) and the shop
// store's CosmeticItem are two views of the same seed. This maps the former
// into the latter so the celebration modal can render production unlocks
// without the Collection adopting the shop store: same id, name, rarity, icon
// and price; payload colour/animated lifted into CosmeticStyle; badge types
// return null (badges are trophy-case material, never flex material).
// ============================================================================

import type { CosmeticDef, CosmeticType } from "@/lib/cosmetics";
import {
  RARITY_LADDER,
  type CosmeticCategory,
  type CosmeticItem,
} from "@/lib/cosmeticsShop/types";

/** Production type → shop category. Badges have no shop slot. */
const CATEGORY_BY_TYPE: Record<CosmeticType, CosmeticCategory | null> = {
  title: "titles",
  border: "borders",
  background: "backdrops",
  name_color: "nameColors",
  effect: "effects",
  badge: null,
};

export function defToFlexItem(def: CosmeticDef): CosmeticItem | null {
  const category = CATEGORY_BY_TYPE[def.type];
  if (!category) return null;
  const payload = def.payload ?? {};
  const color = typeof payload.color === "string" ? payload.color : undefined;
  return {
    id: def.id,
    name: def.name,
    category,
    rarity: def.rarity,
    // Production price when the row carries one; ladder otherwise (server is
    // still authoritative — this number is only shown, never charged here).
    priceCoins: def.coin_cost ?? RARITY_LADDER[def.rarity].priceCoins,
    description: def.description ?? "",
    style: { color, animated: payload.animated === true },
    icon: def.icon ?? "sparkles",
  };
}
