// ============================================================================
// COACH MARKETPLACE — the price split, and the fact that it is hidden
// ----------------------------------------------------------------------------
// These assertions are about money that moves and about a feature that must not
// be reachable yet, which are the two ways this feature can be wrong in a way
// nobody notices on a screen.
//
//   1. The worked example the product was specified with — a £5 plan, a £6
//      charge, £1 kept — is asserted literally, because "the coach receives what
//      they asked for" is a promise, not a rounding preference.
//   2. The generated mirror is checked by running its generator in --check mode,
//      so a change to the pricing that never reaches the edge functions fails
//      the suite rather than shipping a server that charges something else.
//   3. The migration's commission value is read and compared with the constant,
//      because the database is what actually charges and a plausible-looking
//      drift (20 → 15) is invisible in review.
// ============================================================================

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  COACH_COMMISSION_MAX_PERCENT,
  COACH_COMMISSION_MIN_PERCENT,
  COACH_COMMISSION_PERCENT,
  COACH_CREDIT_PACKS,
  COACH_MAX_PLAN_CENTS,
  COACH_MIN_PLAN_CENTS,
  COACH_PLAN_CURRENCY,
  COACH_SIGNUP_FEE_CENTS,
  COACH_SIGNUP_FEE_CURRENCY,
  coachPlanError,
  commissionIsInBand,
  commissionPercentToBps,
  describeQuote,
  formatMinorUnits,
  quoteCoachPrice,
} from "@/config/coachMarketplace";
import { isFlagOn } from "@/config/featureFlags";

const root = resolve(__dirname, "../..");
const MIGRATION = join(root, "supabase", "migrations", "20261007060428_coach_marketplace.sql");
const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n?/g, "\n");

describe("the split", () => {
  it("charges the buyer £6 for a £5 plan and keeps £1", () => {
    // The specified example, as an assertion. If this test is ever "fixed" by
    // changing the numbers, the promise to coaches has changed with it.
    expect(quoteCoachPrice(500)).toEqual({
      netCents: 500,
      feeCents: 100,
      grossCents: 600,
      commissionBps: 2000,
    });
  });

  it("pays the coach exactly what they asked for", () => {
    // The property, not just the example: the charge minus the fee is the
    // coach's own number, whole pennies, at every price on the ladder.
    for (const netCents of [100, 250, 500, 750, 999, 1200, 5000, 99999]) {
      const quote = quoteCoachPrice(netCents);
      expect(quote.grossCents - quote.feeCents, `net ${netCents}`).toBe(netCents);
      expect(Number.isInteger(quote.feeCents), `net ${netCents}`).toBe(true);
      expect(quote.feeCents).toBeGreaterThan(0);
    }
  });

  it("quotes an integer gross price for every whole penny", () => {
    // A float anywhere in the split is how a platform ends up charging £6.0000001.
    for (let netCents = COACH_MIN_PLAN_CENTS; netCents <= 2000; netCents++) {
      const quote = quoteCoachPrice(netCents);
      expect(Number.isInteger(quote.grossCents), `net ${netCents}`).toBe(true);
      expect(Number.isInteger(quote.feeCents), `net ${netCents}`).toBe(true);
    }
  });

  it("refuses to quote a rate the product does not offer", () => {
    expect(() => quoteCoachPrice(500, 0)).toThrow(/band/);
    expect(() => quoteCoachPrice(500, 21)).toThrow(/band/);
    expect(() => quoteCoachPrice(500, Number.NaN)).toThrow(/band/);
  });

  it("refuses a price that is not whole money", () => {
    expect(() => quoteCoachPrice(0)).toThrow(/positive whole number/);
    expect(() => quoteCoachPrice(-100)).toThrow(/positive whole number/);
    expect(() => quoteCoachPrice(500.5)).toThrow(/positive whole number/);
  });

  it("keeps the default rate inside the published band", () => {
    expect(commissionIsInBand(COACH_COMMISSION_PERCENT)).toBe(true);
    expect(COACH_COMMISSION_PERCENT).toBeGreaterThanOrEqual(COACH_COMMISSION_MIN_PERCENT);
    expect(COACH_COMMISSION_PERCENT).toBeLessThanOrEqual(COACH_COMMISSION_MAX_PERCENT);
    expect(commissionPercentToBps(20)).toBe(2000);
    expect(commissionPercentToBps(12.5)).toBe(1250);
  });
});

describe("plan price validation", () => {
  it("accepts a plausible price", () => {
    expect(coachPlanError(500)).toBeNull();
  });

  it("bounds the price and says why", () => {
    expect(coachPlanError(COACH_MIN_PLAN_CENTS - 1)).toMatch(/lowest plan price/);
    expect(coachPlanError(COACH_MAX_PLAN_CENTS + 1)).toMatch(/higher than the marketplace allows/);
    expect(coachPlanError(Number.NaN)).toMatch(/whole pence/);
  });

  it("shows money in the coach's own currency", () => {
    expect(formatMinorUnits(600, "GBP")).toBe("£6.00");
    expect(formatMinorUnits(500, "GBP")).toBe("£5.00");
    // A currency Intl does not know must not throw on a screen showing a price.
    expect(formatMinorUnits(100, "NOT_A_CURRENCY")).toContain("1.00");
  });

  it("describes a quote for a log line", () => {
    expect(describeQuote(quoteCoachPrice(500))).toBe("500/100/600@2000bps");
  });
});

describe("the signup fee", () => {
  it("is $20, and is a dollar amount", () => {
    expect(COACH_SIGNUP_FEE_CENTS).toBe(2000);
    expect(COACH_SIGNUP_FEE_CURRENCY).toBe("USD");
    // Formatted for a British audience, which is who pays it: en-GB renders USD as
    // "US$20.00" rather than "$20.00", and that is the better label here — a page
    // whose every other figure is in pounds should not print a bare "$" and leave
    // a coach to guess which dollar it is.
    expect(formatMinorUnits(COACH_SIGNUP_FEE_CENTS, COACH_SIGNUP_FEE_CURRENCY)).toBe("US$20.00");
  });
});

describe("the Play Billing wallet", () => {
  it("sells one credit per penny, so a top-up and a plan are the same number", () => {
    for (const pack of COACH_CREDIT_PACKS) {
      expect(pack.credit_cents, pack.id).toBe(pack.price_cents);
      expect(pack.currency, pack.id).toBe(COACH_PLAN_CURRENCY);
      expect(pack.price_cents).toBeGreaterThanOrEqual(COACH_MIN_PLAN_CENTS);
    }
  });

  it("has unique product ids", () => {
    const ids = COACH_CREDIT_PACKS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("exists in the database too, so the server can refuse an unknown pack", () => {
    // The Play product ids have to exist in the Play Console (docs/COACH-
    // MARKETPLACE.md §4). They also have to exist here: `grant_coach_credits`
    // looks the pack up and raises `unknown_credit_pack` rather than trusting the
    // client's idea of what a purchase was worth.
    const sql = read(MIGRATION);
    for (const pack of COACH_CREDIT_PACKS) {
      expect(sql, `${pack.id} is missing from coach_credit_packs`).toContain(`'${pack.id}'`);
    }
  });
});

describe("the generated mirror", () => {
  it("is current", () => {
    // Runs the real generator in --check mode rather than reimplementing the
    // comparison, so the test cannot pass while the generator would emit
    // something different.
    expect(() =>
      execFileSync(process.execPath, [join(root, "scripts", "gen-coach-mirror.cjs"), "--check"], {
        cwd: root,
        stdio: "pipe",
      }),
    ).not.toThrow();
  });

  it("mirrors the commission the database will charge", () => {
    // The database is the authority for the charge, so the constant and the
    // seeded row have to agree. A silent 20 → 15 between the two would show a
    // coach one price and pay Vaylo another.
    const sql = read(MIGRATION);
    expect(sql).toMatch(/coach_commission_bps/);
    expect(sql).toMatch(
      new RegExp(`'coach_commission_bps',\\s*${commissionPercentToBps(COACH_COMMISSION_PERCENT)}\\b`),
    );
    expect(sql).toMatch(new RegExp(`'coach_signup_fee_cents',\\s*${COACH_SIGNUP_FEE_CENTS}\\b`));
    expect(sql).toMatch(/marketplace_check_commission/);
  });
});

describe("it is hidden", () => {
  it("ships with the marketplace flag off", () => {
    expect(isFlagOn("coachMarketplace")).toBe(false);
  });

  it("only reaches the app through the flag", () => {
    // The Coaching tab's contents are gated in the Market, and the three routes
    // are gated in App.tsx. Asserted at the source level because the failure is a
    // screen that renders, or a tab that appears empty, on a build that has not
    // switched the marketplace on.
    expect(read(join(root, "src", "pages", "Market.tsx"))).toMatch(
      /section === "coaching" && isFlagOn\("coachMarketplace"\)/,
    );
    // ...and the tab itself is removed from the nav, so a hidden feature is not an
    // empty tab. That was the state before this work: the tab was listed
    // unconditionally while its contents were gated.
    expect(read(join(root, "src", "components", "market", "MarketSectionNav.tsx"))).toMatch(
      /s\.key !== "coaching" \|\| isFlagOn\("coachMarketplace"\)/,
    );
    const app = read(join(root, "src", "App.tsx"));
    expect(app).toMatch(/isFlagOn\("coachMarketplace"\)/);
    expect(app).toMatch(/path="\/coach-studio"/);
    expect(app).toMatch(/path="\/coach-signup"/);
  });

  it("is hidden on the website as well as in the app", () => {
    // The page has to exist — the app's coach studio links to it, and a link that
    // 404s is worse than a page nobody can find — so "hidden" has to mean three
    // specific things, and each is asserted here rather than asserted in prose.
    const page = read(join(root, "site", "pages", "coaches.mjs"));
    expect(page, "the coach page no longer ships closed").toMatch(/COACH_MARKETPLACE_OPEN = false/);
    expect(page, "the coach page is indexable").toMatch(/noindex: true/);

    const generated = read(join(root, "website", "coaches", "index.html"));
    expect(generated).toMatch(/<meta name="robots" content="noindex/);
    expect(generated, "the page no longer says it is not open").toContain(
      "Coach accounts are not open yet",
    );

    // Out of the sitemap: listing a URL while telling crawlers not to index it is
    // a contradiction, and the sitemap is the stronger signal.
    const sitemap = read(join(root, "website", "sitemap.xml"));
    expect(sitemap).not.toContain("/coaches/");

    // And linked from nothing on the site. The nav and footer are the only places
    // a page is advertised, so their data module not naming it is the assertion.
    const siteData = read(join(root, "site", "data", "site.mjs"));
    expect(siteData).not.toContain("/coaches/");
  });

  it("publishes the worked example as HTML, not Markdown", () => {
    // `moneyExample` is a template literal injected straight into the page, and
    // the section helper emits raw HTML — it does not process Markdown. So a
    // `**bold**` around the single most important sentence on this page publishes
    // as literal asterisks: no structural check catches it, and it is exactly the
    // kind of thing that only shows up when somebody reads the rendered page.
    const generated = read(join(root, "website", "coaches", "index.html"));
    expect(generated).toContain("<strong>A coach prices a one-week plan at £5.</strong>");
    expect(generated).toContain("<em>added on top</em>");
    expect(generated, "Markdown leaked into the published page").not.toContain("**A coach");
    expect(generated, "Markdown leaked into the published page").not.toContain("*added on top*");
  });
});
