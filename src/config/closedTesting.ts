// ============================================================================
// VAYLO SPORTS — CLOSED-TESTING PURCHASE MODE
// ----------------------------------------------------------------------------
// While the Play Console closed test is running there is no payment provider
// wired yet, so nothing can actually be charged. Rather than show a checkout
// button that refuses every basket ("Purchases aren't available yet"), the
// tester buys credits for free: the basket, the grant and the balance all work
// exactly as they will once billing is live, and only the money step is skipped.
//
// That is deliberate. The thing being tested is the *flow* — add to basket,
// check out, watch the balance move, spend it on a feature. A test build where
// the last step is a dead end tests nothing about the last step.
//
// ---------------------------------------------------------------------------
// THIS MUST BE OFF BEFORE THE APP IS PUBLIC
// ---------------------------------------------------------------------------
// With this on, credits are unlimited for anyone who can reach the server: the
// grant is real, so a tester can buy the biggest pack repeatedly and spend it.
// That is fine inside a closed test and unacceptable the moment the app is
// public, because credits buy AI features that cost real money per call.
//
// Two independent switches have to agree, on purpose:
//
//   1. this flag          — what the CLIENT shows ("Free during closed testing")
//   2. PAYMENT_MODE=free  — the Supabase secret the SERVER honours
//
// The server secret is the authority: with the secret unset, a client with this
// flag on still gets refused, which is the safe direction to fail. With the
// secret set and this flag off, the server would grant for free while the UI
// said "buy" — so the flag is checked here too and `freeCreditsActive()` is the
// single question both sides answer.
//
// To go live: set `freeCredits: false` here, redeploy the web build, and set
// `PAYMENT_MODE=store` with the Play service-account secrets (see CAPACITOR.md
// §3). Do not ship with both on.
// ============================================================================

export type ClosedTestingConfig = {
  /** Credits are granted without payment. See the warning above. */
  freeCredits: boolean;
  /** Shown next to every price so a tester is never misled about being charged. */
  label: string;
  /** One sentence, used in the basket and the receipt. */
  explanation: string;
};

export const CLOSED_TESTING: ClosedTestingConfig = {
  freeCredits: true,
  label: "Free during closed testing",
  explanation:
    "You are in a closed test, so credits are free right now. Nothing is charged and no card is taken. " +
    "Paid credits arrive with Google Play billing after closed testing ends.",
};

/** True when the client should present purchases as free rather than paid. */
export const freeCreditsActive = (): boolean => CLOSED_TESTING.freeCredits;
