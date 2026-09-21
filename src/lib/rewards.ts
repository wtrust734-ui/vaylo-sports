// Big Reward Chest - client-side constants & helpers
// Single source of truth for rarity styling and probability display.
export type Rarity = "common" | "rare" | "epic" | "legendary" | "mythic";

export const RARITY_ORDER: Rarity[] = ["common", "rare", "epic", "legendary", "mythic"];

export const DEFAULT_PROBABILITIES: Record<Rarity, number> = {
  common: 55, rare: 28, epic: 12, legendary: 4, mythic: 1,
};

export const DEFAULT_DUPLICATE_CONVERSION: Record<Rarity, number> = {
  common: 1, rare: 2, epic: 4, legendary: 8, mythic: 15,
};

export const RARITY_META: Record<Rarity, {
  label: string;
  text: string;      // tailwind text color
  bg: string;        // tailwind background
  border: string;    // tailwind border
  glow: string;      // box-shadow color
  gradient: string;  // gradient bg
}> = {
  common:    { label: "Common",    text: "text-slate-300", bg: "bg-slate-500/15", border: "border-slate-400/40", glow: "rgba(148,163,184,0.55)", gradient: "linear-gradient(135deg,#64748b,#94a3b8)" },
  rare:      { label: "Rare",      text: "text-sky-300",   bg: "bg-sky-500/15",   border: "border-sky-400/50",   glow: "rgba(56,189,248,0.65)",  gradient: "linear-gradient(135deg,#0284c7,#38bdf8)" },
  epic:      { label: "Epic",      text: "text-fuchsia-300", bg: "bg-fuchsia-500/15", border: "border-fuchsia-400/50", glow: "rgba(217,70,239,0.7)", gradient: "linear-gradient(135deg,#7e22ce,#d946ef)" },
  legendary: { label: "Legendary", text: "text-amber-300", bg: "bg-amber-500/15", border: "border-amber-400/60", glow: "rgba(251,191,36,0.8)",  gradient: "linear-gradient(135deg,#b45309,#fbbf24)" },
  mythic:    { label: "Mythic",    text: "text-white",     bg: "bg-white/10",     border: "border-white/40",     glow: "rgba(255,255,255,0.9)", gradient: "linear-gradient(135deg,#f43f5e,#f59e0b,#22c55e,#38bdf8,#a855f7)" },
};

export interface RewardResult {
  id: string;
  name: string;
  description?: string;
  type: string;
  category: string;
  rarity: Rarity;
  icon?: string;
  payload?: Record<string, unknown>;
}

export interface ChestResponse {
  ok: true;
  cycleNumber: number;
  reward: RewardResult;
  duplicate: boolean;
  convertedCredits: number;
  creditsAwarded: number;
}
