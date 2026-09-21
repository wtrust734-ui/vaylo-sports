// Event Pack data layer: merges the built-in catalog with admin rows,
// and handles permanent (lifetime) ownership.

import { supabase } from "@/integrations/supabase/client";
import {
  BUILT_IN_EVENT_PACKS,
  DESIGNED_FOR,
  formatPackPrice,
  type EventPack,
  type EventPackDifficulty,
  type EventPackSection,
} from "@/config/eventPacks";

export type { EventPack, EventPackDifficulty, EventPackSection };

type AdminRow = {
  pack_id: string;
  name: string;
  sport: string;
  category: string | null;
  target_event: string | null;
  description: string | null;
  weeks: number | null;
  price_cents: number | null;
  difficulty: string | null;
  designed_for: string | null;
  includes: string[] | null;
  version: string | null;
  future_updates_included: boolean | null;
  featured: boolean | null;
  sections: string[] | null;
  popularity: number | null;
  retired: boolean | null;
  updated_at: string | null;
};

function mergeRow(base: EventPack | null, row: AdminRow): EventPack {
  const difficulty = (row.difficulty as EventPackDifficulty) || base?.difficulty || "Intermediate";
  const priceCents = row.price_cents ?? base?.priceCents ?? 1999;
  const sections = (row.sections?.length ? row.sections : base?.sections ?? []) as EventPackSection[];
  const featured = row.featured ?? base?.featured ?? false;
  return {
    id: row.pack_id,
    name: row.name || base?.name || row.pack_id,
    sport: row.sport || base?.sport || "General",
    category: row.category || base?.category || "General",
    targetEvent: row.target_event || base?.targetEvent || row.name,
    distance: base?.distance ?? null,
    description: row.description || base?.description || "",
    weeks: row.weeks ?? base?.weeks ?? 8,
    price: formatPackPrice(priceCents),
    priceCents,
    difficulty,
    designedFor: row.designed_for || base?.designedFor || DESIGNED_FOR[difficulty],
    includes: row.includes?.length ? row.includes : base?.includes ?? [],
    version: row.version || base?.version || "1.0",
    updatedAt: (row.updated_at || base?.updatedAt || "").slice(0, 10),
    futureUpdatesIncluded: row.future_updates_included ?? base?.futureUpdatesIncluded ?? true,
    popularity: row.popularity ?? base?.popularity ?? 50,
    sections: featured && !sections.includes("featured") ? ["featured", ...sections] : sections,
    featured,
    retired: row.retired ?? false,
  };
}

/**
 * Full catalog. Admin rows override built-in packs by pack_id and may add new ones.
 * Retired packs stay in the returned list (flagged) so existing owners keep access.
 */
export async function loadEventPacks(): Promise<EventPack[]> {
  const byId = new Map<string, EventPack>();
  for (const p of BUILT_IN_EVENT_PACKS) byId.set(p.id, p);

  try {
    const { data } = await supabase.from("event_packs" as any).select("*");
    for (const row of ((data || []) as unknown as AdminRow[])) {
      byId.set(row.pack_id, mergeRow(byId.get(row.pack_id) ?? null, row));
    }
  } catch {
    // Catalog still works from built-in packs if the request fails.
  }

  return [...byId.values()];
}

/** Pack ids permanently owned by the signed-in athlete (restores on any device). */
export async function loadOwnedPackIds(): Promise<string[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data } = await supabase
    .from("event_pack_ownership" as any)
    .select("pack_id")
    .eq("user_id", user.id);
  return ((data || []) as any[]).map((r) => r.pack_id as string);
}

/** Records permanent ownership. Duplicates are ignored. */
export async function claimEventPack(pack: EventPack): Promise<{ duplicate: boolean }> {
  const { data, error } = await supabase.rpc("claim_event_pack" as any, {
    p_pack_id: pack.id,
    p_pack_name: pack.name,
    p_sport: pack.sport,
    p_price_cents: pack.priceCents,
    p_version: pack.version,
  });
  if (error) throw error;
  return { duplicate: !!(data as any)?.duplicate };
}

/** Similar packs: same target event first, then same sport/category. */
export function relatedPacks(pack: EventPack, all: EventPack[], limit = 4): EventPack[] {
  const score = (p: EventPack) => {
    let s = 0;
    if (p.sport === pack.sport) s += 3;
    if (p.category === pack.category) s += 2;
    if (p.targetEvent === pack.targetEvent) s += 1;
    if (p.difficulty === pack.difficulty) s += 2;
    if (Math.abs(p.weeks - pack.weeks) <= 4) s += 1;
    return s;
  };
  return all
    .filter((p) => p.id !== pack.id && !p.retired && p.targetEvent !== pack.targetEvent)
    .sort((a, b) => score(b) - score(a) || b.popularity - a.popularity)
    .slice(0, limit);
}

export const SECTION_LABELS: { key: EventPackSection; label: string; blurb: string }[] = [
  { key: "recommended", label: "Recommended For You", blurb: "Matched to your sport and level" },
  { key: "featured", label: "Featured", blurb: "Hand-picked by the Vaylo coaching team" },
  { key: "popular", label: "Most Popular", blurb: "Bought most often by athletes like you" },
  { key: "beginner", label: "Beginner Friendly", blurb: "Great first structured plan" },
  { key: "new", label: "New", blurb: "Recently added to the catalogue" },
  { key: "seasonal", label: "Seasonal", blurb: "In season right now" },
];
