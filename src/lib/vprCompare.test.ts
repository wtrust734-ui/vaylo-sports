// ============================================================================
// THE "ONCE PER TARGET" HALF OF THE ELITE COMPARISON PRICE
// ----------------------------------------------------------------------------
// Two things are worth pinning here and neither needs a database:
//
//   * the id an unlock records is the id the screen looks for, so a paid
//     comparison is recognised on the next visit. If those two ever stop
//     agreeing, every revisit charges 2 more credits and the price on the
//     button becomes a lie — silently, because the screen still works.
//
//   * reading the receipts is total. They are written by the server, read on
//     every mount, and an old row without metadata must not throw.
// ============================================================================

import { describe, expect, it } from "vitest";

import { VPR_COMPARE_FEATURE, compareSpendMetadata, paidTargetsFrom } from "./vprCompare";

describe("elite comparison receipts", () => {
  it("round-trips: what a spend records is what the screen reads back", () => {
    const written = compareSpendMetadata("athletics-800m");
    expect(written).toEqual({ elite_id: "athletics-800m" });
    expect(paidTargetsFrom([{ metadata: written }])).toEqual(["athletics-800m"]);
  });

  it("never records the price or the athlete — only which target was bought", () => {
    // The price is the database's to decide (`credit_cost`), and the balance is
    // derived. A receipt that carried either could be read as authoritative.
    expect(Object.keys(compareSpendMetadata("swim-100free"))).toEqual(["elite_id"]);
  });

  it("counts each target once, however many times it was compared", () => {
    expect(
      paidTargetsFrom([
        { metadata: { elite_id: "athletics-100m" } },
        { metadata: { elite_id: "athletics-800m" } },
        { metadata: { elite_id: "athletics-100m" } },
      ]),
    ).toEqual(["athletics-100m", "athletics-800m"]);
  });

  it("is the same feature key the spend is charged to", () => {
    expect(VPR_COMPARE_FEATURE).toBe("vpr_compare");
  });

  it("skips a receipt it cannot read instead of throwing", () => {
    expect(
      paidTargetsFrom([
        { metadata: undefined },
        { metadata: null },
        { metadata: "athletics-100m" },
        { metadata: ["athletics-100m"] },
        { metadata: { elite_id: 42 } },
        { metadata: { elite_id: "" } },
        { metadata: { elite_id: "  " } },
        {},
        { metadata: { elite_id: "athletics-marathon" } },
      ]),
    ).toEqual(["athletics-marathon"]);
  });

  it("returns nothing for an account that has never compared", () => {
    expect(paidTargetsFrom([])).toEqual([]);
  });
});
