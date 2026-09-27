// ============================================================================
// VAYLO SPORTS — shared credit spend/grant client
// ----------------------------------------------------------------------------
// EVERY credit deduction in the app goes through `spendCredits()`, which calls
// the database routine `credits_spend()`. That routine is the single place that
// checks the balance, honours Unlimited subscriptions, deducts, records the
// transaction (feature, source, reason, remaining balance) and returns the
// result. Feature costs come from the central config / economy_config table.
// ============================================================================

import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import {
  FEATURE_COSTS,
  FEATURE_LABELS,
  PROMO_BONUSES,
  type FeatureCostKey,
  type PromoBonusKey,
  type CreditSource,
} from "@/config/credits";

export type { FeatureCostKey } from "@/config/credits";


// --- RPC result shapes ----------------------------------------------------
// The credits routines return `Json`; these shapes describe the contract with
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

// --- Remote cost cache (economy_config overrides the local defaults) -------
let remoteCosts: Partial<Record<FeatureCostKey, number>> | null = null;
let remoteLoaded: Promise<void> | null = null;

export async function loadFeatureCosts(): Promise<Record<FeatureCostKey, number>> {
  if (!remoteLoaded) {
    remoteLoaded = (async () => {
      const { data } = await supabase
        .from("economy_config")
        .select("value")
        .eq("key", "feature_costs")
        .eq("region", "GLOBAL")
        .eq("active", true)
        .maybeSingle();
      const value = data?.value;
      if (value && typeof value === "object" && !Array.isArray(value)) {
        remoteCosts = value as Partial<Record<FeatureCostKey, number>>;
      }
    })().catch(() => { /* fall back to local defaults */ });
  }
  await remoteLoaded;
  return { ...FEATURE_COSTS, ...(remoteCosts ?? {}) };
}

/** Synchronous cost lookup — uses the cached remote value when available. */
export function creditCost(feature: FeatureCostKey, quantity = 1): number {
  const unit = remoteCosts?.[feature] ?? FEATURE_COSTS[feature];
  return unit * Math.max(1, quantity);
}

export function featureLabel(feature: FeatureCostKey): string {
  return FEATURE_LABELS[feature] ?? feature;
}

export function promoBonus(kind: PromoBonusKey): number {
  return PROMO_BONUSES[kind];
}

// --- Spend ----------------------------------------------------------------
export type SpendResult = {
  success: boolean;
  duplicate: boolean;
  cost: number;
  balance: number;
  unlimited: boolean;
  error?: "insufficient_credits" | string;
  shortfall?: number;
};

export type SpendOptions = {
  /** Number of units (e.g. weeks of a training plan). Default 1. */
  quantity?: number;
  /** Human-readable reason stored on the transaction. */
  reason?: string;
  /** Where the spend originated. Default "app". */
  source?: CreditSource;
  /** Unique key that makes the spend safe to retry (double-spend guard). */
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
};

/**
 * The one and only credit deduction path.
 * Never deducts credits client-side and never trusts a client-supplied cost.
 */
export async function spendCredits(
  feature: FeatureCostKey,
  opts: SpendOptions = {},
): Promise<SpendResult> {
  const quantity = Math.max(1, opts.quantity ?? 1);
  const { data, error } = await supabase.rpc("credits_spend", {
    p_feature: feature,
    p_reason: opts.reason ?? featureLabel(feature),
    p_quantity: quantity,
    p_source: opts.source ?? "app",
    p_idempotency_key: opts.idempotencyKey ?? null,
    p_metadata: (opts.metadata ?? {}) as unknown as Json,
  });

  if (error) {
    return {
      success: false, duplicate: false, unlimited: false,
      cost: creditCost(feature, quantity), balance: 0, error: error.message,
    };
  }

  const r = (data ?? {}) as SpendRpcResult;
  return {
    success: !!r.success,
    duplicate: !!r.duplicate,
    cost: Number(r.cost ?? 0),
    balance: Number(r.balance ?? 0),
    unlimited: !!r.unlimited,
    error: r.error,
    shortfall: r.shortfall != null ? Number(r.shortfall) : undefined,
  };
}

/** Friendly message for a failed spend. */
export function spendErrorMessage(feature: FeatureCostKey, res: SpendResult, quantity = 1): string {
  if (res.error === "insufficient_credits") {
    return `You need ${res.cost || creditCost(feature, quantity)} credits for ${featureLabel(feature)} — ${res.shortfall ?? 0} short.`;
  }
  return res.error || "Credit transaction failed. Please try again.";
}

// --- Grants / refills -----------------------------------------------------
/**
 * Claims a configured reward (arcade record, referral, promo). Amount comes
 * from `economy_config.promo_bonuses` server-side — never from the client.
 */
export async function claimCreditReward(
  kind: PromoBonusKey,
  opts: { reason?: string; idempotencyKey?: string } = {},
): Promise<{ success: boolean; granted: number; balance: number; duplicate: boolean; error?: string }> {
  const { data, error } = await supabase.rpc("credits_claim_reward", {
    p_kind: kind,
    p_reason: opts.reason ?? null,
    p_idempotency_key: opts.idempotencyKey ?? null,
  });
  if (error) return { success: false, granted: 0, balance: 0, duplicate: false, error: error.message };
  const r = (data ?? {}) as ClaimRewardRpcResult;
  return {
    success: !!r.success,
    granted: Number(r.granted ?? 0),
    balance: Number(r.balance ?? 0),
    duplicate: !!r.duplicate,
  };
}

// --- History --------------------------------------------------------------
export type CreditTransaction = {
  id: string;
  amount: number;
  reason: string;
  feature: string | null;
  source: string;
  balance_after: number | null;
  created_at: string;
};

export async function fetchCreditHistory(limit = 50): Promise<CreditTransaction[]> {
  const { data } = await supabase
    .from("credit_transactions")
    .select("id, amount, reason, feature, source, balance_after, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  return data ?? [];
}
