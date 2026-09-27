// Guard for the offer window.
//
// Why this test exists: `special_offers` rows stay `active = true` after their
// own `ends_at` passes, because nothing deactivates them. A live `double_weekend`
// row had been expired for four days and was still the offer
// `getDoubleCreditsOffer` returned — harmless only because its
// `bonus_multiplier` happened to be 1.0. Raise that multiplier and an expired
// offer silently doubles every pack's bonus. It is invisible to `tsc`, to lint
// and to the app build, so it is asserted here instead.

import { describe, expect, it } from "vitest";
import { isOfferLive, parseOfferTime } from "./offerWindow";
import {
  isOfferLive as edgeIsOfferLive,
  parseOfferTime as edgeParseOfferTime,
} from "../../supabase/functions/_shared/offerWindow";

const NOW = Date.parse("2026-09-27T16:31:00.000Z");

describe("parseOfferTime", () => {
  it("treats null, blank and unparseable values as no bound", () => {
    expect(parseOfferTime(null)).toBeNull();
    expect(parseOfferTime(undefined)).toBeNull();
    expect(parseOfferTime("")).toBeNull();
    expect(parseOfferTime("not-a-date")).toBeNull();
  });

  it("parses real timestamps", () => {
    expect(parseOfferTime("2026-09-27T16:31:00.000Z")).toBe(NOW);
  });
});

describe("isOfferLive", () => {
  it("is live with no window at all", () => {
    expect(isOfferLive({}, NOW)).toBe(true);
    expect(isOfferLive({ starts_at: null, ends_at: null }, NOW)).toBe(true);
  });

  it("is live inside the window", () => {
    expect(
      isOfferLive(
        { starts_at: "2026-09-20T16:42:15.734Z", ends_at: "2026-10-20T16:42:15.734Z" },
        NOW
      )
    ).toBe(true);
  });

  it("is not live once ends_at has passed", () => {
    // The real double_weekend row: expired 2026-09-23, four days before NOW.
    expect(isOfferLive({ ends_at: "2026-09-23T16:42:15.734Z" }, NOW)).toBe(false);
  });

  it("is not live before starts_at", () => {
    expect(isOfferLive({ starts_at: "2026-09-28T00:00:00.000Z" }, NOW)).toBe(false);
  });

  it("treats the boundaries as inclusive start, exclusive end", () => {
    expect(isOfferLive({ starts_at: "2026-09-27T16:31:00.000Z" }, NOW)).toBe(true);
    expect(isOfferLive({ ends_at: "2026-09-27T16:31:00.000Z" }, NOW)).toBe(false);
    expect(isOfferLive({ ends_at: "2026-09-27T16:31:00.001Z" }, NOW)).toBe(true);
  });

  it("keeps an offer with a malformed timestamp rather than deleting it", () => {
    expect(isOfferLive({ ends_at: "garbage" }, NOW)).toBe(true);
  });

  it("honours a window that has both bounds", () => {
    const window = { starts_at: "2026-09-27T00:00:00.000Z", ends_at: "2026-09-28T00:00:00.000Z" };
    expect(isOfferLive(window, NOW)).toBe(true);
    expect(isOfferLive(window, Date.parse("2026-09-29T00:00:00.000Z"))).toBe(false);
    expect(isOfferLive(window, Date.parse("2026-09-26T00:00:00.000Z"))).toBe(false);
  });
});

// `process-purchase` reads `special_offers` with the SERVICE ROLE, so the RLS
// policy that hides out-of-window rows cannot protect it — it has to check the
// window itself, via `supabase/functions/_shared/offerWindow.ts`. Edge code
// cannot import from `src/` (and the app build must not import from
// `supabase/functions/`), so the check exists twice on purpose. This pins the
// two copies to identical behaviour, the same way `moneyMirror.test.ts` guards
// the generated money catalog.
const WINDOW_CASES: Array<{ starts_at?: string | null; ends_at?: string | null }> = [
  {},
  { starts_at: null, ends_at: null },
  { ends_at: "2026-09-23T16:42:15.734Z" }, // the real, expired double_weekend row
  { ends_at: "2026-09-27T16:31:00.001Z" },
  { ends_at: "2026-09-27T16:31:00.000Z" },
  { starts_at: "2026-09-28T00:00:00.000Z" },
  { starts_at: "2026-09-20T16:42:15.734Z", ends_at: "2026-10-20T16:42:15.734Z" },
  { ends_at: "garbage" },
];

describe("offer window mirror (edge copy agrees)", () => {
  it("decides every case the same way on both sides", () => {
    const decisions = WINDOW_CASES.map((o) => isOfferLive(o, NOW));

    // Guard against a vacuous pass: the cases must include a live and a dead one.
    expect(decisions).toContain(true);
    expect(decisions).toContain(false);

    for (const offer of WINDOW_CASES) {
      expect(edgeIsOfferLive(offer, NOW), JSON.stringify(offer)).toBe(isOfferLive(offer, NOW));
    }
  });

  it("parses timestamps the same way", () => {
    for (const value of [null, undefined, "", "garbage", "2026-09-27T16:31:00.000Z"]) {
      expect(edgeParseOfferTime(value)).toBe(parseOfferTime(value));
    }
  });
});
