// ============================================================================
// VAYLO SPORTS — LAUNCH FEATURE FLAGS
// ----------------------------------------------------------------------------
// One place decides which features are visible at launch. Flags default to the
// launch decision; flipping one boolean here enables the whole surface — no
// scavenger hunt through routes and nav files.
//
// The defaults are the decision, and they are in git so a reviewer can see what
// ships. A `VITE_ENABLE_<flag>` environment variable overrides a default at
// build time, which exists for the case where you want one build to differ from
// another — a Play closed-test bundle that hides a feature the web build keeps,
// for instance — without editing code to get it.
//
//   coachMarketplace — human coaching + creator marketplace (Market "Coaching"
//   section, /marketplace, /market/become-creator). OFF for launch: the
//   surface works end-to-end but ships with zero seeded coaches, and an empty
//   marketplace reads as "nobody uses this". Flip on when the coach roster is
//   seeded and you're ready to sell it.
//
//   wearableSync — /health-sync and every entry point to it. OFF because the
//   vendor OAuth apps do not exist yet: Garmin, Strava and the rest each need a
//   developer agreement signed by a human before a client id can be issued.
//   The callback is wired but has never exchanged a code for a token, so this
//   is an unfinished integration rather than a misconfiguration, and no amount
//   of configuration will turn it into a working one. A Play reviewer who taps
//   "Wearables" and lands on a screen of dead providers is a worse first
//   impression than a product with one fewer headline feature.
//
//   gpsTracking — the live-distance buttons in Workouts and Routines. OFF by
//   default. The Android manifest declares no location permission, so
//   `navigator.geolocation` never resolves and the button is inert. Declaring
//   ACCESS_FINE_LOCATION would also mean declaring location in the Data safety
//   form and handling it in the privacy policy, which is a larger commitment
//   than the feature deserves during closed testing. On the web this works, so
//   set VITE_ENABLE_gpsTracking=true for a self-hosted web build.
//
//   There is deliberately no `aiCoach` flag. AI is not a separate section of the
//   app — it is inside the core pages (Training generates the plan, FormAnalysis,
//   Nutrition and Tactics analyse, Goals writes the weekly review, Coach chats).
//   Switching it off would not hide a feature, it would gut the product, and a
//   reviewer would be looking at a shell. The honest state is already shown to
//   the athlete ("not switched on yet"), and the real fix is one environment
//   variable on the server: `supabase secrets set OPENAI_API_KEY=…`. If you are
//   choosing between adding that key and adding a flag, add the key.
// ============================================================================

type FlagKey = string

/**
 * Read a `VITE_ENABLE_<key>` override, falling back to the launch default.
 *
 * Only the literal string "true" turns a flag on. Anything else — unset, "0",
 * "false", a typo — leaves the default alone, so a mistyped variable in CI
 * produces the documented behaviour rather than an accidental feature.
 */
const envOverride = (key: FlagKey, fallback: boolean): boolean => {
  const raw = (import.meta.env as Record<string, string | undefined>)[
    `VITE_ENABLE_${key}`
  ];
  if (raw === undefined || raw === "") return fallback;
  return raw.trim().toLowerCase() === "true";
};

export const FEATURE_FLAGS = {
  coachMarketplace: envOverride("coachMarketplace", false),
  wearableSync: envOverride("wearableSync", false),
  gpsTracking: envOverride("gpsTracking", false),
} as const satisfies Record<FlagKey, boolean>;

export type FeatureFlagKey = keyof typeof FEATURE_FLAGS;

export const isFlagOn = (key: FeatureFlagKey): boolean => FEATURE_FLAGS[key];

/**
 * Routes that only exist to host a flagged feature, mapped to the flag that
 * governs them.
 *
 * This exists so the flag is consulted in one place. Wearables reach the athlete
 * from four different surfaces — the sidebar, the Recover hub, the
 * personalisation catalog, and the route itself — and four separate
 * `isFlagOn` conditionals would be four chances to ship a build that shows a
 * menu entry pointing at a redirected page. Filtering by path means a new entry
 * point is covered by construction, as long as it routes here.
 */
export const FLAGGED_ROUTES: Record<string, FeatureFlagKey> = {
  "/health-sync": "wearableSync",
};

export const isRouteVisible = (path: string): boolean => {
  const key = FLAGGED_ROUTES[path];
  return key === undefined ? true : isFlagOn(key);
};
