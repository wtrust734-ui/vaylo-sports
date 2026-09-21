import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./AuthContext";
import {
  BillingPeriod,
  PlanKey,
  SubscriptionStatus,
  getPlan,
  PLAN_LABEL,
} from "@/config/subscriptionPlans";

// ============================================================================
// PHASE 2 — NEW SUBSCRIPTION / ENTITLEMENT LOGIC
// ----------------------------------------------------------------------------
// There are exactly two entitlement types:
//   • monthly_credit_allowance (number)  — Credit Plan
//   • unlimited_credits (boolean)        — Unlimited Plan
// No Pro / Elite / Minimum / Premium checks remain. Legacy rows are mapped in
// the database onto these two entitlements, so old subscribers keep access.
// ============================================================================

export interface Entitlements {
  plan_key: PlanKey;
  plan_label: string;
  status: SubscriptionStatus;
  billing_period: BillingPeriod | null;
  product_id: string | null;
  credits: number;
  unlimited_credits: boolean;
  monthly_credit_allowance: number;
  credit_rollover_limit: number;
  is_lifetime: boolean;
  cancel_at_period_end: boolean;
  /** Subscription renewal date (null for lifetime / free). */
  renews_at: string | null;
  expires_at: string | null;
  /** When the next monthly credit allowance lands (Credit Plan only). */
  next_refill_at: string | null;
}

const FREE: Entitlements = {
  plan_key: "free",
  plan_label: PLAN_LABEL.free,
  status: "free",
  billing_period: null,
  product_id: null,
  credits: 0,
  unlimited_credits: false,
  monthly_credit_allowance: 0,
  credit_rollover_limit: 0,
  is_lifetime: false,
  cancel_at_period_end: false,
  renews_at: null,
  expires_at: null,
  next_refill_at: null,
};

interface SubscriptionContextType {
  entitlements: Entitlements;
  loading: boolean;
  /** True while the plan is usable (active, trialing, or lifetime). */
  isActive: boolean;
  hasUnlimitedCredits: boolean;
  monthlyCreditAllowance: number;
  isLifetime: boolean;
  /** One-off feature unlocks bought with credits (unchanged by Phase 2). */
  hasFeature: (feature: string) => boolean;
  requireFeature: (feature: string, featureName?: string) => boolean;
  /** Claims the monthly credit allowance if it is due. */
  claimRefill: () => Promise<void>;
  cancel: () => Promise<void>;
  refresh: () => Promise<void>;
}

const SubscriptionContext = createContext<SubscriptionContextType>({
  entitlements: FREE,
  loading: true,
  isActive: false,
  hasUnlimitedCredits: false,
  monthlyCreditAllowance: 0,
  isLifetime: false,
  hasFeature: () => false,
  requireFeature: () => false,
  claimRefill: async () => {},
  cancel: async () => {},
  refresh: async () => {},
});

export const useSubscription = () => useContext(SubscriptionContext);

export const SubscriptionProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useAuth();
  const [entitlements, setEntitlements] = useState<Entitlements>(FREE);
  const [purchases, setPurchases] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user) {
      setEntitlements(FREE);
      setPurchases([]);
      setLoading(false);
      return;
    }
    try {
      const [entRes, purchRes] = await Promise.all([
        (supabase as any).rpc("get_my_entitlements"),
        supabase.from("user_purchases").select("product_id").eq("user_id", user.id),
      ]);
      const e = (entRes?.data || {}) as Partial<Entitlements>;
      const planKey = (e.plan_key || "free") as PlanKey;
      const plan = getPlan(planKey);
      setEntitlements({
        ...FREE,
        ...e,
        plan_key: planKey,
        plan_label: PLAN_LABEL[planKey] || plan?.name || "Free",
        status: (e.status || "free") as SubscriptionStatus,
        credits: Number(e.credits ?? 0),
        monthly_credit_allowance: Number(e.monthly_credit_allowance ?? 0),
        credit_rollover_limit: Number(e.credit_rollover_limit ?? 0),
        unlimited_credits: !!e.unlimited_credits,
        is_lifetime: !!e.is_lifetime,
      });
      setPurchases((purchRes.data || []).map((p: any) => p.product_id));
    } catch {
      /* keep previous state */
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const isActive =
    entitlements.is_lifetime ||
    entitlements.status === "active" ||
    entitlements.status === "trial";

  // Auto-apply the monthly credit refill when it becomes due.
  useEffect(() => {
    if (!user || !isActive || entitlements.monthly_credit_allowance <= 0) return;
    const due =
      !entitlements.next_refill_at || new Date(entitlements.next_refill_at) <= new Date();
    if (!due) return;
    (async () => {
      try {
        await (supabase as any).rpc("apply_credit_refill", { p_user: user.id });
        refresh();
      } catch {
        /* ignore */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, isActive, entitlements.monthly_credit_allowance, entitlements.next_refill_at]);

  const claimRefill = useCallback(async () => {
    if (!user) return;
    const { error } = await (supabase as any).rpc("apply_credit_refill", { p_user: user.id });
    if (error) throw new Error(error.message);
    await refresh();
  }, [user, refresh]);

  const cancel = useCallback(async () => {
    const { error } = await (supabase as any).rpc("cancel_my_subscription");
    if (error) throw new Error(error.message);
    await refresh();
  }, [refresh]);

  const hasFeature = useCallback(
    (feature: string) => {
      // Unlimited entitlement covers every credit-gated feature.
      if (entitlements.unlimited_credits && isActive) return true;
      return purchases.includes(feature);
    },
    [entitlements.unlimited_credits, isActive, purchases],
  );

  const requireFeature = useCallback(
    (feature: string, featureName?: string) => {
      if (hasFeature(feature)) return true;
      import("@/components/PaywallModal").then(({ usePaywall }) =>
        usePaywall.getState().show(featureName || feature),
      );
      return false;
    },
    [hasFeature],
  );

  return (
    <SubscriptionContext.Provider
      value={{
        entitlements,
        loading,
        isActive,
        hasUnlimitedCredits: entitlements.unlimited_credits && isActive,
        monthlyCreditAllowance: isActive ? entitlements.monthly_credit_allowance : 0,
        isLifetime: entitlements.is_lifetime,
        hasFeature,
        requireFeature,
        claimRefill,
        cancel,
        refresh,
      }}
    >
      {children}
    </SubscriptionContext.Provider>
  );
};
