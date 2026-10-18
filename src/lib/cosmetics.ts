// ============================================================================
// PROFILE COSMETICS
// ----------------------------------------------------------------------------
// The identity layer: titles, borders, backgrounds, name colors and effects.
// Definitions live in `reward_definitions`, ownership in `user_rewards`, and
// what is currently equipped in `user_profile_cosmetics` (one row per user).
//
// Purchasing and equipping both go through SECURITY DEFINER RPCs, which check
// ownership and read the price from the database — the client can only ask.
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { Rarity } from "@/lib/rewards";

export { isAvailableNow } from "@/lib/cosmeticCatalog";

/** Animated items (>payload.animated) can only be worn with an active subscription. */

export type CosmeticType = "title" | "border" | "background" | "name_color" | "effect" | "badge";

/** Equip slot column on `user_profile_cosmetics` for each cosmetic type. */
export const SLOT_BY_TYPE: Record<CosmeticType, string> = {
  title: "title_id",
  border: "border_id",
  background: "background_id",
  name_color: "name_color_id",
  effect: "effect_id",
  badge: "badge_id",
};

/** Types that can be bought with coins. Badges stay earn-only (prestige). */
export const SELLABLE_TYPES: CosmeticType[] = ["title", "border", "background", "name_color", "effect"];

export const TYPE_META: Record<CosmeticType, { label: string; blurb: string }> = {
  title: { label: "Titles", blurb: "The word under your name." },
  border: { label: "Borders", blurb: "The ring around your avatar." },
  background: { label: "Backdrops", blurb: "Behind your profile card." },
  name_color: { label: "Name colors", blurb: "How your name reads." },
  effect: { label: "Effects", blurb: "Ambient flair on your profile." },
  badge: { label: "Badges", blurb: "Earned from chests and challenges." },
};

export interface CosmeticDef {
  id: string;
  name: string;
  description: string | null;
  type: CosmeticType;
  category: string;
  rarity: Rarity;
  payload: Record<string, unknown> | null;
  coin_cost: number | null;
  icon: string | null;
  season: string | null;
  available_from: string | null;
  available_to: string | null;
}

export interface EquippedRow {
  title_id: string | null;
  border_id: string | null;
  background_id: string | null;
  name_color_id: string | null;
  badge_id: string | null;
  effect_id: string | null;
}

const EMPTY_EQUIPPED: EquippedRow = {
  title_id: null,
  border_id: null,
  background_id: null,
  name_color_id: null,
  badge_id: null,
  effect_id: null,
};

/** Human label for a cosmetic (titles store their display text in payload). */
export const cosmeticLabel = (def?: CosmeticDef | null): string => {
  if (!def) return "";
  const label = (def.payload as { label?: string } | null)?.label;
  return label ?? def.name;
};

/** Color a cosmetic paints with (name colors and borders). */
export const cosmeticColor = (def?: CosmeticDef | null): string | null =>
  (def?.payload as { color?: string } | null)?.color ?? null;

export const isAnimated = (def?: CosmeticDef | null): boolean =>
  !!(def?.payload as { animated?: boolean } | null)?.animated;

export interface UseCosmetics {
  defs: CosmeticDef[];
  ownedIds: Set<string>;
  /** How each owned item was obtained — 'coins' when bought, e.g. 'achievement' / 'chest' when earned. */
  ownedSourceById: Record<string, string>;
  equipped: EquippedRow;
  loading: boolean;
  /** Cosmetic definitions currently equipped, by slot column. */
  equippedDefs: Partial<Record<keyof EquippedRow, CosmeticDef>>;
  refresh: () => Promise<void>;
  buy: (id: string) => Promise<{ error: string | null }>;
  equip: (id: string) => Promise<{ error: string | null }>;
  unequip: (slot: keyof EquippedRow) => Promise<{ error: string | null }>;
  defById: (id?: string | null) => CosmeticDef | undefined;
}

export function useCosmetics(): UseCosmetics {
  const { user } = useAuth();
  const [defs, setDefs] = useState<CosmeticDef[]>([]);
  const [ownedIds, setOwnedIds] = useState<Set<string>>(new Set());
  const [ownedSourceById, setOwnedSourceById] = useState<Record<string, string>>({});
  const [equipped, setEquipped] = useState<EquippedRow>(EMPTY_EQUIPPED);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user) {
      setDefs([]);
      setOwnedIds(new Set());
      setEquipped(EMPTY_EQUIPPED);
      setLoading(false);
      return;
    }
    setLoading(true);
    const [defRes, ownedRes, equippedRes] = await Promise.all([
      supabase.from("reward_definitions").select("*").eq("active", true).order("rarity"),
      // `source` comes with the inventory so items can be tagged Earned vs
      // bought ('coins') in the collection — the earned ones are the status
      // markers the research called the real product.
      supabase.from("user_rewards").select("reward_id, source").eq("user_id", user.id),
      supabase.from("user_profile_cosmetics").select("*").eq("user_id", user.id).maybeSingle(),
    ]);
    if (defRes.error) console.error("cosmetics: definitions failed", defRes.error);
    if (ownedRes.error) console.error("cosmetics: inventory failed", ownedRes.error);
    if (equippedRes.error) console.error("cosmetics: equipped failed", equippedRes.error);

    const ownedRows = (ownedRes.data ?? []) as unknown as { reward_id: string; source?: string }[];
    setDefs((defRes.data ?? []) as unknown as CosmeticDef[]);
    setOwnedIds(new Set(ownedRows.map((r) => r.reward_id)));
    setOwnedSourceById(Object.fromEntries(ownedRows.map((r) => [r.reward_id, r.source ?? ""])));
    setEquipped({ ...EMPTY_EQUIPPED, ...((equippedRes.data as EquippedRow) ?? {}) });
    setLoading(false);
  }, [user]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Re-read when another surface mutates ownership server-side (the shop
  // store dispatches this after its RPCs). Without it, Collection/Profile and
  // the wardrobe could show different inventories after one purchase.
  useEffect(() => {
    const onChange = () => { void refresh(); };
    window.addEventListener("vaylo:cosmetics-changed", onChange);
    return () => window.removeEventListener("vaylo:cosmetics-changed", onChange);
  }, [refresh]);

  const buy = useCallback(async (id: string) => {
    const { error } = await supabase.rpc("purchase_cosmetic" as never, { p_reward_id: id } as never);
    if (error) return { error: error.message };
    await refresh();
    void revalidateOwnedIds();
    return { error: null };
  }, [refresh]);

  const equip = useCallback(async (id: string) => {
    const { error } = await supabase.rpc("equip_cosmetic" as never, { p_reward_id: id } as never);
    if (error) return { error: error.message };
    await refresh();
    void revalidateOwnedIds();
    return { error: null };
  }, [refresh]);

  const unequip = useCallback(async (slot: keyof EquippedRow) => {
    const { error } = await supabase.rpc("unequip_cosmetic" as never, { p_slot: slot } as never);
    if (error) return { error: error.message };
    await refresh();
    void revalidateOwnedIds();
    return { error: null };
  }, [refresh]);

  const revalidateOwnedIds = useCallback(async () => {
    const { data, error } = await supabase
      .from("user_rewards")
      .select("reward_id, source")
      .eq("user_id", user.id);
    if (!error && data) {
      const rows = data as unknown as { reward_id: string; source?: string }[];
      setOwnedIds(new Set(rows.map((r) => r.reward_id)));
      setOwnedSourceById(Object.fromEntries(rows.map((r) => [r.reward_id, r.source ?? ""])));
    }
  }, [user]);

  const defById = useCallback(
    (id?: string | null) => (id ? defs.find((d) => d.id === id) : undefined),
    [defs]
  );

  const equippedDefs = useMemo(() => {
    const out: Partial<Record<keyof EquippedRow, CosmeticDef>> = {};
    for (const slot of Object.keys(EMPTY_EQUIPPED) as (keyof EquippedRow)[]) {
      const def = defById(equipped[slot]);
      if (def) out[slot] = def;
    }
    return out;
  }, [equipped, defById]);

  return { defs, ownedIds, ownedSourceById, equipped, loading, equippedDefs, refresh, buy, equip, unequip, defById };
}
