// ============================================================================
// REWARD BOX GRANT — the client half of src/lib/rewardBoxes.ts
// ----------------------------------------------------------------------------
// Opening a box is a SERVER decision: claim_reward_box (migration
// 20261015120000_reward_box_grants.sql) picks the item from the milestone's
// rarity tier, grants ownership without touching the wallet, and records the
// claim so a box can only ever be opened once. The client never names the item
// it wants — a client that chose its own reward would be the economy's hole.
//
// Names are resolved here rather than by the server because avatar_catalog
// stores no display name (the client catalog owns presentation); the server
// returns the authoritative item_id/category/rarity and the client decorates.
// ============================================================================

import { supabase } from "@/integrations/supabase/client";
import { getItem, type Rarity } from "@/lib/avatarCatalog";
import type { BoxSource } from "@/lib/rewardBoxes";

export interface BoxGrant {
  itemId: string;
  /** Display name from the client catalog; falls back to the raw id. */
  name: string;
  category: string;
  rarity: Rarity;
  /** Coin cost the box saved the athlete (display only — nothing was spent). */
  value: number;
  /** True when this box had already been opened — returned, never re-granted. */
  alreadyClaimed: boolean;
}

/**
 * Open a reward box. Returns the granted item, or an error the UI can show
 * honestly (an undeployed migration, a signed-out session, a network failure).
 */
export async function claimRewardBox(
  source: BoxSource,
  threshold: number,
): Promise<{ grant: BoxGrant | null; error: string | null }> {
  const { data, error } = await supabase.rpc("claim_reward_box" as never, {
    p_source: source,
    p_threshold: threshold,
  } as never);
  if (error) return { grant: null, error: error.message };

  const row = (data ?? {}) as {
    item_id?: string;
    category?: string;
    rarity?: string;
    cost?: number;
    already_claimed?: boolean;
  };
  if (!row.item_id) return { grant: null, error: "This box came back empty." };

  return {
    grant: {
      itemId: row.item_id,
      name: getItem(row.item_id)?.name ?? row.item_id,
      category: row.category ?? getItem(row.item_id)?.category ?? "",
      rarity: (row.rarity as Rarity) ?? getItem(row.item_id)?.rarity ?? "rare",
      value: typeof row.cost === "number" ? row.cost : (getItem(row.item_id)?.cost ?? 0),
      alreadyClaimed: row.already_claimed === true,
    },
    error: null,
  };
}
