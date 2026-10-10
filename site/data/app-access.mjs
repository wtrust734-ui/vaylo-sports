// ============================================================================
// APP ACCESS — what each screen costs, stated rather than implied
// ----------------------------------------------------------------------------
// Why this file exists.
//
// The first version of the preview labelled a screen "part of the shipped app"
// whenever it could not match a FEATURES group. That is accurate about
// existence and actively misleading about cost: the Injury screen says "Unlock
// predictive risk scoring", costs 29 credits, and its screenshot makes it look
// free. A preview that understates what a product charges is worse than no
// preview, because a reader decides whether to install on it.
//
// So every screen states its access, from the app's own credit config:
//
//   free     no credits are taken
//   unlock   a one-off permanent unlock, charged once and kept
//   metered  charged each time it is used
//
// The costs are PARSED OUT OF src/config/credits.ts rather than copied, so the
// site cannot quote a price the app has stopped charging. credits.ts is
// TypeScript and this generator is plain node, so the parse is a regex over a
// flat object literal — which is safe here only because it is checked:
// appPreview.test.ts asserts the parse found every key in the real object, and
// that every key called a permanent unlock really is one in PERMANENT_UNLOCKS.
// If someone reformats that file so the regex stops matching, the test fails
// loudly instead of the site quietly showing nothing.
// ============================================================================

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const creditsSource = readFileSync(join(ROOT, "src/config/credits.ts"), "utf8");

/** The cost of every credit-gated feature, read from the app's own config. */
export const FEATURE_COSTS = (() => {
  const block = /FEATURE_COSTS: Record<[^>]*>\s*=\s*\{([\s\S]*?)\n\};/.exec(creditsSource);
  if (!block) {
    throw new Error(
      "app-access: could not find FEATURE_COSTS in src/config/credits.ts — " +
        "the object has been reformatted, and the site must not fall back to " +
        "guessing prices."
    );
  }
  const costs = {};
  for (const m of block[1].matchAll(/(\w+):\s*(\d+)/g)) costs[m[1]] = Number(m[2]);
  if (!Object.keys(costs).length) {
    throw new Error("app-access: FEATURE_COSTS parsed to nothing — check the regex.");
  }
  return costs;
})();

/** Every key the app itself calls a permanent one-off unlock. */
export const UNLOCK_KEYS = (() => {
  const block = /PERMANENT_UNLOCKS: FeatureCostKey\[\]\s*=\s*\[([\s\S]*?)\];/.exec(creditsSource);
  if (!block) throw new Error("app-access: could not find PERMANENT_UNLOCKS in credits.ts");
  return [...block[1].matchAll(/"([\w]+)"/g)].map((m) => m[1]);
})();

/** Every key the app itself charges per use. */
export const METERED_KEYS = (() => {
  const block = /AI_USAGE_FEATURES: FeatureCostKey\[\]\s*=\s*\[([\s\S]*?)\];/.exec(creditsSource);
  if (!block) throw new Error("app-access: could not find AI_USAGE_FEATURES in credits.ts");
  return [...block[1].matchAll(/"([\w]+)"/g)].map((m) => m[1]);
})();

/**
 * Per-screen access: the credit key that screen spends, or null for free.
 *
 * A screen is listed when *using it* spends credits. Where a screen mixes free
 * and paid parts — /form has free drills and a paid video analysis, /nutrition
 * has free logging and paid scans/plans — the paid part is what is listed,
 * because that is the part a reader would otherwise discover after installing.
 */
// Form analysis is video-only and per analysis (no unlimited tier), and
// nutrition is a standard tab: opening it is free, the AI calorie scan and the
// weekly plan charge per use. /nutrition names the scan — the AI per-use cost
// a reader would otherwise discover after installing.
export const ACCESS = {
  "/form": "video_form_analysis",
  "/form/video": "video_form_analysis",
  "/injury": "injury_management_unlock",
  "/nutrition": "calorie_scan",
  "/mental": "mental_gym_unlock",
  "/learning": "learning_unlock",
  "/learning/:lessonId": "learning_unlock",
  "/training": "training_plan_week",
  "/coach": "vaylo_coach_message",
  "/goals": "weekly_coach_review",
  "/tactics": "tactical_prep",
  "/recovery": "development_trajectory",
};

/** What a screen costs, in the words used on the page. */
export function accessFor(key) {
  if (!key) {
    return {
      kind: "free",
      badge: "Free",
      sentence: "Using this screen does not spend credits.",
    };
  }
  const cost = FEATURE_COSTS[key];
  if (cost === undefined) {
    throw new Error(
      `app-access: "${key}" is not a key in FEATURE_COSTS. Naming a cost key the ` +
        `app does not have would put a price on the site that the app never charges.`
    );
  }
  if (UNLOCK_KEYS.includes(key)) {
    return {
      kind: "unlock",
      cost,
      badge: `${cost} credits, once`,
      sentence:
        `Behind a one-off unlock costing ${cost} credits. You pay once and keep access — ` +
        `it is not charged again each time you use it.`,
    };
  }
  if (METERED_KEYS.includes(key)) {
    return {
      kind: "metered",
      cost,
      badge: `${cost} credits per use`,
      sentence:
        `${cost} credits each time it is used. It costs more than the screens that only ` +
        `work on your own logged data because it calls a third-party AI service, and the ` +
        `price covers that call.`,
    };
  }
  throw new Error(
    `app-access: "${key}" is neither a permanent unlock nor a per-use charge in ` +
      `credits.ts, so we do not know how to describe it. Guessing would be worse ` +
      `than refusing.`
  );
}