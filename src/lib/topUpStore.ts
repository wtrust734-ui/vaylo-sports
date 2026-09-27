// ============================================================================
// GLOBAL TOP-UP STORE — one sheet, reachable from anywhere
// ----------------------------------------------------------------------------
// The missing half of the "sell the gap" loop: any screen that hits an
// insufficient-credits error can now ask the app for a top-up and *await the
// outcome*, then retry the action the athlete actually wanted. Nothing else in
// the app has to know how the sheet works — a single <TopUpHost /> in the app
// shell renders it.
//
// Plain pub/sub, no React — the same shape as a tiny zustand store, so both
// React components and plain lib code can drive it, and the promise-based API
// keeps call sites linear:
//
//   const res = await requestCreditTopUp({ shortfall: 20, reasonLabel: "AI plan" });
//   if (res.purchased) return retryTheThing();
//
// Unit tested in src/lib/topUpStore.test.ts.
// ============================================================================

import { planCreditTopUp, type CreditTopUpPlan } from "@/lib/creditTopUp";

export type TopUpRequest = {
  /** Credits still needed (cost minus balance). */
  shortfall: number;
  /** What the athlete was trying to do, shown in the sheet copy. */
  reasonLabel?: string;
  /** Credits they currently have (for copy; the planner mainly needs the gap). */
  balance?: number;
};

export type TopUpOutcome = {
  /** True when a purchase completed and the balance was refreshed. */
  purchased: boolean;
  /** True when the athlete dismissed the sheet without buying. */
  dismissed: boolean;
  /** The plan that was shown, so callers can log which pack converted. */
  plan: CreditTopUpPlan | null;
};

type Listener = () => void;

export type TopUpStoreState = {
  open: boolean;
  request: TopUpRequest | null;
};

let state: TopUpStoreState = { open: false, request: null };
const listeners = new Set<Listener>();
let resolveOutcome: ((outcome: TopUpOutcome) => void) | null = null;

function emit() {
  for (const l of [...listeners]) l();
}

export function subscribeTopUp(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getTopUpState(): TopUpStoreState {
  return state;
}

/**
 * Opens the global credit top-up sheet and resolves when it closes.
 * Never throws: a dismiss is a normal outcome, not an error.
 */
export function requestCreditTopUp(request: TopUpRequest): Promise<TopUpOutcome> {
  // A sheet is already up — fold the new request into it (the larger shortfall
  // wins) and resolve the previous waiter as "not purchased" so no caller hangs.
  if (state.open && resolveOutcome) {
    const merged: TopUpRequest = {
      ...request,
      shortfall: Math.max(request.shortfall, state.request?.shortfall ?? 0),
    };
    const prev = resolveOutcome;
    resolveOutcome = null;
    prev({ purchased: false, dismissed: false, plan: null });
    state = { open: true, request: merged };
    emit();
    return new Promise<TopUpOutcome>((resolve) => {
      resolveOutcome = resolve;
    });
  }

  state = { open: true, request };
  emit();
  return new Promise<TopUpOutcome>((resolve) => {
    resolveOutcome = resolve;
  });
}

/** Called by the sheet host when a purchase succeeded and state refreshed. */
export function completeTopUp(plan: CreditTopUpPlan | null = null): void {
  const resolve = resolveOutcome;
  resolveOutcome = null;
  state = { open: false, request: null };
  emit();
  resolve?.({ purchased: true, dismissed: false, plan });
}

/** Called by the sheet host when the athlete closes it without buying. */
export function dismissTopUp(plan: CreditTopUpPlan | null = null): void {
  const resolve = resolveOutcome;
  resolveOutcome = null;
  state = { open: false, request: null };
  emit();
  resolve?.({ purchased: false, dismissed: true, plan });
}

/** Test/reset helper. */
export function resetTopUpStore(): void {
  resolveOutcome = null;
  state = { open: false, request: null };
  listeners.clear();
}

/** Convenience for UI copy: plan for the current request. */
export function planForRequest(request: TopUpRequest | null): CreditTopUpPlan | null {
  if (!request || request.shortfall <= 0) return null;
  return planCreditTopUp(request.shortfall);
}
