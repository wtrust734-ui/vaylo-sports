// ============================================================================
// VAYLO SPORTS — MONEY MODEL GENERATOR + ASSERTIONS
// ----------------------------------------------------------------------------
// src/config/credits.ts, src/config/coins.ts and src/config/monetisation.ts are
// the single source of truth for prices. This script:
//
//   1. mirrors them into the Deno copy used by the edge functions
//      (supabase/functions/_shared/moneyCatalog.ts) so the server that GRANTS
//      grants exactly what the UI SHOWS, and so prices stop being duplicated,
//   2. asserts the economy invariants, failing the run if any price is
//      incoherent (see MONEY.md), and
//   3. writes MONEY.md with the resulting money maths.
//
//   node scripts/gen-money-mirror.cjs
// ============================================================================
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const readSrc = (p) => fs.readFileSync(path.join(root, p), "utf8");

const creditsSrc = readSrc("src/config/credits.ts");
const coinsSrc = readSrc("src/config/coins.ts");
const monetisationSrc = readSrc("src/config/monetisation.ts");

// --- parsers ---------------------------------------------------------------
const readNumber = (src, name) => {
  const m = src.match(new RegExp(name + "\\s*=\\s*([0-9.]+)"));
  if (!m) throw new Error(`Could not read ${name}`);
  return Number(m[1]);
};

/** Parses `export const NAME: T[] = [ { ... }, ... ];` */
const parseArray = (src, arrayName, fields) => {
  const start = src.indexOf(arrayName);
  if (start === -1) throw new Error(`Could not find ${arrayName}`);
  const open = src.indexOf("[", start);
  const close = src.indexOf("];", open);
  const body = src.slice(open, close);
  const rows = [];
  for (const line of body.split(/\r?\n/)) {
    const idMatch = line.match(/id:\s*"([^"]+)"/);
    if (!idMatch) continue;
    const row = { id: idMatch[1] };
    for (const f of fields) {
      const strMatch = line.match(new RegExp(f + ':\\s*"([^"]+)"'));
      const numMatch = line.match(new RegExp(f + ":\\s*([0-9]+)"));
      if (numMatch) row[f] = Number(numMatch[1]);
      else if (strMatch) row[f] = strMatch[1];
    }
    rows.push(row);
  }
  return rows;
};

/** Parses a single `export const NAME: T = { ... };` object literal. */
const parseObject = (src, name, fields) => {
  const start = src.indexOf(name);
  if (start === -1) throw new Error(`Could not find ${name}`);
  const open = src.indexOf("{", start);
  const close = src.indexOf("};", open);
  const body = src.slice(open, close);
  const row = {};
  for (const f of fields) {
    const strMatch = body.match(new RegExp(f + ':\\s*"([^"]+)"'));
    const numMatch = body.match(new RegExp(f + ":\\s*([0-9]+)"));
    if (numMatch) row[f] = Number(numMatch[1]);
    else if (strMatch) row[f] = strMatch[1];
  }
  return row;
};

/** Parses `export const FEATURE_COSTS: Record<...> = { key: 12, ... };` */
const parseRecord = (src, name) => {
  const start = src.indexOf(name);
  if (start === -1) throw new Error(`Could not find ${name}`);
  const open = src.indexOf("{", start);
  const close = src.indexOf("};", open);
  const body = src.slice(open, close);
  const out = {};
  for (const m of body.matchAll(/([a-z_]+):\s*([0-9]+)/g)) out[m[1]] = Number(m[2]);
  return out;
};

const parseStringArray = (src, name) => {
  const start = src.indexOf(name);
  if (start === -1) throw new Error(`Could not find ${name}`);
  const open = src.indexOf("[", start);
  const close = src.indexOf("];", open);
  return [...src.slice(open, close).matchAll(/"([^"]+)"/g)].map((m) => m[1]);
};

const CREDIT_PACKS = parseArray(creditsSrc, "CREDIT_PACKS", ["credits", "bonus", "price_cents", "label"]);
const COIN_BUNDLES = parseArray(coinsSrc, "COIN_BUNDLES", ["coins", "bonus", "price_cents", "label"]);
const FIRST_PURCHASE = parseObject(coinsSrc, "FIRST_PURCHASE_BUNDLE", ["id", "coins", "bonus", "price_cents", "label"]);
const COINS_PER_CREDIT = readNumber(coinsSrc, "COINS_PER_CREDIT");
const FEATURE_COSTS = parseRecord(creditsSrc, "FEATURE_COSTS");
const UNLIMITED_PACKS = parseArray(monetisationSrc, "UNLIMITED_PACKS", ["price_cents", "period", "label"]);
const DEPRECATED_PRODUCTS = parseArray(monetisationSrc, "LEGACY_PRODUCTS", ["kind", "price_cents", "period"]);
const DEPRECATED_PRODUCT_IDS = parseStringArray(monetisationSrc, "DEPRECATED_PRODUCT_IDS");

// --- feature unlock products → the credit_cost() key the DB enforces --------
// The edge function used to carry its own copy of these prices, and it had
// drifted from economy_config (form_analysis 44 vs 54). The map below is the
// single place a purchasable entitlement is named; the PRICE always comes from
// the database (public.credit_cost).
const FEATURE_PRODUCT_ALIASES = {
  archetype: "archetype_view",
  cross_sport: "cross_sport_unlock",
  form_analysis: "form_analysis_unlock",
  injury_management: "injury_management_unlock",
  mental_gym: "mental_gym_unlock",
  nutrition_pack: "nutrition_pack_unlock",
};
const FEATURE_PRODUCTS = Object.fromEntries(
  Object.entries(FEATURE_PRODUCT_ALIASES).map(([product, key]) => [product, key])
);

// Legacy credit products. No longer listed in the UI, but baskets saved by an
// older app build can still contain them, so they must keep working (this is
// exactly what the old edge function's "legacy" table did).
const LEGACY_CREDIT_PACKS = [
  { id: "credits_20", credits: 20, bonus: 0, price_cents: 500, label: "Legacy 20" },
  { id: "credits_50", credits: 50, bonus: 0, price_cents: 1250, label: "Legacy 50" },
  { id: "credits_100", credits: 100, bonus: 0, price_cents: 2500, label: "Legacy 100" },
  { id: "credits_200", credits: 200, bonus: 0, price_cents: 5000, label: "Legacy 200" },
];

const usd = (cents) => cents / 100;
const total = (b, unit) => (b[unit] || 0) + (b.bonus || 0);
const withPer = (list, unit, unitField) =>
  list.map((b) => ({ ...b, total: total(b, unitField), per: usd(b.price_cents) / total(b, unitField) }));

const packs = withPer(CREDIT_PACKS, "credits", "credits");
const coinBundles = withPer(COIN_BUNDLES, "coins", "coins");
const firstCoins = total(FIRST_PURCHASE, "coins");
const firstPer = usd(FIRST_PURCHASE.price_cents) / firstCoins;

// --- invariants ------------------------------------------------------------
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };
const isDesc = (nums) => nums.every((n, i) => i === 0 || n < nums[i - 1]);
const fmt = (n) => n.toFixed(5);

check(
  !!FIRST_PURCHASE.id && FIRST_PURCHASE.id.length > 0,
  "FIRST_PURCHASE_BUNDLE must declare an id — without it the one-time-purchase guard silently stops matching"
);
check(packs.length > 0 && coinBundles.length > 0, "Credit packs and coin bundles must both be non-empty");
check(isDesc(packs.map((p) => p.per)), `Credit pack $/credit must fall as packs grow (got ${packs.map((p) => fmt(p.per)).join(", ")})`);
check(isDesc(coinBundles.map((c) => c.per)), `Coin bundle $/coin must fall as bundles grow (got ${coinBundles.map((c) => fmt(c.per)).join(", ")})`);

const bestPackPerCredit = Math.min(...packs.map((p) => p.per));
const conversionPerCoin = bestPackPerCredit / COINS_PER_CREDIT;
const topBundlePerCoin = coinBundles[coinBundles.length - 1].per;

check(COINS_PER_CREDIT > 0, "COINS_PER_CREDIT must be positive");
check(
  topBundlePerCoin < conversionPerCoin,
  `Top coin bundle ($${fmt(topBundlePerCoin)}/coin) must beat credit conversion ($${fmt(conversionPerCoin)}/coin), otherwise coins sold for cash never sell.`
);
check(
  coinBundles[0].per > conversionPerCoin,
  `Smallest coin bundle ($${fmt(coinBundles[0].per)}/coin) must stay above the conversion price ($${fmt(conversionPerCoin)}/coin) so instant conversion is not a discount.`
);
check(
  firstPer < topBundlePerCoin,
  `First-purchase bundle ($${fmt(firstPer)}/coin) must be the best coin rate in the app (top bundle is $${fmt(topBundlePerCoin)}/coin).`
);
check(
  CREDIT_PACKS.every((p) => (p.credits || 0) > 0 && (p.price_cents || 0) > 0),
  "Every credit pack needs credits > 0 and price_cents > 0"
);
check(
  COIN_BUNDLES.every((c) => (c.coins || 0) > 0 && (c.price_cents || 0) > 0),
  "Every coin bundle needs coins > 0 and price_cents > 0"
);
check(
  COIN_BUNDLES.filter((c) => c.id === "coins_5000").length === 1,
  "The top coin bundle id changed — update the ladder comment in src/config/coins.ts"
);
check(
  UNLIMITED_PACKS.length > 0 && UNLIMITED_PACKS.every((p) => (p.price_cents || 0) > 0),
  "Every unlimited pack needs price_cents > 0"
);
check(
  Object.values(FEATURE_PRODUCTS).every((key) => key in FEATURE_COSTS),
  "Every FEATURE_PRODUCTS alias must exist in FEATURE_COSTS"
);
check(
  DEPRECATED_PRODUCT_IDS.every((id) => !CREDIT_PACKS.some((p) => p.id === id)),
  "A deprecated product id is still being sold as a credit pack"
);

// --- mirror ----------------------------------------------------------------
const json = (v) => JSON.stringify(v, null, 2);

const mirror = `// ============================================================================
// GENERATED by scripts/gen-money-mirror.cjs — DO NOT EDIT BY HAND.
// Mirror of src/config/credits.ts, src/config/coins.ts and
// src/config/monetisation.ts for the Deno edge functions, so the server grants
// exactly what the UI advertises. Re-run the generator after changing a config.
//
// Money model summary (see MONEY.md):
//   1 credit = ${COINS_PER_CREDIT} coins
//   best credit pack      $${fmt(bestPackPerCredit)}/credit  → $${fmt(conversionPerCoin)}/coin if converted
//   top coin bundle       $${fmt(topBundlePerCoin)}/coin     (beats converting: coins for cash are the better deal)
//   first-purchase bundle $${fmt(firstPer)}/coin             (best rate in the app, one per account)
// ============================================================================

export const COINS_PER_CREDIT = ${COINS_PER_CREDIT};

export interface CreditPack { id: string; credits: number; bonus: number; price_cents: number; label?: string }
export interface CoinBundle { id: string; coins: number; bonus: number; price_cents: number; label?: string; best_value?: boolean }
export interface UnlimitedPack { id: string; price_cents: number; period: "lifetime" | "month" | "year"; label: string }

export const CREDIT_PACKS: CreditPack[] = ${json(
  CREDIT_PACKS.map(({ id, credits, bonus, price_cents, label }) => ({
    id, credits: credits || 0, bonus: bonus || 0, price_cents: price_cents || 0, label,
  }))
)};

export const COIN_BUNDLES: CoinBundle[] = ${json(
  COIN_BUNDLES.map(({ id, coins, bonus, price_cents, label, best_value }) => ({
    id, coins: coins || 0, bonus: bonus || 0, price_cents: price_cents || 0, label, best_value,
  }))
)};

/** Sold once per account — the edge function checks user_purchases first. */
export const FIRST_PURCHASE_BUNDLE: CoinBundle = ${json({
  id: FIRST_PURCHASE.id,
  coins: FIRST_PURCHASE.coins || 0,
  bonus: FIRST_PURCHASE.bonus || 0,
  price_cents: FIRST_PURCHASE.price_cents || 0,
  label: FIRST_PURCHASE.label,
})};

export const UNLIMITED_PACKS: UnlimitedPack[] = ${json(
  UNLIMITED_PACKS.map(({ id, price_cents, period, label }) => ({ id, price_cents: price_cents || 0, period, label }))
)};

export const DEPRECATED_PRODUCT_IDS: string[] = ${json(DEPRECATED_PRODUCT_IDS)};

/** Retired credit products, honoured only so older baskets still check out. */
export const LEGACY_CREDIT_PACKS: CreditPack[] = ${json(LEGACY_CREDIT_PACKS)};

/**
 * Purchasable entitlement products → the key public.credit_cost() expects.
 * The PRICE always comes from the database (economy_config.feature_costs), never
 * from here, so the client, the database and the edge function agree.
 */
export const FEATURE_PRODUCTS: Record<string, string> = ${json(FEATURE_PRODUCTS)};

/** Product id → coins granted (base + bonus), including the first-purchase bundle. */
export const COIN_GRANTS: Record<string, number> = ${json(
  Object.fromEntries([...COIN_BUNDLES, FIRST_PURCHASE].map((b) => [b.id, total(b, "coins")]))
)};

/** Product id → credits granted (base + bonus). */
export const CREDIT_GRANTS: Record<string, number> = ${json(
  Object.fromEntries([...CREDIT_PACKS, ...LEGACY_CREDIT_PACKS].map((p) => [p.id, total(p, "credits")]))
)};

/** Product id → list price in cents, from the server tables only. */
export const PRODUCT_PRICES: Record<string, number> = ${json(
  Object.fromEntries(
    [...CREDIT_PACKS, ...LEGACY_CREDIT_PACKS, ...COIN_BUNDLES, FIRST_PURCHASE, ...UNLIMITED_PACKS].map((p) => [p.id, p.price_cents || 0])
  )
)};

/** Products that may only ever be granted once per account. */
export const ONE_TIME_PRODUCTS: string[] = [FIRST_PURCHASE_BUNDLE.id];
`;

// --- money doc -------------------------------------------------------------
const table = (rows, unit) =>
  [
    `| Bundle | ${unit} | Price | $/${unit.toLowerCase().replace(/s$/, "")} |`,
    "|---|---|---|---|",
    ...rows.map((r) => `| ${r.label ?? r.id} (\`${r.id}\`) | ${r.total.toLocaleString()} | $${usd(r.price_cents).toFixed(2)} | ${fmt(r.per)} |`),
  ].join("\n");

const doc = `# Vaylo money model

Generated by \`scripts/gen-money-mirror.cjs\` from \`src/config/credits.ts\`,
\`src/config/coins.ts\` and \`src/config/monetisation.ts\`. **Do not hand-edit** —
change the configs and re-run it (it also regenerates the edge-function mirror).

## Currencies

- **Credits** — premium currency: features, AI coaching, plans, form analysis.
  Feature prices live in \`economy_config.feature_costs\` (admin tunable) and are
  enforced server-side by \`credits_spend()\`.
- **Coins** — cosmetics only (avatar + profile cosmetics).
- **Rate: 1 credit = ${COINS_PER_CREDIT} coins**, stored in
  \`economy_config.coins_per_credit\`, applied by \`convert_credits_to_coins()\`.

## Credit packs

${table(packs, "Credits")}

## Coin bundles

${table(coinBundles, "Coins")}

| Bundle | Coins | Price | $/coin |
|---|---|---|---|
| ${FIRST_PURCHASE.label} (\`${FIRST_PURCHASE.id}\`) | ${firstCoins.toLocaleString()} | $${usd(FIRST_PURCHASE.price_cents).toFixed(2)} | ${fmt(firstPer)} |

## Why these numbers

There are two ways to get coins and they must not fight each other:

| Path | $/coin |
|---|---|
| Best credit pack ($${fmt(bestPackPerCredit)}/credit) converted at ${COINS_PER_CREDIT}:1 | ${fmt(conversionPerCoin)} |
| Biggest coin bundle | ${fmt(topBundlePerCoin)} |
| Smallest coin bundle (convenience premium) | ${fmt(coinBundles[0].per)} |
| First-purchase bundle (once per account) | ${fmt(firstPer)} |

Invariants enforced by the generator (a broken economy fails the run):

1. Cost per credit falls as credit packs grow; cost per coin falls as coin
   bundles grow.
2. The biggest coin bundle **beats** converting credits, so coins bought with
   cash are the best coin value in the app.
3. The smallest coin bundle stays **above** the conversion price, so instant
   conversion remains convenience rather than a discount.
4. The first-purchase bundle is the cheapest coins per dollar anywhere and can
   only be bought once per account.
5. Every entitlement product maps to a real \`economy_config.feature_costs\` key.

If the coin rate changes, the ladder has to be re-anchored: at
1 credit = ${COINS_PER_CREDIT} coins one coin is worth $${fmt(conversionPerCoin)},
so the anchor bundle must land below that.
`;

fs.mkdirSync(path.join(root, "supabase/functions/_shared"), { recursive: true });
fs.writeFileSync(path.join(root, "supabase/functions/_shared/moneyCatalog.ts"), mirror, "utf8");
fs.writeFileSync(path.join(root, "MONEY.md"), doc, "utf8");

console.log(`money mirror + MONEY.md written  (1 credit = ${COINS_PER_CREDIT} coins)`);
console.log(`  best credit pack: $${fmt(bestPackPerCredit)}/credit → $${fmt(conversionPerCoin)}/coin if converted`);
console.log(`  coin ladder:      ${coinBundles.map((c) => `$${fmt(c.per)}`).join(" → ")}`);
console.log(`  first purchase:   $${fmt(firstPer)}/coin`);
console.log(`  feature products: ${Object.keys(FEATURE_PRODUCTS).join(", ")}`);
if (failures.length) {
  console.error("\nECONOMY INVARIANTS FAILED:");
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log("  all invariants pass ✓");
