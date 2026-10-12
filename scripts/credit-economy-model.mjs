#!/usr/bin/env node
// ============================================================================
// CREDIT ECONOMY MODEL — derives every number, then proves the invariants
// ----------------------------------------------------------------------------
// Run: node scripts/credit-economy-model.mjs
//
// This is the calculation behind src/config/credits.ts. It exists so the
// economy can be re-derived rather than re-guessed: change a price or a model
// here and the script tells you which credits, packs and grants follow.
//
// Three inputs, in order:
//   1. what a call actually costs us (model prices x tokens)
//   2. what a credit is worth in cash (pack price, after the store's cut)
//   3. what we therefore charge for a feature
//
// It exits non-zero if any invariant fails, so it is safe to run in CI.
// ============================================================================

const GOOGLE_PLAY_TAKE = 0.30; // first $1M/yr; 15% above that
const GOOGLE_PLAY_TAKE_SCALE = 0.15;

// ---------------------------------------------------------------------------
// 1. Provider prices. Luna/Sol are stated in supabase/functions/_shared/
// aiModels.ts. The Gemini line is an ASSUMPTION — form analysis is the one
// feature that runs on Google and no price for it is written down anywhere in
// this repository. It is deliberately set high (Flash list price) rather than
// optimised, so the ceiling absorbs being wrong in the expensive direction.
// ---------------------------------------------------------------------------
const MODEL_USD_PER_MTOK = {
  luna: { in: 0.10, out: 0.50 }, // gpt-6-luna  — stated in aiModels.ts
  sol: { in: 2.00, out: 10.00 }, // gpt-6-sol   — stated in aiModels.ts
  geminiFlash: { in: 0.30, out: 2.50 }, // ASSUMPTION — not in the repo
  geminiPro: { in: 1.25, out: 10.00 }, // ASSUMPTION — not in the repo
};

// ---------------------------------------------------------------------------
// 2. Token budget per call.
//
//   output = the feature's maxOutputTokens in aiModels.ts, times a utilisation
//            factor (a cap is a ceiling, not an average).
//   input  = system prompt + the athlete's dossier. Bounded by the LIMITS in
//            _shared/openai.ts: userPrompt 8k + extraSystem 4k + userData 12k
//            characters, plus history for chat. Vision features are billed the
//            image as input tokens rather than characters.
// ---------------------------------------------------------------------------
const CEIL_SAFETY = 2; // ceiling = measured x this

const CALLS = {
  vaylo_coach_message: { model: "luna", outCap: 4000, util: 0.30, inTok: 6000 },
  weekly_coach_review: { model: "luna", outCap: 2000, util: 0.60, inTok: 6000 },
  training_plan_week: { model: "luna", outCap: 6000, util: 0.67, inTok: 8000 },
  // AI plan edits: one Luna call per two weeks of plan (see the plan-edit
  // migration). Week and whole-plan edits share the per-call cost model; the
  // prices differ (10 vs 20) because the value does, not the provider.
  plan_edit: { model: "luna", outCap: 2000, util: 0.50, inTok: 10000 },
  plan_edit_full: { model: "luna", outCap: 2000, util: 0.50, inTok: 10000 },
  calorie_scan: { model: "luna", outCap: 2000, util: 0.45, inTok: 2500 },
  // A nutrition review reads a week of logged meals plus the dossier and answers
  // with a short structured review: text-only, so the input is the large half
  // and there is no image to bill.
  nutrition_review: { model: "luna", outCap: 2000, util: 0.60, inTok: 13000 },
  tactical_prep: { model: "luna", outCap: 2500, util: 0.60, inTok: 7000 },
  // One plan per injury: the report plus the dossier in, a weeks-long scaffold
  // out. The injury report is short, so this is the dossier-bound case again.
  injury_plan: { model: "luna", outCap: 4000, util: 0.30, inTok: 10000 },
  training_insight: { model: "luna", outCap: 2000, util: 0.60, inTok: 6000 },
  development_trajectory: { model: "luna", outCap: 2000, util: 0.45, inTok: 4000 },
  archetype_view: { model: "luna", outCap: 3000, util: 0.40, inTok: 5000 },
  // Video runs on Gemini Flash for ordinary clips (GEMINI_MODELS.FLASH is the
  // default in video-form-analysis; PRO is reserved for premium analyses).
  // Priced on the default path because that is what the credit is sold against.
  video_form_analysis: { model: "geminiFlash", outCap: 8000, util: 0.38, inTok: 20000 },
  form_analysis: { model: "geminiFlash", outCap: 3500, util: 0.34, inTok: 2000 },
  limiter_fix_plan: { model: "sol", outCap: 8000, util: 0.63, inTok: 6000 },
};

/** What one call actually costs, in USD. */
const callCost = (c) => {
  const p = MODEL_USD_PER_MTOK[c.model];
  const outTok = Math.round(c.outCap * c.util);
  return (c.inTok / 1e6) * p.in + (outTok / 1e6) * p.out;
};

// ---------------------------------------------------------------------------
// 3. The economy being validated.
// ---------------------------------------------------------------------------
const FEATURE_COSTS = {
  vaylo_coach_message: 8,
  weekly_coach_review: 10,
  training_plan_week: 20,
  plan_edit: 10,
  plan_edit_full: 20,
  calorie_scan: 12,
  nutrition_review: 8,
  // Per plan, on top of the one-off tab unlock (25) beside it: the tab is the
  // screen, the plan is a provider call.
  injury_plan: 6,
  tactical_prep: 12,
  development_trajectory: 8,
  archetype_view: 10,
  video_form_analysis: 45,
  form_analysis: 15,
  limiter_fix_plan: 120,
  // No flat-rate products: one payment against unlimited metered AI calls
  // loses money to exactly the heavy users it attracts. Every analysis and
  // every scan carries its own price instead.
  // No provider call — priced for value, not to cover a cost.
  nutrition_plan_week: 8,
  training_insight: 8,
  vpr_compare: 2,
  mental_gym_unlock: 30,
  injury_management_unlock: 25,
  learning_unlock: 25,
  cross_sport_unlock: 15,
  streak_shield: 3,
};

const CEILINGS = Object.fromEntries(
  Object.entries(CALLS).map(([k, c]) => [k, +(callCost(c) * CEIL_SAFETY).toFixed(6)]),
);

/** Credits granted to a brand-new account. */
const STARTING_CREDITS = 260;

/** The plan an 8-week athlete is supposed to be able to build on day one. */
const PLAN_WEEKS = 8;

// Credits + bonus are shared by every tier; only price_cents differ.
const PACKS = [
  { id: "pack_25", credits: 25, bonus: 5 },
  { id: "pack_50", credits: 50, bonus: 15 },
  { id: "pack_120", credits: 120, bonus: 45 },
  { id: "pack_200", credits: 200, bonus: 90 },
  { id: "pack_500", credits: 500, bonus: 160 },
];

const TIERS = {
  A: [249, 499, 999, 1499, 2499],
  B: [199, 399, 799, 1199, 1999],
  C: [99, 199, 499, 799, 1499],
  D: [49, 99, 299, 499, 999],
};

// Coins (cosmetics only). Must not fight the credit conversion.
const COINS_PER_CREDIT = 7.5;
const COIN_BUNDLES = [
  { id: "coins_120", coins: 120, price_cents: 299 },
  { id: "coins_300", coins: 330, price_cents: 599 },
  { id: "coins_800", coins: 920, price_cents: 1299 },
  { id: "coins_2000", coins: 2500, price_cents: 2499 },
  { id: "coins_5000", coins: 7500, price_cents: 3749 },
];

const MIN_MARGIN_MULTIPLE = 8;

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------
const total = (p) => p.credits + p.bonus;

/** Cash per credit a buyer pays, before the store's cut. */
const grossPerCredit = (priceCents, p) => priceCents / total(p);
/** Cash per credit we actually keep, after the store's cut. */
const netPerCredit = (priceCents, p, take = GOOGLE_PLAY_TAKE) =>
  (priceCents / 100) * (1 - take) / total(p);

/** The rate a margin floor must be measured against: cheapest credit anywhere. */
const allRates = Object.entries(TIERS).flatMap(([tier, prices]) =>
  prices.map((cents, i) => netPerCredit(cents, PACKS[i])),
);
const WORST_NET = Math.min(...allRates);

const c = (n, w = 6) => String(n).padStart(w);
const usd = (n) => `$${n.toFixed(6)}`;

console.log("=".repeat(78));
console.log("1. WHAT A CALL ACTUALLY COSTS US");
console.log("=".repeat(78));
console.log(
  ["feature", "model", "in_tok", "out_tok", "cost_usd", "ceiling_usd"]
    .map((h) => h.padEnd(14))
    .join(""),
);
for (const [key, cfg] of Object.entries(CALLS)) {
  const outTok = Math.round(cfg.outCap * cfg.util);
  console.log(
    key.padEnd(22) +
      cfg.model.padEnd(14) +
      c(cfg.inTok) +
      c(outTok) +
      c(callCost(cfg).toFixed(6)) +
      c(CEILINGS[key].toFixed(6)),
  );
}
console.log(
  `\n8-week plan (8 x training_plan_week) costs us ${usd(callCost(CALLS.training_plan_week) * PLAN_WEEKS)}.`,
);
console.log(
  `Starting grant (${STARTING_CREDITS} credits) costs us at most ${usd(
    Object.entries(CALLS)
      .filter(([k]) => FEATURE_COSTS[k])
      .reduce((n, [, cfg]) => n + callCost(cfg), 0) * 8,
  )} if every metered feature were fired repeatedly.\n`,
);

console.log("=".repeat(78));
console.log("2. WHAT A CREDIT IS WORTH");
console.log("=".repeat(78));
console.log(
  ["tier", "pack", "total", "price", "gross $/cr", "net $/cr"]
    .map((h) => h.padEnd(12))
    .join(""),
);
for (const [tier, prices] of Object.entries(TIERS)) {
  prices.forEach((cents, i) => {
    const p = PACKS[i];
    console.log(
      tier.padEnd(12) +
        p.id.padEnd(12) +
        c(total(p)).padEnd(12) +
        c(`$${(cents / 100).toFixed(2)}`) +
        c(grossPerCredit(cents, p).toFixed(6)) +
        c(netPerCredit(cents, p).toFixed(6)),
    );
  });
}
console.log(`\nWorst-case net revenue per credit (any tier, any pack): ${usd(WORST_NET)}`);
console.log(`Set WORST_CASE_USD_PER_CREDIT = 0.0105 — NET of the store's cut.`);
console.log(
  `At the 15% rate that applies above $1M/yr: ${usd(
    Math.min(...Object.values(TIERS).flatMap((p) => p.map((cents, i) => netPerCredit(cents, PACKS[i], GOOGLE_PLAY_TAKE_SCALE)))),
  )}\n`,
);

console.log("=".repeat(78));
console.log("3. WHAT EACH FEATURE COSTS, AND WHAT THAT LEAVES");
console.log("=".repeat(78));
console.log(
  ["feature", "credits", "net rev", "cost_usd", "margin x", "floor"]
    .map((h) => h.padEnd(13))
    .join(""),
);

const failures = [];
for (const [key, cost] of Object.entries(FEATURE_COSTS)) {
  const floor = CEILINGS[key]
    ? Math.ceil((CEILINGS[key] * MIN_MARGIN_MULTIPLE) / 0.0105)
    : null;
  const revenue = cost * WORST_NET;
  const margin = CEILINGS[key] ? revenue / CEILINGS[key] : null;
  console.log(
    key.padEnd(24) +
      c(cost, 8) +
      c(usd(revenue), 14) +
      c(CEILINGS[key] ? callCost(CALLS[key]).toFixed(6) : "—", 12) +
      c(margin ? margin.toFixed(1) + "x" : "—", 10) +
      c(floor ?? "—", 8),
  );
  if (floor !== null) {
    if (cost < floor) {
      failures.push(`${key}: costs ${cost}, floor is ${floor} — LOSES MONEY`);
    }
    if (margin < MIN_MARGIN_MULTIPLE) {
      failures.push(`${key}: margin ${margin.toFixed(1)}x < ${MIN_MARGIN_MULTIPLE}x`);
    }
  }
}

console.log("\n".padEnd(79, "-"));
console.log("INVARIANTS");
console.log("-".repeat(78));

const check = (ok, msg) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`);
  if (!ok) failures.push(msg);
};

// 1. ladder descends in the default (tier A) ladder
const tierA = TIERS.A;
const descending = tierA.every(
  (cents, i) => i === 0 || grossPerCredit(cents, PACKS[i]) < grossPerCredit(tierA[i - 1], PACKS[i - 1]),
);
check(descending, "tier A: cost per credit falls as packs grow");

// 2. the biggest pack really is the best value (the addictive pull)
const bestIdx = PACKS.reduce(
  (b, p, i) => (netPerCredit(tierA[i], p) < netPerCredit(tierA[b], PACKS[b]) ? i : b),
  0,
);
check(bestIdx === PACKS.length - 1, `biggest pack is the best value (pack_500, bonus ${PACKS[4].bonus})`);

// 3. every pack actually gives something away, and the biggest gives the most
//    in absolute terms (the "free" part is what makes a bigger pack feel bigger)
check(
  PACKS.every((p) => p.bonus > 0),
  `every pack includes bonus credits (${PACKS.map((p) => `+${p.bonus}`).join(" ")})`,
);
check(
  PACKS.every((p, i) => i === 0 || PACKS[i].bonus > PACKS[i - 1].bonus),
  `bonus rises with pack size (${PACKS.map((p) => p.bonus).join(" < ")})`,
);

// 4. no flat-rate products on metered calls: every analysis and scan has its
// own price, and each one clears the floor on its own (checked in the metered
// loop above). This step asserts the absence rather than a number — adding a
// flat-rate key back must fail here first.
for (const retired of ["form_analysis_unlock", "nutrition_pack_unlock"]) {
  check(!(retired in FEATURE_COSTS), `${retired} stays retired (no flat rate on metered calls)`);
}

// 5. the coin ladder must not fight credit conversion
const convertPerCoin = grossPerCredit(tierA[4], PACKS[4]) / COINS_PER_CREDIT;
const cheapestCoin = Math.min(...COIN_BUNDLES.map((b) => b.price_cents / b.coins));
const dearestCoin = Math.max(...COIN_BUNDLES.map((b) => b.price_cents / b.coins));
check(
  cheapestCoin < convertPerCoin,
  `cash coins beat conversion (${(cheapestCoin / 100).toFixed(6)} < ${(convertPerCoin / 100).toFixed(6)} $/coin)`,
);
check(
  dearestCoin > convertPerCoin,
  `smallest coin bundle stays above conversion (${(dearestCoin / 100).toFixed(6)} > ${(convertPerCoin / 100).toFixed(6)})`,
);

// 6. THE REQUIREMENT: a new athlete can build an 8-week plan and do more with it
const planCost = FEATURE_COSTS.training_plan_week * PLAN_WEEKS;
const extras = {
  calorie_scan: FEATURE_COSTS.calorie_scan,
  "3x coach message": FEATURE_COSTS.vaylo_coach_message * 3,
  form_analysis: FEATURE_COSTS.form_analysis,
  weekly_coach_review: FEATURE_COSTS.weekly_coach_review,
  "4wk nutrition": FEATURE_COSTS.nutrition_plan_week * 4,
};
const extrasTotal = Object.values(extras).reduce((a, b) => a + b, 0);
check(
  STARTING_CREDITS >= planCost + extrasTotal,
  `starting grant ${STARTING_CREDITS} >= 8-week plan ${planCost} + extras ${extrasTotal}`,
);
check(
  STARTING_CREDITS < planCost + extrasTotal + 100,
  `starting grant is not wildly over-provisioned (headroom ${STARTING_CREDITS - planCost - extrasTotal})`,
);

// 7. the trial is cheap enough to give away — cost the grant's actual basket
const grantBasket = [
  ...Array(PLAN_WEEKS).fill(CALLS.training_plan_week),
  CALLS.calorie_scan,
  ...Array(3).fill(CALLS.vaylo_coach_message),
  CALLS.form_analysis,
  CALLS.weekly_coach_review,
];
const grantApiCost = grantBasket.reduce((n, cfg) => n + callCost(cfg), 0);
check(
  grantApiCost < 0.10,
  `the starting grant's whole basket costs us ${usd(grantApiCost)} to give away`,
);

// 8. worst-case constant must be conservative, not flattering
check(0.0105 <= WORST_NET, `WORST_CASE_USD_PER_CREDIT 0.0105 <= actual worst ${usd(WORST_NET)}`);
check(0.0105 > WORST_NET * 0.99, `...and is not stale (must be > ${usd(WORST_NET * 0.99)})`);

// ---------------------------------------------------------------------------
console.log("\n".padEnd(79, "-"));
console.log("THE STARTING GRANT, SPENT");
console.log("-".repeat(78));
console.log(`  8-week training plan ......... ${c(planCost, 5)} credits`);
for (const [label, n] of Object.entries(extras)) {
  console.log(`  ${label.padEnd(28)} ${c(n, 5)}`);
}
console.log(`  ${"TOTAL".padEnd(30)} ${c(planCost + extrasTotal, 5)}`);
console.log(`  granted ...................... ${c(STARTING_CREDITS, 5)}`);
console.log(
  `  left over .................... ${c(STARTING_CREDITS - planCost - extrasTotal, 5)}\n`,
);
console.log(`  An 8-week plan today would cost ${c(FEATURE_COSTS.training_plan_week * PLAN_WEEKS, 5)} credits at 20/week.`);

console.log("\n".padEnd(79, "="));
if (failures.length) {
  console.log(`${failures.length} INVARIANT FAILURE(S):`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("ALL INVARIANTS HOLD");
