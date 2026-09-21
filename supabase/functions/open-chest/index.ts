// Big Reward Chest - server-side reward generation
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace("Bearer ", "");
    if (!jwt) return json({ error: "Not authenticated" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
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

    // 2) Prevent double open
    const { data: existing } = await supabase
      .from("chest_claims")
      .select("id")
      .eq("user_id", userId)
      .eq("cycle_number", cycleNumber)
      .maybeSingle();
    if (existing) return json({ error: "Chest already opened for this cycle.", cycleNumber }, 409);

    // 3) Load config + eligible rewards
    const { data: cfg } = await supabase.from("reward_config").select("*").eq("id", 1).maybeSingle();
    const probs: Record<string, number> = cfg?.probabilities ?? { common: 55, rare: 28, epic: 12, legendary: 4, mythic: 1 };
    const convMap: Record<string, number> = cfg?.duplicate_conversion ?? { common: 1, rare: 2, epic: 4, legendary: 8, mythic: 15 };

    const now = new Date().toISOString();
    const { data: pool } = await supabase
      .from("reward_definitions")
      .select("*")
      .eq("active", true);
    const eligible = (pool ?? []).filter((r: any) =>
      (!r.available_from || r.available_from <= now) &&
      (!r.available_to || r.available_to >= now)
    );
    if (eligible.length === 0) return json({ error: "No rewards available." }, 500);

    // 4) Weighted rarity roll
    const rarity = rollRarity(probs);
    let candidates = eligible.filter((r: any) => r.rarity === rarity);
    if (candidates.length === 0) candidates = eligible; // fallback

    // 5) Random reward, apply weight_override if any
    const totalW = candidates.reduce((s: number, r: any) => s + (r.weight_override ?? 1), 0);
    let pick = Math.random() * totalW;
    let chosen = candidates[candidates.length - 1];
    for (const r of candidates) {
      pick -= (r.weight_override ?? 1);
      if (pick <= 0) { chosen = r; break; }
    }

    // 6) Duplicate check (permanent items only, not credits/consumables)
    const isPermanent = !["credits", "consumable"].includes(chosen.type);
    let wasDuplicate = false;
    let convertedCredits = 0;
    let creditsAwarded = 0;

    if (chosen.type === "credits") {
      creditsAwarded = Number(chosen.payload?.amount ?? 0);
    } else if (chosen.type === "consumable") {
      // Increment consumable qty
      const { data: existingConsumable } = await supabase
        .from("user_consumables").select("quantity")
        .eq("user_id", userId).eq("reward_id", chosen.id).maybeSingle();
      const newQty = (existingConsumable?.quantity ?? 0) + 1;
      await supabase.from("user_consumables").upsert({
        user_id: userId, reward_id: chosen.id, quantity: newQty, updated_at: now,
      });
    } else if (isPermanent) {
      const { data: owned } = await supabase
        .from("user_rewards").select("id")
        .eq("user_id", userId).eq("reward_id", chosen.id).maybeSingle();
      if (owned) {
        wasDuplicate = true;
        convertedCredits = convMap[chosen.rarity] ?? 1;
        creditsAwarded = convertedCredits;
      } else {
        await supabase.from("user_rewards").insert({
          user_id: userId, reward_id: chosen.id, type: chosen.type,
          category: chosen.category, rarity: chosen.rarity, source: "chest",
        });
      }
    }

    // 7) Add credits to profile balance (if any)
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

    // 8) Record claim
    await supabase.from("chest_claims").insert({
      user_id: userId,
      cycle_number: cycleNumber,
      reward_id: chosen.id,
      reward_type: chosen.type,
      rarity: chosen.rarity,
      was_duplicate: wasDuplicate,
      converted_credits: convertedCredits,
    });

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
  } catch (e: any) {
    console.error("open-chest error", e);
    return json({ error: e?.message ?? "Unexpected error" }, 500);
  }
});

function rollRarity(probs: Record<string, number>): string {
  const entries = Object.entries(probs);
  const total = entries.reduce((s, [, w]) => s + Number(w), 0);
  let r = Math.random() * total;
  for (const [k, w] of entries) {
    r -= Number(w);
    if (r <= 0) return k;
  }
  return "common";
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
