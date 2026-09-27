// One-shot codemod: re-apply reverted typing fixes (remove `as any` where the
// generated Supabase types already cover the query). Run: node scripts/reapply-typefixes.cjs
const fs = require("fs");

const edits = {
  "src/pages/AdminPricing.tsx": [
    ['.from("user_roles" as any)', '.from("user_roles")'],
    ['supabase.from("pricing_tiers" as any).select("*").order("sort_order"),', 'supabase.from("pricing_tiers").select("*").order("sort_order"),'],
    ['supabase.from("country_pricing_map" as any).select("*").order("country_name"),', 'supabase.from("country_pricing_map").select("*").order("country_name"),'],
    ['setTiers((t as any) || []);', 'setTiers(t || []);'],
    ['setCountries((c as any) || []);', 'setCountries(c || []);'],
    ['.from("purchase_analytics" as any)', '.from("purchase_analytics")'],
    ['const rows = (purchases as any[]) || [];', 'const rows = purchases || [];'],
    ['const { data: segs } = await supabase.from("user_segments" as any).select("segment");', 'const { data: segs } = await supabase.from("user_segments").select("segment");'],
    ['((segs as any[]) || []).forEach((s) => { segCount[s.segment] = (segCount[s.segment] || 0) + 1; });', '(segs || []).forEach((s) => { segCount[s.segment] = (segCount[s.segment] || 0) + 1; });'],
    ['const { error } = await supabase.from("pricing_tiers" as any).update({', 'const { error } = await supabase.from("pricing_tiers").update({'],
    ['const { error } = await supabase.from("country_pricing_map" as any).update({ tier_code: newTier }).eq("country_code", code);', 'const { error } = await supabase.from("country_pricing_map").update({ tier_code: newTier }).eq("country_code", code);'],
    ['const { error, data } = await supabase.from("country_pricing_map" as any)', 'const { error, data } = await supabase.from("country_pricing_map")'],
    ['setCountries((p) => [...p, data as any].sort((a, b) => a.country_name.localeCompare(b.country_name)));', 'setCountries((p) => [...p, data].sort((a, b) => a.country_name.localeCompare(b.country_name)));'],
    ['const { error } = await supabase.from("country_pricing_map" as any).delete().eq("country_code", code);', 'const { error } = await supabase.from("country_pricing_map").delete().eq("country_code", code);'],
  ],
  "src/lib/credits.ts": [
    ['.from("economy_config" as any)', '.from("economy_config")'],
    ['const value = (data as any)?.value;\n      if (value && typeof value === "object") remoteCosts = value;', 'const value = data?.value;\n      if (value && typeof value === "object" && !Array.isArray(value)) {\n        remoteCosts = value as Partial<Record<FeatureCostKey, number>>;\n      }'],
    ['await supabase.rpc("credits_spend" as any, {', 'await supabase.rpc("credits_spend", {'],
    ['p_metadata: (opts.metadata ?? {}) as any,', 'p_metadata: (opts.metadata ?? {}) as Record<string, unknown>,'],
    ['const r = (data ?? {}) as any;\n  return {\n    success: !!r.success,\n    duplicate: !!r.duplicate,\n    cost: Number(r.cost ?? 0),\n    balance: Number(r.balance ?? 0),\n    unlimited: !!r.unlimited,\n    error: r.error,\n    shortfall: r.shortfall != null ? Number(r.shortfall) : undefined,\n  };', 'const r = (data ?? {}) as SpendRpcResult;\n  return {\n    success: !!r.success,\n    duplicate: !!r.duplicate,\n    cost: Number(r.cost ?? 0),\n    balance: Number(r.balance ?? 0),\n    unlimited: !!r.unlimited,\n    error: r.error,\n    shortfall: r.shortfall != null ? Number(r.shortfall) : undefined,\n  };'],
    ['await supabase.rpc("credits_claim_reward" as any, {', 'await supabase.rpc("credits_claim_reward", {'],
    ['const r = (data ?? {}) as any;\n  return {\n    success: !!r.success,\n    granted: Number(r.granted ?? 0),\n    balance: Number(r.balance ?? 0),\n    duplicate: !!r.duplicate,\n  };', 'const r = (data ?? {}) as ClaimRewardRpcResult;\n  return {\n    success: !!r.success,\n    granted: Number(r.granted ?? 0),\n    balance: Number(r.balance ?? 0),\n    duplicate: !!r.duplicate,\n  };'],
    ['.from("credit_transactions" as any)', '.from("credit_transactions")'],
    ['return (data ?? []) as any as CreditTransaction[];', 'return data ?? [];'],
    ['let remoteCosts: Partial<Record<FeatureCostKey, number>> | null = null;', 'let remoteCosts: Partial<Record<FeatureCostKey, number>> | null = null;'],
  ],
  "src/lib/scoring.ts": [
    ['const client = supabase as any;\n  let q = client.from("points_events")', 'let q = supabase.from("points_events")'],
    ['(data || []).forEach((r: any) => {', '(data || []).forEach((r) => {'],
    ['const client = supabase as any;\n  const res = await client.rpc("award_points", { p_points: points, p_source: source, p_sport: sport ?? null });\n  if (res?.error) console.error("awardPoints failed:", res.error.message);', 'const res = await supabase.rpc("award_points", { p_points: points, p_source: source, p_sport: sport ?? null });\n  if (res.error) console.error("awardPoints failed:", res.error.message);'],
    ['const res = await (supabase as any).rpc("join_challenge", { p_challenge: id });\n  if (res?.error) console.error("joinChallenge failed:", res.error.message);', 'const res = await supabase.rpc("join_challenge", { p_challenge: id });\n  if (res.error) console.error("joinChallenge failed:", res.error.message);'],
    ['const res = await (supabase as any).rpc("leave_challenge", { p_challenge: id });\n  if (res?.error) console.error("leaveChallenge failed:", res.error.message);', 'const res = await supabase.rpc("leave_challenge", { p_challenge: id });\n  if (res.error) console.error("leaveChallenge failed:", res.error.message);'],
    ['const res = await (supabase as any).rpc("update_challenge_progress", { p_challenge: id, p_delta: delta });\n  if (res?.error) console.error("updateChallengeProgress failed:", res.error.message);', 'const res = await supabase.rpc("update_challenge_progress", { p_challenge: id, p_delta: delta });\n  if (res.error) console.error("updateChallengeProgress failed:", res.error.message);'],
    ['const client = supabase as any;\n  const { data: existing } = await client.from("achievements")', 'const { data: existing } = await supabase.from("achievements")'],
    ['const owned = new Set((existing || []).map((e: any) => e.title));', 'const owned = new Set((existing || []).map((e) => e.title));'],
    ['const { data: pts } = await client.from("points_events").select("points").eq("user_id", userId);\n  const total = (pts || []).reduce((s: number, r: any) => s + (r.points || 0), 0);', 'const { data: pts } = await supabase.from("points_events").select("points").eq("user_id", userId);\n  const total = (pts || []).reduce((s, r) => s + (r.points || 0), 0);'],
    ['const { error } = await client.from("achievements").insert(', 'const { error } = await supabase.from("achievements").insert('],
  ],
  "src/lib/creditEconomy.ts": [
    ['.from("country_pricing_map" as any)', '.from("country_pricing_map")'],
    ['? { country, currency: (map as any).currency, tier_code: (map as any).tier_code }', '? { country, currency: map.currency, tier_code: map.tier_code }'],
    ['supabase.from("pricing_tiers" as any).select("*").eq("code", region.tier_code).eq("active", true).maybeSingle(),', 'supabase.from("pricing_tiers").select("*").eq("code", region.tier_code).eq("active", true).maybeSingle(),'],
    ['supabase.from("economy_config" as any).select("*").in("region", [region.country, "GLOBAL"]).eq("active", true),', 'supabase.from("economy_config").select("*").in("region", [region.country, "GLOBAL"]).eq("active", true),'],
    ['supabase.from("special_offers" as any).select("*").eq("active", true).in("region", [region.country, "GLOBAL"]),', 'supabase.from("special_offers").select("*").eq("active", true).in("region", [region.country, "GLOBAL"]),'],
    ['for (const row of (cfgRows || []) as any[]) {', 'for (const row of cfgRows || []) {'],
    ['const tierPacks = (tierRow as any)?.packs as CreditPack[] | undefined;', 'const tierPacks = tierRow?.packs as CreditPack[] | undefined;'],
    ['const tierInfinite = (tierRow as any)?.infinite as InfinitePack[] | undefined;', 'const tierInfinite = tierRow?.infinite as InfinitePack[] | undefined;'],
    ['await supabase.from("purchase_analytics" as any).insert({', 'await supabase.from("purchase_analytics").insert({'],
  ],
};

// Inject RPC result type declarations into credits.ts
const CREDITS_TYPES = `
// --- RPC result shapes ----------------------------------------------------
// The credits routines return \`Json\`; these shapes describe the contract with
// the database functions (see supabase/migrations for the authoritative SQL).
type SpendRpcResult = {
  success?: boolean;
  duplicate?: boolean;
  cost?: number;
  balance?: number;
  unlimited?: boolean;
  error?: string;
  shortfall?: number;
};

type ClaimRewardRpcResult = {
  success?: boolean;
  granted?: number;
  balance?: number;
  duplicate?: boolean;
};
`;

let totalApplied = 0, totalMiss = 0;
for (const [path, pairs] of Object.entries(edits)) {
  let src = fs.readFileSync(path, "utf8");
  let applied = 0, missed = 0;
  for (const [old, nw] of pairs) {
    if (old === nw) continue; // marker entry, skip
    if (src.includes(old)) { src = src.replace(old, nw); applied++; }
    else { missed++; console.log(`  MISS ${path}: ${JSON.stringify(old.slice(0, 60))}`); }
  }
  if (path === "src/lib/credits.ts" && !src.includes("type SpendRpcResult")) {
    const anchor = "// --- Remote cost cache";
    if (src.includes(anchor)) {
      src = src.replace(anchor, CREDITS_TYPES + "\n" + anchor);
      console.log("  injected RPC result types into credits.ts");
    } else {
      console.log("  WARN: credits.ts anchor not found for type injection");
    }
  }
  fs.writeFileSync(path, src, "utf8");
  totalApplied += applied; totalMiss += missed;
  console.log(`${path}: ${applied} applied, ${missed} missed`);
}
console.log(`\nTotal: ${totalApplied} applied, ${totalMiss} missed`);
