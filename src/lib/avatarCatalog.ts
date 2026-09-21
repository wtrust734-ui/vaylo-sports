// Avatar customization catalog. Coins-only economy (1 credit = 7.5 coins).
// Prices below are mirrored server-side in public.avatar_catalog — regenerate
// that migration with `node scripts/gen-avatar-catalog-sql.cjs` after editing
// this file, otherwise purchases will be refused as "unknown cosmetic item".
// Free identity (skin/hair/face) lets every athlete build a full character
// before spending coins on outfits, headgear, shoes and effects. Coins are
// bought in the Market in bundles — see src/components/market/CoinBundlesSection.tsx.
export type Rarity = "common" | "rare" | "epic" | "legendary" | "mythic";

export type Category =
  | "body"
  | "skin_tone"
  | "face_shape"
  | "expression"
  | "hair"
  | "hair_color"
  | "eye_color"
  | "brows"
  | "facial_hair"
  | "outfit"
  | "pants"
  | "shoes"
  | "headgear"
  | "accessory"
  | "gloves"
  | "badge"
  | "background"
  | "pose";

export interface AvatarItem {
  id: string;
  name: string;
  category: Category;
  rarity: Rarity;
  cost: number;
  color?: string;
  glyph?: string;
  description?: string;
}

export const RARITY_META: Record<Rarity, { label: string; color: string; ring: string; gradient: string; glow: string }> = {
  common:    { label: "Common",    color: "hsl(215, 20%, 65%)",   ring: "ring-muted",             gradient: "linear-gradient(135deg,#64748b,#94a3b8)", glow: "rgba(148,163,184,0.45)" },
  rare:      { label: "Rare",      color: "hsl(217, 100%, 62%)",  ring: "ring-primary/60",        gradient: "linear-gradient(135deg,#2563eb,#38bdf8)", glow: "rgba(56,189,248,0.55)" },
  epic:      { label: "Epic",      color: "hsl(280, 90%, 68%)",   ring: "ring-electric-purple/60", gradient: "linear-gradient(135deg,#7e22ce,#d946ef)", glow: "rgba(217,70,239,0.55)" },
  legendary: { label: "Legendary", color: "hsl(38, 95%, 60%)",    ring: "ring-energy/70",         gradient: "linear-gradient(135deg,#b45309,#fbbf24)", glow: "rgba(251,191,36,0.65)" },
  mythic:    { label: "Mythic",    color: "hsl(0, 0%, 100%)",     ring: "ring-white/60",          gradient: "linear-gradient(135deg,#f43f5e,#f59e0b,#22c55e,#38bdf8,#a855f7)", glow: "rgba(255,255,255,0.75)" },
};

export const CATEGORY_META: Record<Category, { label: string; free: boolean; icon: string }> = {
  body:        { label: "Body",       free: true,  icon: "Dumbbell" },
  hair:        { label: "Hair",       free: true,  icon: "Scissors" },
  hair_color:  { label: "Hair Color", free: true,  icon: "Palette" },
  face_shape:  { label: "Face",       free: true,  icon: "Square" },
  expression:  { label: "Expression", free: true,  icon: "Smile" },
  eye_color:   { label: "Eyes",       free: true,  icon: "Eye" },
  brows:       { label: "Brows",      free: true,  icon: "Minus" },
  facial_hair: { label: "Beard",      free: true,  icon: "Wind" },
  skin_tone:   { label: "Skin",       free: true,  icon: "Droplet" },
  outfit:      { label: "Tops",       free: false, icon: "Shirt" },
  pants:       { label: "Bottoms",    free: false, icon: "Layers" },
  shoes:       { label: "Shoes",      free: false, icon: "Footprints" },
  headgear:    { label: "Hats",       free: false, icon: "HardHat" },
  gloves:      { label: "Gloves",     free: false, icon: "Hand" },
  accessory:   { label: "Effects",    free: false, icon: "Sparkles" },
  badge:       { label: "Titles",     free: false, icon: "Award" },
  background:  { label: "Scenes",     free: false, icon: "Image" },
  pose:        { label: "Animations", free: false, icon: "Play" },
};

export const IDENTITY_CATEGORIES: Category[] = [
  "body", "skin_tone", "face_shape", "expression", "hair", "hair_color", "eye_color", "brows", "facial_hair",
];

export const SHOP_CATEGORIES: Category[] = [
  "outfit", "pants", "shoes", "headgear", "gloves", "accessory", "badge", "background", "pose",
];

export const ALL_CATEGORIES: Category[] = [
  "body", "hair", "hair_color", "face_shape", "expression", "eye_color", "brows", "facial_hair", "skin_tone",
  "outfit", "pants", "shoes", "headgear", "gloves", "accessory", "badge", "background", "pose",
];

const free = (id: string, name: string, category: Category, color?: string, glyph?: string, description?: string): AvatarItem =>
  ({ id, name, category, rarity: "common", cost: 0, color, glyph, description });

export const CATALOG: AvatarItem[] = [
  // ============= BODY (free basics + premium physiques) =============
  free("body_athletic",  "Athletic",   "body", "#6b7280", undefined, "Balanced all-round build."),
  free("body_lean",      "Lean",       "body", "#9ca3af", undefined, "Slim, low mass."),
  free("body_powerful",  "Powerful",   "body", "#f59e0b", undefined, "Broad shoulders, dense."),
  free("body_tall",      "Tall",       "body", "#22d3ee", undefined, "Above-average height."),
  free("body_short",     "Short",      "body", "#a78bfa", undefined, "Compact, low centre of gravity."),
  { id: "body_distance",   name: "Distance Runner", category: "body", rarity: "rare",      cost: 320,  color: "#22c55e", description: "Wiry, efficient endurance frame." },
  { id: "body_sprinter",   name: "Sprinter",        category: "body", rarity: "rare",      cost: 380,  color: "#ef4444", description: "Explosive, dense fast-twitch." },
  { id: "body_footballer", name: "Footballer",      category: "body", rarity: "rare",      cost: 320,  color: "#10b981", description: "Balanced strength and agility." },
  { id: "body_basketball", name: "Basketball",      category: "body", rarity: "epic",      cost: 800,  color: "#f97316", description: "Tall, long-limbed." },
  { id: "body_cyclist",    name: "Cyclist",         category: "body", rarity: "rare",      cost: 380,  color: "#eab308", description: "Powerful legs, lean upper body." },
  { id: "body_swimmer",    name: "Swimmer",         category: "body", rarity: "epic",      cost: 900,  color: "#06b6d4", description: "V-taper, wide shoulders." },
  { id: "body_gymnast",    name: "Gymnast",         category: "body", rarity: "epic",      cost: 900,  color: "#a855f7", description: "Dense, compact strength." },
  { id: "body_builder",    name: "Bodybuilder",     category: "body", rarity: "legendary", cost: 2400, color: "#dc2626", description: "Maximum muscle mass." },

  // ============= SKIN TONES (free) =============
  free("tone_1",  "Porcelain",  "skin_tone", "#fbe4cd"),
  free("tone_2",  "Light",      "skin_tone", "#f5d6c0"),
  free("tone_3",  "Warm",       "skin_tone", "#e8b48f"),
  free("tone_4",  "Tan",        "skin_tone", "#cf9670"),
  free("tone_5",  "Bronze",     "skin_tone", "#b07a52"),
  free("tone_6",  "Caramel",    "skin_tone", "#8b5a3c"),
  free("tone_7",  "Mocha",      "skin_tone", "#6b4226"),
  free("tone_8",  "Espresso",   "skin_tone", "#4a2d18"),
  free("tone_9",  "Onyx",       "skin_tone", "#321f12"),
  free("tone_10", "Deep",       "skin_tone", "#1f140a"),
  // Premium cosmetic skins
  { id: "tone_freckles", name: "Freckled",   category: "skin_tone", rarity: "rare",      cost: 320,  color: "#e8b48f" },
  { id: "tone_warpaint", name: "War Paint",  category: "skin_tone", rarity: "epic",      cost: 900,  color: "#dc2626" },
  { id: "tone_metallic", name: "Chrome",     category: "skin_tone", rarity: "legendary", cost: 2200, color: "#cbd5e1" },
  { id: "tone_ice",      name: "Frostbite",  category: "skin_tone", rarity: "legendary", cost: 2400, color: "#7dd3fc" },
  { id: "tone_gold",     name: "Solid Gold", category: "skin_tone", rarity: "legendary", cost: 2800, color: "#fbbf24" },
  { id: "tone_lava",     name: "Molten",     category: "skin_tone", rarity: "mythic",    cost: 4000, color: "#f97316" },

  // ============= FACE SHAPE (free) =============
  free("face_oval",     "Oval",     "face_shape"),
  free("face_square",   "Square",   "face_shape"),
  free("face_round",    "Round",    "face_shape"),
  free("face_heart",    "Heart",    "face_shape"),
  free("face_diamond",  "Diamond",  "face_shape"),

  // ============= EXPRESSION (free) =============
  free("exp_neutral",     "Neutral",     "expression"),
  free("exp_smile",       "Smile",       "expression"),
  free("exp_confident",   "Confident",   "expression"),
  free("exp_focused",     "Focused",     "expression"),
  free("exp_determined",  "Determined",  "expression"),
  free("exp_happy",       "Happy",       "expression"),
  free("exp_competitive", "Competitive", "expression"),

  // ============= HAIR (free) =============
  free("hair_bald",      "Bald",       "hair", "transparent"),
  free("hair_buzz",      "Buzz Cut",   "hair"),
  free("hair_crew",      "Crew Cut",   "hair"),
  free("hair_short",     "Short",      "hair"),
  free("hair_messy",     "Messy",      "hair"),
  free("hair_curly",     "Curly",      "hair"),
  free("hair_wavy",      "Wavy",       "hair"),
  free("hair_long",      "Long",       "hair"),
  free("hair_ponytail",  "Ponytail",   "hair"),
  free("hair_bun",       "Bun",        "hair"),
  free("hair_afro",      "Afro",       "hair"),
  free("hair_dreads",    "Dreads",     "hair"),
  free("hair_braids",    "Braids",     "hair"),
  free("hair_mohawk",    "Mohawk",     "hair"),
  free("hair_fade",      "Taper Fade", "hair"),
  free("hair_low_fade",  "Low Fade",   "hair"),
  free("hair_mid_fade",  "Mid Fade",   "hair"),
  free("hair_high_fade", "High Fade",  "hair"),
  free("hair_undercut",  "Undercut",   "hair"),
  free("hair_slicked",   "Slicked Back","hair"),

  // ============= HAIR COLORS =============
  free("hcol_black",   "Black",   "hair_color", "#0d0d0d"),
  free("hcol_brown",   "Brown",   "hair_color", "#5b3a20"),
  free("hcol_chest",   "Chestnut","hair_color", "#7b4a25"),
  free("hcol_blonde",  "Blonde",  "hair_color", "#d4b06a"),
  free("hcol_red",     "Red",     "hair_color", "#a23a1a"),
  free("hcol_silver",  "Silver",  "hair_color", "#c2c8d0"),
  free("hcol_white",   "Platinum","hair_color", "#ececec"),
  { id: "hcol_blue",    name: "Cobalt",  category: "hair_color", rarity: "rare",      cost: 180, color: "#1e60d8" },
  { id: "hcol_pink",    name: "Pink",    category: "hair_color", rarity: "rare",      cost: 180, color: "#ec4899" },
  { id: "hcol_purple",  name: "Violet",  category: "hair_color", rarity: "rare",      cost: 180, color: "#7c3aed" },
  { id: "hcol_green",   name: "Emerald", category: "hair_color", rarity: "rare",      cost: 180, color: "#10b981" },
  { id: "hcol_gold",    name: "Gold",    category: "hair_color", rarity: "epic",      cost: 700, color: "#fbbf24" },
  { id: "hcol_galaxy",  name: "Galaxy",  category: "hair_color", rarity: "legendary", cost: 1800, color: "#7c3aed" },
  { id: "hcol_rainbow", name: "Rainbow", category: "hair_color", rarity: "mythic",    cost: 3800, color: "#f43f5e" },

  // ============= EYES =============
  free("eye_brown",  "Brown",  "eye_color", "#5b3a20"),
  free("eye_amber",  "Amber",  "eye_color", "#b87333"),
  free("eye_hazel",  "Hazel",  "eye_color", "#8b6914"),
  free("eye_green",  "Green",  "eye_color", "#1f7a47"),
  free("eye_blue",   "Blue",   "eye_color", "#2563eb"),
  free("eye_grey",   "Grey",   "eye_color", "#64748b"),
  { id: "eye_glow",      name: "Glowing",   category: "eye_color", rarity: "epic",      cost: 900,  color: "#22d3ee" },
  { id: "eye_lightning", name: "Lightning", category: "eye_color", rarity: "legendary", cost: 2000, color: "#facc15" },
  { id: "eye_neon",      name: "Neon Pink", category: "eye_color", rarity: "epic",      cost: 900,  color: "#ec4899" },
  { id: "eye_gold",      name: "Molten Gold", category: "eye_color", rarity: "legendary", cost: 2200, color: "#f59e0b" },

  // ============= BROWS =============
  free("brow_straight", "Straight", "brows"),
  free("brow_arched",   "Arched",   "brows"),
  free("brow_thick",    "Thick",    "brows"),
  free("brow_thin",     "Thin",     "brows"),

  // ============= FACIAL HAIR =============
  free("fh_clean",   "Clean",       "facial_hair", "transparent"),
  free("fh_stubble", "Stubble",     "facial_hair"),
  free("fh_goatee",  "Goatee",      "facial_hair"),
  free("fh_mustache","Mustache",    "facial_hair"),
  free("fh_full",    "Full Beard",  "facial_hair"),

  // ============= TOPS =============
  { id: "outfit_basic_blue",  name: "Core Blue Tee",  category: "outfit", rarity: "common", cost: 0,    color: "#3b82f6", description: "Your starter jersey." },
  { id: "outfit_white_tee",   name: "White Tee",      category: "outfit", rarity: "common", cost: 80,   color: "#f4f4f5" },
  { id: "outfit_black_tee",   name: "Onyx Tee",       category: "outfit", rarity: "common", cost: 80,   color: "#0a0a0a" },
  { id: "outfit_running_top", name: "Running Top",    category: "outfit", rarity: "common", cost: 140,  color: "#22c55e" },
  { id: "outfit_football",    name: "Football Kit",   category: "outfit", rarity: "common", cost: 160,  color: "#ef4444" },
  { id: "outfit_basketball",  name: "Basketball Jersey", category: "outfit", rarity: "common", cost: 160, color: "#f97316" },
  { id: "outfit_cycling",     name: "Cycling Jersey", category: "outfit", rarity: "rare",   cost: 320,  color: "#eab308" },
  { id: "outfit_swim_top",    name: "Rash Vest",      category: "outfit", rarity: "rare",   cost: 320,  color: "#0ea5e9" },
  { id: "outfit_gym_tank",    name: "Gym Tank",       category: "outfit", rarity: "common", cost: 120,  color: "#1f2937" },
  { id: "outfit_hoodie_blk",  name: "Stealth Hoodie", category: "outfit", rarity: "rare",   cost: 420,  color: "#1f2937" },
  { id: "outfit_winter_jkt",  name: "Winter Jacket",  category: "outfit", rarity: "rare",   cost: 480,  color: "#0f172a" },
  { id: "outfit_neon_strike", name: "Neon Strike",    category: "outfit", rarity: "rare",   cost: 380,  color: "#22d3ee" },
  { id: "outfit_crimson_kit", name: "Crimson Kit",    category: "outfit", rarity: "rare",   cost: 380,  color: "#dc2626" },
  { id: "outfit_carbon",      name: "Carbon Suit",    category: "outfit", rarity: "epic",   cost: 900,  color: "#1f2937" },
  { id: "outfit_aurora",      name: "Aurora Set",     category: "outfit", rarity: "epic",   cost: 1100, color: "#a78bfa" },
  { id: "outfit_solar_flare", name: "Solar Flare",    category: "outfit", rarity: "legendary", cost: 2200, color: "#fb7185" },
  { id: "outfit_obsidian_god",name: "Obsidian God",   category: "outfit", rarity: "legendary", cost: 3000, color: "#0f172a" },
  { id: "outfit_arc_gold",    name: "Arc Gold",       category: "outfit", rarity: "legendary", cost: 3600, color: "#fbbf24" },
  { id: "outfit_prism",       name: "Prism",          category: "outfit", rarity: "mythic",   cost: 5200, color: "#a855f7" },

  // ============= BOTTOMS =============
  { id: "pants_shorts_blk",  name: "Black Shorts",  category: "pants", rarity: "common", cost: 0,    color: "#0a0a0a" },
  { id: "pants_shorts_wht",  name: "White Shorts",  category: "pants", rarity: "common", cost: 80,   color: "#f4f4f5" },
  { id: "pants_running",     name: "Running Shorts",category: "pants", rarity: "common", cost: 140,  color: "#22c55e" },
  { id: "pants_football",    name: "Football Shorts",category: "pants",rarity: "common", cost: 140,  color: "#ef4444" },
  { id: "pants_jogger_grey", name: "Grey Joggers",  category: "pants", rarity: "common", cost: 160,  color: "#6b7280" },
  { id: "pants_track_neon",  name: "Neon Tracks",   category: "pants", rarity: "rare",   cost: 320,  color: "#22d3ee" },
  { id: "pants_cycling",     name: "Cycling Bibs",  category: "pants", rarity: "rare",   cost: 380,  color: "#0f172a" },
  { id: "pants_compress",    name: "Compression",   category: "pants", rarity: "rare",   cost: 360,  color: "#1f2937" },
  { id: "pants_winter",      name: "Winter Pants",  category: "pants", rarity: "rare",   cost: 420,  color: "#334155" },
  { id: "pants_carbon",      name: "Carbon Pants",  category: "pants", rarity: "epic",   cost: 900,  color: "#374151" },
  { id: "pants_aurora",      name: "Aurora Pants",  category: "pants", rarity: "epic",   cost: 1000, color: "#a78bfa" },
  { id: "pants_solar",       name: "Solar Pants",   category: "pants", rarity: "legendary", cost: 2400, color: "#fb7185" },

  // ============= SHOES =============
  { id: "shoes_basic",       name: "Trainers",         category: "shoes", rarity: "common", cost: 0,    color: "#f4f4f5" },
  { id: "shoes_red_runner",  name: "Red Runner",       category: "shoes", rarity: "common", cost: 140,  color: "#ef4444" },
  { id: "shoes_blue_speed",  name: "Blue Speed",       category: "shoes", rarity: "common", cost: 140,  color: "#3b82f6" },
  { id: "shoes_football",    name: "Football Boots",   category: "shoes", rarity: "common", cost: 200,  color: "#0f172a" },
  { id: "shoes_basketball",  name: "Basketball Hi-Tops",category: "shoes",rarity: "rare",   cost: 320,  color: "#f97316" },
  { id: "shoes_lifestyle",   name: "Lifestyle Trainers",category: "shoes",rarity: "rare",   cost: 340,  color: "#cbd5e1" },
  { id: "shoes_black_lite",  name: "Black Lite",       category: "shoes", rarity: "rare",   cost: 380,  color: "#0a0a0a" },
  { id: "shoes_neon_x",      name: "Neon X",           category: "shoes", rarity: "rare",   cost: 420,  color: "#22d3ee" },
  { id: "shoes_racing_elite",name: "Elite Racing",     category: "shoes", rarity: "epic",   cost: 1100, color: "#fbbf24" },
  { id: "shoes_carbon_x",    name: "Carbon X",         category: "shoes", rarity: "epic",   cost: 1000, color: "#374151" },
  { id: "shoes_fire",        name: "Fire Trail",       category: "shoes", rarity: "legendary", cost: 2400, color: "#f97316", description: "Leaves a fire trail as you move." },
  { id: "shoes_lightning",   name: "Lightning Trail",  category: "shoes", rarity: "legendary", cost: 2600, color: "#facc15", description: "Sparks lightning when you run." },
  { id: "shoes_stars",       name: "Star Trail",       category: "shoes", rarity: "legendary", cost: 2600, color: "#a78bfa", description: "Stardust follows every step." },
  { id: "shoes_arc_god",     name: "Arc Gods",         category: "shoes", rarity: "mythic",    cost: 4800, color: "#fbbf24" },

  // ============= HEADGEAR =============
  { id: "head_none",     name: "None",           category: "headgear", rarity: "common", cost: 0,   color: "transparent" },
  { id: "head_band",     name: "Headband",       category: "headgear", rarity: "common", cost: 100, color: "#ef4444" },
  { id: "head_cap_blk",  name: "Cap (Black)",    category: "headgear", rarity: "common", cost: 160, color: "#0a0a0a" },
  { id: "head_cap_wht",  name: "Cap (White)",    category: "headgear", rarity: "common", cost: 160, color: "#f4f4f5" },
  { id: "head_beanie",   name: "Beanie",         category: "headgear", rarity: "common", cost: 180, color: "#1f2937" },
  { id: "head_bucket",   name: "Bucket Hat",     category: "headgear", rarity: "rare",   cost: 340, color: "#22c55e" },
  { id: "head_visor",    name: "Speed Visor",    category: "headgear", rarity: "rare",   cost: 380, color: "#22d3ee" },
  { id: "head_helmet",   name: "Tactical Helm",  category: "headgear", rarity: "epic",   cost: 1100, color: "#475569" },
  { id: "head_crown",    name: "Champion Crown", category: "headgear", rarity: "legendary", cost: 2600, color: "#f59e0b", glyph: "👑" },
  { id: "head_halo",     name: "Halo",           category: "headgear", rarity: "legendary", cost: 3000, color: "#fde68a" },
  { id: "head_horns",    name: "Beast Horns",    category: "headgear", rarity: "legendary", cost: 2800, color: "#dc2626" },

  // ============= GLOVES =============
  { id: "gloves_none",   name: "None",          category: "gloves", rarity: "common", cost: 0,   color: "transparent" },
  { id: "gloves_grip",   name: "Grip Gloves",   category: "gloves", rarity: "common", cost: 120, color: "#1f2937" },
  { id: "gloves_sleeve", name: "Arm Sleeve",    category: "gloves", rarity: "rare",   cost: 320, color: "#0f172a" },
  { id: "gloves_red",    name: "Red Strike",    category: "gloves", rarity: "rare",   cost: 320, color: "#ef4444" },
  { id: "gloves_gold",   name: "Gold Touch",    category: "gloves", rarity: "epic",   cost: 1000, color: "#facc15" },

  // ============= ACCESSORY / EFFECTS =============
  { id: "acc_none",      name: "None",          category: "accessory", rarity: "common", cost: 0, color: "transparent" },
  { id: "acc_glasses",   name: "Sport Glasses", category: "accessory", rarity: "rare",   cost: 380, color: "#0a0a0a" },
  { id: "acc_chain",     name: "Gold Chain",    category: "accessory", rarity: "rare",   cost: 420, color: "#f59e0b" },
  { id: "acc_watch",     name: "Sports Watch",  category: "accessory", rarity: "rare",   cost: 380, color: "#22d3ee" },
  { id: "acc_headphones",name: "Headphones",    category: "accessory", rarity: "rare",   cost: 420, color: "#0a0a0a" },
  { id: "acc_backpack",  name: "Backpack",      category: "accessory", rarity: "rare",   cost: 480, color: "#1f2937" },
  { id: "acc_bottle",    name: "Water Bottle",  category: "accessory", rarity: "common", cost: 200, color: "#3b82f6" },
  { id: "acc_wings",     name: "Phantom Wings", category: "accessory", rarity: "epic",   cost: 1200, color: "#a78bfa", glyph: "🪽" },
  { id: "acc_aura",      name: "Blue Energy Aura", category: "accessory", rarity: "legendary", cost: 2400, color: "#22d3ee", description: "Radiant energy pulses around you." },
  { id: "acc_gold_aura", name: "Gold Aura",     category: "accessory", rarity: "legendary", cost: 2600, color: "#fbbf24" },
  { id: "acc_lightning", name: "Lightning FX",  category: "accessory", rarity: "legendary", cost: 2800, color: "#facc15" },
  { id: "acc_fire",      name: "Fire Aura",     category: "accessory", rarity: "legendary", cost: 2800, color: "#f97316" },
  { id: "acc_snow",      name: "Snowfall",      category: "accessory", rarity: "epic",   cost: 1400, color: "#e0f2fe" },
  { id: "acc_stars",     name: "Star Field",    category: "accessory", rarity: "epic",   cost: 1400, color: "#a78bfa" },
  { id: "acc_leaves",    name: "Falling Leaves",category: "accessory", rarity: "epic",   cost: 1200, color: "#22c55e" },
  { id: "acc_smoke",     name: "Smoke",         category: "accessory", rarity: "rare",   cost: 600, color: "#64748b" },
  { id: "acc_rainbow",   name: "Rainbow",       category: "accessory", rarity: "mythic", cost: 4200, color: "#a855f7" },

  // ============= BADGE / TITLES =============
  { id: "badge_none",    name: "None",          category: "badge", rarity: "common", cost: 0, color: "transparent" },
  { id: "badge_rookie",  name: "Rookie",        category: "badge", rarity: "common",    cost: 100, color: "#6b7280", glyph: "🔰" },
  { id: "badge_grinder", name: "Grinder",       category: "badge", rarity: "rare",      cost: 320, color: "#3b82f6", glyph: "⚡" },
  { id: "badge_apex",    name: "Apex",          category: "badge", rarity: "epic",      cost: 1000, color: "#a855f7", glyph: "🔺" },
  { id: "badge_legend",  name: "Legend",        category: "badge", rarity: "legendary", cost: 2400, color: "#f59e0b", glyph: "🏆" },
  { id: "badge_mythic",  name: "Mythic",        category: "badge", rarity: "mythic",    cost: 4400, color: "#ffffff", glyph: "✨" },

  // ============= BACKGROUNDS =============
  { id: "bg_void",       name: "Void",              category: "background", rarity: "common",    cost: 0,    color: "#0f172a" },
  { id: "bg_arena",      name: "Arena Lights",      category: "background", rarity: "rare",      cost: 320,  color: "#1d4ed8" },
  { id: "bg_track",      name: "Running Track",     category: "background", rarity: "rare",      cost: 380,  color: "#dc2626" },
  { id: "bg_football",   name: "Football Stadium",  category: "background", rarity: "rare",      cost: 380,  color: "#16a34a" },
  { id: "bg_basketball", name: "Basketball Arena",  category: "background", rarity: "rare",      cost: 380,  color: "#f97316" },
  { id: "bg_gym",        name: "Gym Floor",         category: "background", rarity: "common",    cost: 200,  color: "#1f2937" },
  { id: "bg_beach",      name: "Beach",             category: "background", rarity: "epic",      cost: 900,  color: "#f59e0b" },
  { id: "bg_mountains",  name: "Mountains",         category: "background", rarity: "epic",      cost: 900,  color: "#0891b2" },
  { id: "bg_city",       name: "Night City",        category: "background", rarity: "epic",      cost: 1000, color: "#7c3aed" },
  { id: "bg_training",   name: "Training Facility", category: "background", rarity: "epic",      cost: 1000, color: "#334155" },
  { id: "bg_space",      name: "Deep Space",        category: "background", rarity: "legendary", cost: 2400, color: "#0f172a" },
  { id: "bg_storm",      name: "Storm",             category: "background", rarity: "epic",      cost: 900,  color: "#7c3aed" },
  { id: "bg_inferno",    name: "Inferno",           category: "background", rarity: "legendary", cost: 2200, color: "#dc2626" },
  { id: "bg_aurora",     name: "Aurora",            category: "background", rarity: "legendary", cost: 2400, color: "#06b6d4" },

  // ============= POSE / ANIMATIONS =============
  { id: "pose_stance",   name: "Ready Stance",  category: "pose", rarity: "common",    cost: 0 },
  { id: "pose_walk",     name: "Walk",          category: "pose", rarity: "common",    cost: 200 },
  { id: "pose_jog",      name: "Jog",           category: "pose", rarity: "common",    cost: 240 },
  { id: "pose_sprint",   name: "Sprint",        category: "pose", rarity: "rare",      cost: 380 },
  { id: "pose_power",    name: "Power Walk",    category: "pose", rarity: "rare",      cost: 380 },
  { id: "pose_champ_walk",name:"Champion Walk", category: "pose", rarity: "epic",      cost: 1000 },
  { id: "pose_flex",     name: "Flex",          category: "pose", rarity: "rare",      cost: 320 },
  { id: "pose_fist",     name: "Fist Pump",     category: "pose", rarity: "rare",      cost: 380 },
  { id: "pose_dance",    name: "Dance",         category: "pose", rarity: "epic",      cost: 1000 },
  { id: "pose_backflip", name: "Backflip",      category: "pose", rarity: "epic",      cost: 1200 },
  { id: "pose_victory",  name: "Victory",       category: "pose", rarity: "epic",      cost: 1000 },
  { id: "pose_champion", name: "Champion Pose", category: "pose", rarity: "legendary", cost: 2200 },
  { id: "pose_olympic",  name: "Olympic Celebration", category: "pose", rarity: "legendary", cost: 2600 },
  { id: "pose_ascend",   name: "Ascend",        category: "pose", rarity: "mythic",    cost: 4200 },

  // ============= EXPANDED DROP — more cosmetics (all Coins) =============
  // Tops — extra variety so every sport/aesthetic has options
  { id: "outfit_streetwear",   name: "Streetwear",     category: "outfit", rarity: "rare",      cost: 360,  color: "#0f172a", description: "Relaxed street layer." },
  { id: "outfit_racing_stripes", name: "Racing Stripes", category: "outfit", rarity: "rare",    cost: 420,  color: "#e11d48", description: "Bold speed stripes." },
  { id: "outfit_pitch_black",  name: "Pitch Black",    category: "outfit", rarity: "rare",      cost: 380,  color: "#020617", description: "Matte black kit." },
  { id: "outfit_aqua_flow",    name: "Aqua Flow",      category: "outfit", rarity: "rare",      cost: 320,  color: "#06b6d4", description: "Pool-side palette." },
  { id: "outfit_volta",        name: "Volta",          category: "outfit", rarity: "epic",      cost: 950,  color: "#7c3aed", description: "Electric football flash." },
  { id: "outfit_frostbite_kit",name: "Frostbite Kit",  category: "outfit", rarity: "epic",      cost: 1050, color: "#bae6fd", description: "Ice-cold away strip." },
  { id: "outfit_titan",        name: "Titan Weave",    category: "outfit", rarity: "legendary", cost: 2600, color: "#1e3a8a", description: "Woven carbon fibre." },
  { id: "outfit_nova",         name: "Nova Pulse",     category: "outfit", rarity: "mythic",    cost: 5000, color: "#ec4899", description: "Pulses with match tempo." },

  // Bottoms
  { id: "pants_street_cargo",  name: "Street Cargo",   category: "pants",  rarity: "rare",      cost: 340,  color: "#334155" },
  { id: "pants_neon_cargo",    name: "Neon Cargo",     category: "pants",  rarity: "rare",      cost: 380,  color: "#22d3ee" },
  { id: "pants_titan_shorts",  name: "Titan Shorts",   category: "pants",  rarity: "epic",      cost: 950,  color: "#1e40af" },

  // Shoes
  { id: "shoes_street_kicks",  name: "Street Kicks",   category: "shoes",  rarity: "rare",      cost: 360,  color: "#e5e7eb" },
  { id: "shoes_aqua_glide",    name: "Aqua Glide",     category: "shoes",  rarity: "rare",      cost: 380,  color: "#06b6d4" },
  { id: "shoes_volta_speed",   name: "Volta Speed",    category: "shoes",  rarity: "epic",      cost: 1050, color: "#f59e0b" },
  { id: "shoes_frost_step",    name: "Frost Step",     category: "shoes",  rarity: "epic",      cost: 1100, color: "#7dd3fc" },
  { id: "shoes_titan_grip",    name: "Titan Grip",     category: "shoes",  rarity: "legendary", cost: 2400, color: "#0f172a" },

  // Headgear
  { id: "head_snapback_gold",  name: "Gold Snapback",  category: "headgear", rarity: "epic",   cost: 950,  color: "#fbbf24", glyph: "🧢" },
  { id: "head_neon_visor",     name: "Neon Visor",     category: "headgear", rarity: "rare",   cost: 420,  color: "#22d3ee" },
  { id: "head_hood_up",        name: "Hood Up",        category: "headgear", rarity: "rare",   cost: 340,  color: "#0f172a" },
  { id: "head_wolf_hood",      name: "Wolf Hood",      category: "headgear", rarity: "epic",   cost: 1200, color: "#4a2d18" },
  { id: "head_crown_obsidian", name: "Obsidian Crown", category: "headgear", rarity: "legendary", cost: 3200, color: "#020617", glyph: "👑" },

  // Gloves
  { id: "gloves_power_wrap",   name: "Power Wrap",     category: "gloves", rarity: "rare",      cost: 360,  color: "#dc2626" },
  { id: "gloves_frost_grip",   name: "Frost Grip",     category: "gloves", rarity: "epic",      cost: 950,  color: "#7dd3fc" },
  { id: "gloves_titan_gauntlet", name: "Titan Gauntlet", category: "gloves", rarity: "legendary", cost: 2400, color: "#1e3a8a" },

  // Accessories / FX
  { id: "acc_holo_scout",      name: "Holo Scout",     category: "accessory", rarity: "rare",   cost: 480,  color: "#38bdf8" },
  { id: "acc_neon_trails",     name: "Neon Trails",    category: "accessory", rarity: "epic",   cost: 1200, color: "#22d3ee" },
  { id: "acc_energy_orb",      name: "Energy Orb",     category: "accessory", rarity: "epic",   cost: 1300, color: "#a78bfa" },
  { id: "acc_titan_wings",     name: "Titan Wings",    category: "accessory", rarity: "legendary", cost: 3000, color: "#f59e0b", glyph: "🪽" },
  { id: "acc_comet_tail",      name: "Comet Tail",     category: "accessory", rarity: "mythic", cost: 4500, color: "#f97316", description: "A comet follows your sprints." },

  // Badges / Titles
  { id: "badge_sprinter",      name: "Sprinter",       category: "badge", rarity: "rare",      cost: 300, color: "#ef4444", glyph: "💨" },
  { id: "badge_titan",         name: "Titan",          category: "badge", rarity: "legendary", cost: 2600, color: "#1e40af", glyph: "🗿" },
  { id: "badge_nova",          name: "Nova",           category: "badge", rarity: "mythic",    cost: 4600, color: "#ec4899", glyph: "🌟" },

  // Backgrounds
  { id: "bg_neon_city_night",  name: "Neon City Nights", category: "background", rarity: "epic", cost: 1100, color: "#7c3aed" },
  { id: "bg_frozen_tundra",    name: "Frozen Tundra",    category: "background", rarity: "epic", cost: 950,  color: "#bae6fd" },
  { id: "bg_titan_arena",      name: "Titan Arena",      category: "background", rarity: "legendary", cost: 2600, color: "#1e3a8a" },
  { id: "bg_volcano_summit",   name: "Volcano Summit",   category: "background", rarity: "legendary", cost: 2400, color: "#7f1d1d" },

  // Poses
  { id: "pose_shadow_step",    name: "Shadow Step",     category: "pose", rarity: "epic",      cost: 1100 },
  { id: "pose_wolf_howl",      name: "Wolf Howl",       category: "pose", rarity: "rare",      cost: 420 },
  { id: "pose_titan_slam",     name: "Titan Slam",      category: "pose", rarity: "legendary", cost: 2400 },
  { id: "pose_nova_spin",      name: "Nova Spin",       category: "pose", rarity: "mythic",    cost: 4300 },
];

export const ITEM_BY_ID = new Map(CATALOG.map((i) => [i.id, i]));

export const STARTER_ITEMS = new Set<string>(
  CATALOG.filter((i) => i.cost === 0).map((i) => i.id),
);

export const getItem = (id?: string | null) => (id ? ITEM_BY_ID.get(id) : undefined);

// Price ranges retained for admin tooling.
export const TIER_PRICES = {
  common: [40, 200],
  rare: [200, 600],
  epic: [600, 1500],
  legendary: [1500, 4000],
  mythic: [4000, 8000],
} as const;

export const DEFAULT_LOADOUT = {
  body: "body_athletic",
  skin_tone: "tone_4",
  face_shape: "face_oval",
  expression: "exp_neutral",
  hair: "hair_short",
  hair_color: "hcol_black",
  eye_color: "eye_brown",
  brows: "brow_straight",
  facial_hair: "fh_clean",
  outfit: "outfit_basic_blue",
  pants: "pants_shorts_blk",
  shoes: "shoes_basic",
  headgear: "head_none",
  accessory: "acc_none",
  gloves: "gloves_none",
  badge: "badge_none",
  background: "bg_void",
  pose: "pose_stance",
} as const;
