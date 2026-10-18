// ============================================================================
// COSMETICS SHOP — MOCK CATALOGUE
// ----------------------------------------------------------------------------
// Twenty-six items spanning every category and every rarity, so the
// architecture can be exercised end-to-end without a server. Every id, name,
// description, rarity and icon mirrors the REAL production seed
// (supabase/migrations/20260704114724_2a58c6e1…sql) and every price equals the
// server's rarity ladder (RARITY_LADDER in types.ts), so a mock purchase costs
// exactly what the live RPC would charge. Items the brief named are all here:
// Dedicated, Underdog, Winner, Champion, Legend, GOAT, Silver/Gold/Neon Pulse/
// Rainbow Prism borders, Arena/Summit/Galaxy backdrops, Electric Blue/Gold/
// Rainbow name colours, Click Spark/Hover Glow/Gold Dust/Champion Aura
// effects.
//
// Rarity note: a few items the brief listed as "Common at 400c" are seeded in
// the production database as RARE — and the ladder prices Rare at exactly 400.
// The seed wins: rarity is the server's column, and inventing a "common 400"
// price would break the money mirror. Silver Border, Arena Background,
// Electric Blue Name and Click Spark are therefore Rare.
//
// The avatar-category items use the seed's avatar entries with a
// `serverCategory` override, because purchase_avatar_item_coins wants the
// avatar catalogue's own category string, not the shop's 'avatars'.
// ============================================================================

import { RARITY_LADDER, type CosmeticItem } from "./types";

const price = (rarity: keyof typeof RARITY_LADDER) => RARITY_LADDER[rarity].priceCoins;

export const MOCK_CATALOG: readonly CosmeticItem[] = Object.freeze([
  // -- Titles --------------------------------------------------------------
  {
    id: "title_dedicated",
    name: "Dedicated",
    category: "titles",
    rarity: "common",
    priceCoins: price("common"),
    description: "Reps in, rewards out.",
    style: {},
    icon: "target",
  },
  {
    id: "title_underdog",
    name: "Underdog",
    category: "titles",
    rarity: "common",
    priceCoins: price("common"),
    description: "Everyone loves an upset.",
    style: {},
    icon: "dog",
  },
  {
    id: "title_winner",
    name: "Winner",
    category: "titles",
    rarity: "common",
    priceCoins: price("common"),
    description: "Wins matter.",
    style: {},
    icon: "trophy",
  },
  {
    id: "title_grinder",
    name: "Daily Grinder",
    category: "titles",
    rarity: "rare",
    priceCoins: price("rare"),
    description: "Never misses a day.",
    style: {},
    icon: "flame",
  },
  {
    id: "title_champion",
    name: "Champion",
    category: "titles",
    rarity: "epic",
    priceCoins: price("epic"),
    description: "For those who win when it counts.",
    style: {},
    icon: "crown",
  },
  {
    id: "title_legend",
    name: "Legend",
    category: "titles",
    rarity: "legendary",
    priceCoins: price("legendary"),
    description: "Immortalised.",
    style: {},
    icon: "crown",
  },
  {
    id: "title_goat",
    name: "GOAT",
    category: "titles",
    rarity: "mythic",
    priceCoins: price("mythic"),
    description: "Greatest of all time.",
    style: {},
    icon: "crown",
  },
  {
    // Earn-only: the server refuses to sell this at any price. Kept in the
    // catalogue so the shop can SHOW it (no buy button, an "Earned" chip) —
    // the store's not_purchasable guard is what keeps the UI honest.
    id: "title_founder",
    name: "Founder",
    category: "titles",
    rarity: "mythic",
    priceCoins: price("mythic"),
    description: "Here from day one. Never sold.",
    style: {},
    icon: "crown",
    earnOnly: true,
  },

  // -- Borders -------------------------------------------------------------
  {
    id: "border_silver",
    name: "Silver Border",
    category: "borders",
    rarity: "rare",
    priceCoins: price("rare"),
    description: "Clean silver border.",
    style: { color: "#C0C0C0" },
    icon: "circle",
  },
  {
    id: "border_gold",
    name: "Gold Border",
    category: "borders",
    rarity: "epic",
    priceCoins: price("epic"),
    description: "Rich gold border.",
    style: { color: "#FFD700" },
    icon: "circle",
  },
  {
    id: "border_neon",
    name: "Neon Pulse Border",
    category: "borders",
    rarity: "legendary",
    priceCoins: price("legendary"),
    description: "Animated neon pulse.",
    style: { animated: true, color: "#00E5FF" },
    icon: "circle",
  },
  {
    id: "border_rainbow",
    name: "Rainbow Prism Border",
    category: "borders",
    rarity: "mythic",
    priceCoins: price("mythic"),
    description: "Animated rainbow gradient.",
    style: { animated: true },
    icon: "circle",
  },

  // -- Backdrops -----------------------------------------------------------
  {
    id: "bg_arena",
    name: "Arena Background",
    category: "backdrops",
    rarity: "rare",
    priceCoins: price("rare"),
    description: "Stadium at night.",
    style: { gradient: "radial-gradient(circle at 50% 110%, #312e81 0%, #1e1b4b 45%, #0b1026 100%)" },
    icon: "image",
  },
  {
    id: "bg_summit",
    name: "Summit Background",
    category: "backdrops",
    rarity: "epic",
    priceCoins: price("epic"),
    description: "Mountain summit at dawn.",
    style: { gradient: "linear-gradient(180deg, #fda4af 0%, #fb923c 38%, #0f172a 100%)" },
    icon: "mountain",
  },
  {
    id: "bg_galaxy",
    name: "Galaxy Background",
    category: "backdrops",
    rarity: "legendary",
    priceCoins: price("legendary"),
    description: "Animated galactic scene.",
    style: { animated: true, gradient: "radial-gradient(circle at 30% 20%, #4c1d95 0%, #1e1b4b 45%, #020617 100%)" },
    icon: "sparkles",
  },

  // -- Name colours --------------------------------------------------------
  {
    id: "name_blue",
    name: "Electric Blue Name",
    category: "nameColors",
    rarity: "rare",
    priceCoins: price("rare"),
    description: "Vaylo signature blue.",
    style: { color: "#00E5FF" },
    icon: "type",
  },
  {
    id: "name_gold",
    name: "Gold Name",
    category: "nameColors",
    rarity: "legendary",
    priceCoins: price("legendary"),
    description: "Legendary gold text.",
    style: { color: "#FFD700" },
    icon: "type",
  },
  {
    id: "name_rainbow",
    name: "Rainbow Name",
    category: "nameColors",
    rarity: "mythic",
    priceCoins: price("mythic"),
    description: "Animated rainbow text.",
    style: { animated: true },
    icon: "type",
  },

  // -- Effects -------------------------------------------------------------
  {
    id: "fx_click_spark",
    name: "Click Spark Effect",
    category: "effects",
    rarity: "rare",
    priceCoins: price("rare"),
    description: "Sparks on tap.",
    style: {},
    icon: "sparkle",
  },
  {
    id: "fx_hover_glow",
    name: "Hover Glow",
    category: "effects",
    rarity: "epic",
    priceCoins: price("epic"),
    description: "Glow on hover.",
    style: {},
    icon: "sparkles",
  },
  {
    id: "fx_gold_dust",
    name: "Gold Dust Trail",
    category: "effects",
    rarity: "legendary",
    priceCoins: price("legendary"),
    description: "Gold particle trail.",
    style: {},
    icon: "sparkles",
  },
  {
    id: "aura_champion",
    name: "Champion Aura",
    category: "effects",
    rarity: "mythic",
    priceCoins: price("mythic"),
    description: "Radiant golden aura.",
    style: { animated: true },
    icon: "sun",
  },

  // -- Avatars (avatar-catalogue items, serverCategory overridden) ---------
  {
    id: "pose_flex",
    name: "Flex Pose",
    category: "avatars",
    rarity: "rare",
    priceCoins: price("rare"),
    description: "Classic flex victory pose.",
    style: {},
    serverCategory: "victory_poses",
    icon: "sparkles",
  },
  {
    id: "anim_run_fast",
    name: "Sprint Run Cycle",
    category: "avatars",
    rarity: "epic",
    priceCoins: price("epic"),
    description: "Faster running animation.",
    style: {},
    serverCategory: "running_animations",
    icon: "zap",
  },
  {
    id: "anim_celeb_gold",
    name: "Gold Celebration",
    category: "avatars",
    rarity: "legendary",
    priceCoins: price("legendary"),
    description: "Legendary celebration.",
    style: {},
    serverCategory: "celebration_animations",
    icon: "sparkles",
  },
]);

/** The one seasonal item, dated so the out_of_season guard can be exercised. */
export const SEASONAL_XMAS_HAT: CosmeticItem = Object.freeze({
  id: "seasonal_xmas_hat",
  name: "Santa Hat",
  category: "avatars",
  rarity: "epic",
  priceCoins: RARITY_LADDER.epic.priceCoins,
  description: "Festive santa hat.",
  style: {},
  serverCategory: "seasonal",
  icon: "gift",
  availableFrom: "2026-12-01",
  availableTo: "2027-01-05",
});

/** Full default catalogue — what THIS shop actually sells. */
export const DEFAULT_CATALOG: readonly CosmeticItem[] = Object.freeze(
  // Avatar-category items (poses, animations, the seasonal hat) are EXCLUDED:
  // the production app sells them in the Avatar Studio already, and listing
  // them here too would recreate the four-surfaces problem the consolidation
  // exists to end — worse, this shop could never equip them (the server
  // adapter routes avatars to the Studio). They remain in MOCK_CATALOG as the
  // 'avatars' union's real data reference; the store, grid and purchasable
  // list only ever see the profile-wearable majority.
  [...MOCK_CATALOG, SEASONAL_XMAS_HAT].filter((i) => i.category !== "avatars"),
);
