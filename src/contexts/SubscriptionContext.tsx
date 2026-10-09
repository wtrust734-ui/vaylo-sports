import { createContext, useContext, useEffect, useState, useRef, ReactNode, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./AuthContext";
import {
  BillingPeriod,
  PlanKey,
  SubscriptionStatus,
  getPlan,
  PLAN_LABEL,
} from "@/config/subscriptionPlans";
import { deriveEntitlementFlags } from "./subscriptionFlags";
import { DEMO_MODE, demoPurchases } from "@/lib/demoMode";

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

const NO_PURCHASES: string[] = [];

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
  error: string | null;
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
  error: null,
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
  const [storedEntitlements, setEntitlements] = useState<Entitlements>(FREE);
  const [storedPurchases, setPurchases] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const [error, setError] = useState<string | null>(null);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const currentUser = useRef(user?.id);
  currentUser.current = user?.id;
  const requestVersion = useRef(0);
  const entitlements = ownerId === user?.id ? storedEntitlements : FREE;
  const purchases = ownerId === user?.id ? storedPurchases : NO_PURCHASES;

  const refresh = useCallback(async () => {
    const request = ++requestVersion.current;
    const userId = user?.id;
    const isCurrent = () => request === requestVersion.current && currentUser.current === userId;
    if (!user) {
      setError(null);
      setEntitlements(FREE);
      setPurchases([]);
      setLoading(false);
      return;
    }
    if (DEMO_MODE) {
      // Clone build (docs/WEB-CLONE.md): no entitlement RPC exists. Features
      // unlocked through the clone's free purchases read back from
      // localStorage; credits stay at zero, which is the clone's documented
      // "credits are non-functional" behaviour.
      setEntitlements(FREE);
      setOwnerId(userId!);
      setPurchases(demoPurchases());
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [entRes, purchRes] = await Promise.all([
        supabase.rpc("get_my_entitlements"),
        supabase.from("user_purchases").select("product_id").eq("user_id", user.id),
      ]);
      if (!isCurrent()) return;
      if (entRes.error) throw new Error(entRes.error.message);
      if (purchRes.error) throw new Error(purchRes.error.message);
      if (!entRes.data || !purchRes.data) throw new Error("Access information is unavailable. Please retry.");
      setOwnerId(userId!);
      setError(null);
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
      setPurchases(((purchRes.data ?? []) as { product_id: string }[]).map((p) => p.product_id));
    } catch (error) {
      if (isCurrent()) setError(error instanceof Error ? error.message : "Couldn't refresh your access. Please retry.");
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    const requests = requestVersion;
    void refresh();
    return () => { requests.current++; };
  }, [refresh]);

  // The active/refill answers come from the shared, tested derivation
  // (subscriptionFlags.ts) so client behavior cannot drift from server truth
  // — get_my_entitlements() zeroes plan data for expired/cancelled rows.
  const { active: isActive, mayAutoRefill } = deriveEntitlementFlags(entitlements);

  // Auto-apply the monthly credit refill when it becomes due. The server
  // (apply_credit_refill) independently re-checks allowance, due date and
  // active status, so a stale client flag cannot create credits.
  useEffect(() => {
    if (!user || !mayAutoRefill) return;
    const due =
      !entitlements.next_refill_at || new Date(entitlements.next_refill_at) <= new Date();
    if (!due) return;
    (async () => {
      try {
        const { error } = await supabase.rpc("apply_credit_refill", { p_user: user.id });
        if (error) throw error;
        if (currentUser.current === user.id) void refresh();
      } catch {
        /* ignore */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, mayAutoRefill, entitlements.next_refill_at]);

  const claimRefill = useCallback(async () => {
    if (!user) return;
    const { error } = await supabase.rpc("apply_credit_refill", { p_user: user.id });
    if (error) throw new Error(error.message);
    await refresh();
  }, [user, refresh]);

  const cancel = useCallback(async () => {
    const { error } = await supabase.rpc("cancel_my_subscription");
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
        error: ownerId === user?.id || !loading ? error : null,
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
