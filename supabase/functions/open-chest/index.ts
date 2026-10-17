// Big Reward Chest - server-side reward generation
//
// Roll design. The rarity roll and the reward pick are now DETERMINISTIC per
// (user, chest cycle): seeded SHA-256 bytes replace Math.random(). That is what
// makes this settle order safe:
//
//   1. pick the reward (pure, deterministic),
//   2. claim the cycle — UNIQUE(user_id, cycle_number) is the double-open gate,
//   3. settle the reward mutations.
//
// If step 3 fails transiently, the catch deletes the taken claim row so the
// cycle retries — and because the roll is deterministic, the retry settles the
// SAME reward with the SAME idempotency key, so nothing can be granted twice.
//
// Before this change the double-open guard was read-then-mutate-then-claim-
// LAST: two concurrent requests could each complete their mutations before one
// lost the claim-insert race with a raw 500.
//
// The DB backstops value integrity anyway (`user_rewards` carries
// UNIQUE(user_id, reward_id); `credits_grant` is keyed per reward), but the
// deterministic roll removes the wasted-roll and the reward-switch windows.
//
// deno-lint-ignore-file no-explicit-any
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

/**
 * The edge client is intentionally untyped (`createClient` without the Database
 * generic — the generated types live in the web app, not the functions; see the
 * identical shim in process-purchase). Without this shim the query builders
 * collapse to `never` under strictNullChecks and every read in this file
 * "fails" to typecheck — the nine errors this file used to carry.
 */
type LooseClient = Omit<SupabaseClient, "from" | "rpc"> & {
  from: (table: string) => any;
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
};
const asLoose = (c: SupabaseClient): LooseClient => c as unknown as LooseClient;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type SupabaseRaw = ReturnType<typeof createClient>;

// ----------------------------------------------------------------------------
// Deterministic randomness: 32 uniform bytes from SHA-256, walked through
// weight ladders. The same settle math as Math.random(), replayable per seed.
// ----------------------------------------------------------------------------
async function seedBytes(seed: string): Promise<number[]> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(seed));
  return Array.from(new Uint8Array(digest));
}

function weightedPick<T>(items: T[], weight: (t: T) => number, bytes: number[], offset: number): T | null {
  const total = items.reduce((s, i) => s + Math.max(weight(i), 0), 0);
  if (items.length === 0 || total <= 0) return null;
  const target = (bytes[offset % bytes.length] / 256) * total;
  let window = 0;
  for (const item of items) {
    window += Math.max(weight(item), 0);
    if (target < window) return item;
  }
  return items[items.length - 1];
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface RewardRow {
  id: string;
  type: string;
  name?: string | null;
  description?: string | null;
  category?: string | null;
  rarity: string;
  icon?: string | null;
  payload?: { amount?: number | string } | null;
  available_from?: string | null;
  available_to?: string | null;
  weight_override?: number | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Visible to the catch so it can hand a taken claim back on failure.
  let supabase: LooseClient | null = null;
  let takenClaimId: string | null = null;

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace("Bearer ", "");
    if (!jwt) return json({ error: "Not authenticated" }, 401);

    supabase = asLoose(createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    ));

    const { data: userData, error: userErr } = await supabase.auth.getUser(jwt) as { data: { user: { id: string } | null } | null; error: { message: string } | null };
    if (userErr || !userData?.user) return json({ error: "Invalid session" }, 401);
    const userId = userData.user.id;

    // 1) Validate streak >= 7 and determine cycle
    const { data: streak } = await supabase
      .from("streaks")
      .select("current_streak")
      .eq("user_id", userId)
      .maybeSingle();
    const current = streak?.current_streak ?? 0;
    if (current < 7) {
      return json({ error: "Chest unlocks at a 7-day streak.", current }, 400);
    }
    const cycleNumber = Math.floor(current / 7);

    // 2) Read-only fast path for the friendly 409; the claim insert below is
    //    what actually decides the race.
    const { data: existing } = await supabase
      .from("chest_claims")
      .select("id")
      .eq("user_id", userId)
      .eq("cycle_number", cycleNumber)
      .maybeSingle();
    if (existing) return json({ error: "Chest already opened for this cycle.", cycleNumber }, 409);

    // 3) Config + eligible rewards (availability windows respected).
    const { data: cfg } = await supabase.from("reward_config").select("*").eq("id", 1).maybeSingle();
    const probs: Record<string, number> = cfg?.probabilities ?? { common: 55, rare: 28, epic: 12, legendary: 4, mythic: 1 };
    const convMap: Record<string, number> = cfg?.duplicate_conversion ?? { common: 1, rare: 2, epic: 4, legendary: 8, mythic: 15 };

    const now = new Date().toISOString();
    const { data: pool } = await supabase
      .from("reward_definitions")
      .select("*")
      .eq("active", true);
    const eligible = ((pool ?? []) as RewardRow[]).filter((r) =>
      (!r.available_from || r.available_from <= now) &&
      (!r.available_to || r.available_to >= now)
    );
    if (eligible.length === 0) return json({ error: "No rewards available." }, 500);

    // 4) Deterministic rarity roll + weighted reward pick, per (user, cycle).
    const bytes = await seedBytes(`${userId}:${cycleNumber}`);
    const rarity = weightedPick(
      Object.entries(probs).map(([key, w]) => ({ key, weight: Number(w) })),
      (e) => e.weight,
      bytes,
      0,
    )?.key ?? "common";
    let candidates = eligible.filter((r) => r.rarity === rarity);
    if (candidates.length === 0) candidates = eligible; // fallback
    const chosen =
      weightedPick(candidates, (r) => r.weight_override ?? 1, bytes, 1) ??
      candidates[candidates.length - 1];

    // 5) Duplicate check (permanent items only, not credits/consumables).
    //    Read-only: decided before any mutation, and the deterministic roll
    //    means a retry reaches the identical conclusion.
    const isPermanent = !["credits", "consumable"].includes(chosen.type);
    let wasDuplicate = false;
    let convertedCredits = 0;
    let creditsAwarded = 0;

    if (chosen.type === "credits") {
      creditsAwarded = Number(chosen.payload?.amount ?? 0);
    } else if (isPermanent) {
      const { data: owned } = await supabase
        .from("user_rewards").select("id")
        .eq("user_id", userId).eq("reward_id", chosen.id).maybeSingle();
      if (owned) {
        wasDuplicate = true;
        convertedCredits = convMap[chosen.rarity] ?? 1;
        creditsAwarded = convertedCredits;
      }
    }

    // 6) Claim FIRST — UNIQUE(user_id, cycle_number) decides the race. (The
    //    reward fields are available because the roll precedes the claim.)
    const { data: claimed, error: claimErr } = await supabase
      .from("chest_claims")
      .insert({
        user_id: userId,
        cycle_number: cycleNumber,
        reward_id: chosen.id,
        reward_type: chosen.type,
        rarity: chosen.rarity,
        was_duplicate: wasDuplicate,
        converted_credits: convertedCredits,
      })
      .select("id")
      .maybeSingle();
    if (claimErr?.code === "23505") {
      return json({ error: "Chest already opened for this cycle.", cycleNumber }, 409);
    }
    if (claimErr != null || claimed == null) {
      throw new Error(`Could not record chest claim: ${claimErr?.message ?? "missing claim row"}`);
    }
    takenClaimId = (claimed as { id?: string } | null)?.id ?? null;

    // 7) Settle the reward. Each step is idempotent against a retry of the
    //    SAME deterministic roll (or read-only before this point), so a
    //    transient failure cannot grant anything twice.
    if (chosen.type === "consumable") {
      const { data: existingConsumable } = await supabase
        .from("user_consumables").select("quantity")
        .eq("user_id", userId).eq("reward_id", chosen.id).maybeSingle();
      const newQty = (existingConsumable?.quantity ?? 0) + 1;
      await supabase.from("user_consumables").upsert({
        user_id: userId, reward_id: chosen.id, quantity: newQty, updated_at: now,
      });
    } else if (isPermanent && !wasDuplicate) {
      const { data: owned, error: insertErr } = await supabase
        .from("user_rewards")
        .insert({
          user_id: userId, reward_id: chosen.id, type: chosen.type,
          category: chosen.category, rarity: chosen.rarity, source: "chest",
        })
        .select("id")
        .maybeSingle();
      // UNIQUE(user_id, reward_id) raced with another settle — the item is
      // owned after all; fall back to the duplicate-conversion path so value
      // still moves once and only once.
      if (insertErr?.code === "23505") {
        wasDuplicate = true;
        convertedCredits = convMap[chosen.rarity] ?? 1;
        creditsAwarded = convertedCredits;
        // The claim row was written with the pre-race values; keep it honest.
        if (takenClaimId) {
          await supabase.from("chest_claims")
            .update({ was_duplicate: true, converted_credits: convertedCredits })
            .eq("id", takenClaimId);
        }
      } else if (insertErr != null) {
        return json({ error: `Reward grant failed: ${insertErr.message}` }, 500);
      }
      void owned; // ownership result is visible to future queries; nothing to carry
    }

    if (creditsAwarded > 0) {
      await supabase.rpc("credits_grant", {
        p_user: userId,
        p_amount: creditsAwarded,
        p_reason: wasDuplicate ? `Chest duplicate converted: ${chosen.id}` : `Chest reward: ${chosen.id}`,
        p_source: "chest",
        p_idempotency_key: `chest:${userId}:${cycleNumber}:${chosen.id}`,
        p_metadata: { reward_id: chosen.id, rarity: chosen.rarity, duplicate: wasDuplicate },
      });
    }

    return json({
      ok: true,
      cycleNumber,
      reward: {
        id: chosen.id,
        name: chosen.name,
        description: chosen.description,
        type: chosen.type,
        category: chosen.category,
        rarity: chosen.rarity,
        icon: chosen.icon,
        payload: chosen.payload,
      },
      duplicate: wasDuplicate,
      convertedCredits,
      creditsAwarded,
    });
  } catch (e) {
    console.error("open-chest error", e);
    // A claim taken before a failure would wedge the cycle (every retry 409s
    // behind it), so hand it back — the deterministic roll converges on retry.
    if (supabase && takenClaimId) {
      try {
        await supabase.from("chest_claims").delete().eq("id", takenClaimId);
      } catch (delErr) {
        console.error("open-chest claim rollback failed", delErr);
      }
    }
    return json({ error: e instanceof Error ? e.message : "Unexpected error" }, 500);
  }
});
