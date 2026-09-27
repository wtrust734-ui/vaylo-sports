// ============================================================================
// CREDIT SHORTFALL TOP-UP PLANNER
// ----------------------------------------------------------------------------
// When an athlete cannot afford a credit-priced feature we do not just say
// "not enough credits" — the moment of intent is the best moment to sell.
// From the configured ladder this computes:
//
//   * the cheapest credit pack that covers the gap,
//   * a value upgrade worth mentioning (more credits per dollar),
//   * and every covering option, cheapest first.
//
// Mirror of src/lib/topUp.ts (coins). Pure functions, no React: unit tested in
// src/lib/creditTopUp.test.ts. Prices always re-verified server-side by
// process-purchase; this only chooses what to offer.
// ============================================================================

import { CREDIT_PACKS, type CreditPackConfig } from "@/config/credits";

export interface CreditPackOffer {
  id: string;
  credits: number;
  bonus: number;
  total: number;
  price_cents: number;
  label: string;
  /** Extra credits left over after paying the gap. */
  leftover: number;
  cents_per_credit: number;
}

export interface CreditTopUpPlan {
  /** The credit gap the athlete has to close. */
  gap: number;
  /** Cheapest pack that closes it (null when nothing does). */
  cheapest: CreditPackOffer | null;
  /**
   * A pack worth offering instead of `cheapest` — strictly better credits per
   * dollar *and* not absurdly more expensive. Null when `cheapest` is already
   * the best value.
   */
  upgrade: CreditPackOffer | null;
  /** Every covering pack, cheapest first. */
  options: CreditPackOffer[];
}

const toOffer = (p: CreditPackConfig, gap: number): CreditPackOffer => {
  const total = p.credits + (p.bonus || 0);
  return {
    id: p.id,
    credits: p.credits,
    bonus: p.bonus || 0,
    total,
    price_cents: p.price_cents,
    label: p.label ?? p.id,
    leftover: Math.max(0, total - gap),
    cents_per_credit: p.price_cents / total,
  };
};

/** Plan a credit top-up for `gap` credits. */
export function planCreditTopUp(gap: number, packs: CreditPackConfig[] = CREDIT_PACKS): CreditTopUpPlan {
  const wanted = Math.max(0, Math.ceil(gap));

  // No shortfall — nothing to sell and nothing to offer.
  if (wanted === 0) return { gap: 0, cheapest: null, upgrade: null, options: [] };

  const covering = packs
    .map((p) => toOffer(p, wanted))
    .filter((o) => o.total >= wanted)
    // Cheapest first; on a price tie prefer the better credits-per-dollar.
    .sort((a, b) => a.price_cents - b.price_cents || a.cents_per_credit - b.cents_per_credit);

  const cheapest = covering[0] ?? null;

  // The upgrade nudge must be a real improvement, not a nudge for its own sake:
  // at least 15% better value for at most 3x the money.
  const upgrade =
    cheapest === null
      ? null
      : covering.find(
          (o) =>
            o.id !== cheapest.id &&
            o.cents_per_credit < cheapest.cents_per_credit * 0.85 &&
            o.price_cents <= cheapest.price_cents * 3
        ) ?? null;

  return { gap: wanted, cheapest, upgrade, options: covering };
}

/** The cheapest list price across the ladder — the floor a discount must respect. */
export function bestPackPricePerCredit(packs: CreditPackConfig[] = CREDIT_PACKS): number {
  const per = packs
    .map((p) => p.price_cents / Math.max(1, p.credits + (p.bonus || 0)))
    .sort((a, b) => a - b);
  return per[0] ?? 0;
}
