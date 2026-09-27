// ============================================================================
// VAYLO SPORTS — LAUNCH FEATURE FLAGS
// ----------------------------------------------------------------------------
// One place decides which features are visible at launch. Flags default to the
// launch decision; flipping one boolean here enables the whole surface — no
// scavenger hunt through routes and nav files.
//
//   coachMarketplace — human coaching + creator marketplace (Market "Coaching"
//   section, /marketplace, /market/become-creator). OFF for launch: the
//   surface works end-to-end but ships with zero seeded coaches, and an empty
//   marketplace reads as "nobody uses this". Flip on when the coach roster is
//   seeded and you're ready to sell it.
// ============================================================================

export const FEATURE_FLAGS = {
  coachMarketplace: false,
} as const satisfies Record<string, boolean>;

export type FeatureFlagKey = keyof typeof FEATURE_FLAGS;

export const isFlagOn = (key: FeatureFlagKey): boolean => FEATURE_FLAGS[key];
