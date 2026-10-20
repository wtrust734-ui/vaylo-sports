// Market discovery helpers (Prompt 10).
//
// The property under test: filtering reorders nothing except owned-last, hides
// nothing that was not asked to be hidden, and never matches a product the
// catalog does not hold. The helper is presentation software for the shop —
// it must not be able to invent, rename or duplicate a product.

import { describe, expect, it } from "vitest";
import {
  entryMatchesQuery,
  filterMarketEntries,
  foldForSearch,
  type CatalogEntryLike,
} from "./marketDiscovery";

const entries: (CatalogEntryLike & { owned?: boolean })[] = [
  { product: "mental_gym", label: "Mental Gym", tagline: "Focus drills for competition", unlocks: ["Breathing tool", "Race mode"] },
  { product: "cross_sport", label: "Cross-Sport Analysis", tagline: "Fit your training across sports", unlocks: ["Biking vs running", "Transfers"] },
  { product: "video_analysis", label: "Video Form Analysis", tagline: "Posture and mechanics from a clip", unlocks: ["24 analyses", "Comparison overlay"] },
  { product: "pattern", label: "Égrégore Routine", tagline: "Accent folding test", unlocks: ["Vocabulary lines"] },
];

const isOwned = (e: CatalogEntryLike) => e.product === "video_analysis";

describe("foldForSearch", () => {
  it("folds diacritics and case, and trims", () => {
    expect(foldForSearch("  ÉCLéctico ")).toBe("eclectico");
    expect(foldForSearch("Café")).toBe("cafe");
  });
});

describe("entryMatchesQuery", () => {
  it("matches the label, tagline and entitlement lines", () => {
    expect(entryMatchesQuery(entries[0], "breathing")).toBe(true);
    expect(entryMatchesQuery(entries[1], "transfers")).toBe(true);
    expect(entryMatchesQuery(entries[2], "posture")).toBe(true);
  });

  it("requires every whitespace-separated term (AND, order-free)", () => {
    expect(entryMatchesQuery(entries[0], "mental gym")).toBe(true);
    expect(entryMatchesQuery(entries[0], "gym mental")).toBe(true);
    expect(entryMatchesQuery(entries[0], "mental transfers")).toBe(false);
  });

  it("is accent-insensitive", () => {
    expect(entryMatchesQuery(entries[3], "egregore")).toBe(true);
    expect(entryMatchesQuery(entries[3], "Égrégore")).toBe(true);
  });

  it("never matches what the catalog does not contain", () => {
    expect(entryMatchesQuery(entries[2], "wallet")).toBe(false);
  });

  it("matches everything for an empty or whitespace query", () => {
    for (const e of entries) expect(entryMatchesQuery(e, "")).toBe(true);
    expect(entryMatchesQuery(entries[0], "   ")).toBe(true);
  });
});

describe("filterMarketEntries", () => {
  it("keeps everything when there is no query on 'all'", () => {
    const out = filterMarketEntries(entries, "", "all", isOwned);
    expect(out.map((e) => e.product)).toEqual([
      "mental_gym", "cross_sport", "pattern", "video_analysis", // owned last
    ]);
  });

  it("respects the status chips", () => {
    expect(filterMarketEntries(entries, "", "owned", isOwned).map((e) => e.product)).toEqual(["video_analysis"]);
    expect(filterMarketEntries(entries, "", "locked", isOwned).map((e) => e.product)).toEqual([
      "mental_gym", "cross_sport", "pattern",
    ]);
  });

  it("combines query + status and keeps owned-last inside the result", () => {
    const ownedToo = { ...entries[0], product: "owned_match" };
    const list = [...entries, ownedToo];
    const out = filterMarketEntries(list, "drill", "all", (e) => e.product === "owned_match" || isOwned(e));
    expect(out.map((e) => e.product)).toEqual(["mental_gym", "owned_match"]);
  });

  it("returns an empty list, never a partial product, for a query that misses", () => {
    expect(filterMarketEntries(entries, "zigzigzag", "all", isOwned)).toEqual([]);
  });
});
