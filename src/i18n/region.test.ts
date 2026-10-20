// Regional terminology (Prompt 9).
//
// The two properties everything here protects: the STORED sport name is
// canonical (translation never reaches a record, filter or AI payload), and
// the DISPLAYED name follows the selected country. Football and American
// football are different sports under every region, and unit conversion is
// display-only — the stored values are never rewritten.

import { beforeEach, describe, expect, it } from "vitest";
import {
  canonicaliseSportName,
  regionSpelling,
  setRegionCountry,
  sportDisplayName,
} from "./region";
import {
  displayDistance,
  displayWeight,
  kmToMiles,
  kgToLbs,
  lbsToKg,
  milesToKm,
  paceUnitLabel,
} from "./units";
import { getLocale, refreshFormattingLocale, setFormattingLocale } from "./format";

beforeEach(() => setRegionCountry(null));

describe("sportDisplayName", () => {
  it("defaults to the canonical name everywhere", () => {
    expect(sportDisplayName("Football", "GB")).toBe("Football");
    expect(sportDisplayName("Football", "DE")).toBe("Football");
    expect(sportDisplayName("Football", "XX")).toBe("Football");
  });

  it("uses the region's everyday name for association football", () => {
    expect(sportDisplayName("Football", "US")).toBe("Soccer");
    expect(sportDisplayName("Football", "CA")).toBe("Soccer");
    expect(sportDisplayName("Football", "AU")).toBe("Soccer");
    expect(sportDisplayName("Football", "IE")).toBe("Soccer");
  });

  it("honours the module-level region set from the profile", () => {
    setRegionCountry("US");
    expect(sportDisplayName("Football")).toBe("Soccer");

    setRegionCountry("GB");
    expect(sportDisplayName("Football")).toBe("Football");
  });

  it("never renames American football in any region", () => {
    for (const c of ["US", "GB", "AU", "DE"]) {
      expect(sportDisplayName("American Football", c)).toBe("American Football");
    }
  });

  it("passes unknown sports through untouched", () => {
    expect(sportDisplayName("Cricket")).toBe("Cricket");
    expect(sportDisplayName("MMA / Boxing", "US")).toBe("MMA / Boxing");
    expect(sportDisplayName("CrossFit", "US")).toBe("CrossFit");
  });

  it("handles a missing sport name", () => {
    expect(sportDisplayName(null)).toBe("");
    expect(sportDisplayName("  ")).toBe("");
  });
});

describe("canonicaliseSportName", () => {
  it("maps regional aliases to one canonical sport — no duplicates", () => {
    // "Soccer" (US) and "Football" (UK) are the SAME stored sport.
    expect(canonicaliseSportName("Soccer")).toBe("Football");
    expect(canonicaliseSportName("Football")).toBe("Football");
    expect(canonicaliseSportName("  soccer ")).toBe("Football");
  });

  it("keeps the two footballs distinct — never merged into one sport", () => {
    expect(canonicaliseSportName("American Football")).toBe("American Football");
    expect(canonicaliseSportName("Gridiron")).toBe("American Football");
    expect(canonicaliseSportName("Football")).not.toBe(canonicaliseSportName("American Football"));
  });

  it("never invents a sport", () => {
    expect(canonicaliseSportName("Underwater Hockey")).toBeNull();
    expect(canonicaliseSportName("")).toBeNull();
    expect(canonicaliseSportName(null)).toBeNull();
  });
});

describe("regionSpelling", () => {
  it("gives UK-style spelling by default and for GB", () => {
    expect(regionSpelling("GB").programme).toBe("Programme");
    expect(regionSpelling(undefined).style).toBe("uk");
  });

  it("gives US-style spelling for the US", () => {
    expect(regionSpelling("US").programme).toBe("Program");
    expect(regionSpelling("US").metre).toBe("Meter");
    expect(regionSpelling("US").style).toBe("us");
  });
});

describe("units — display conversions", () => {
  it("keeps metric for the default and GB regions", () => {
    expect(displayDistance(10, "GB")).toEqual({ value: 10, unit: "km", label: "10 km" });
    expect(displayWeight(80, "GB")?.label).toBe("80 kg");
  });

  it("converts to imperial for the US", () => {
    const d = displayDistance(10, "US");
    expect(d?.unit).toBe("mi");
    expect(d?.label).toBe("6.21 mi");

    const w = displayWeight(80, "US");
    expect(w?.unit).toBe("lb");
    expect(w?.label).toBe("176.4 lb");

    expect(paceUnitLabel("US")).toBe("min / mile");
    expect(paceUnitLabel("GB")).toBe("min / km");
  });

  it("returns null for missing values instead of a converted zero", () => {
    expect(displayDistance(null)).toBeNull();
    expect(displayWeight(undefined)).toBeNull();
    expect(kmToMiles(null)).toBeNull();
    expect(kgToLbs(NaN)).toBeNull();
  });

  it("round-trips accurately enough to re-record a converted number", () => {
    // 10 km → 6.21 mi → back within a rounding hair of 10 km.
    const back = milesToKm(kmToMiles(10)!);
    expect(Math.abs((back ?? 0) - 10)).toBeLessThan(0.005);

    const lbBack = lbsToKg(kgToLbs(80)!);
    expect(Math.abs((lbBack ?? 0) - 80)).toBeLessThan(0.001);
  });

  it("never mutates the input: conversions are pure functions", () => {
    const km = 42.195;
    kmToMiles(km);
    displayWeight(75, "US");
    expect(km).toBe(42.195);
  });
});

describe("formatting locale follows the selected country", () => {
  it("binds the language to the selected region", () => {
    setFormattingLocale("en");
    setRegionCountry("GB");
    refreshFormattingLocale();
    expect(getLocale()).toBe("en-GB");

    setRegionCountry("US");
    refreshFormattingLocale();
    expect(getLocale()).toBe("en-US");
  });

  it("falls back cleanly when no region is confirmed", () => {
    setFormattingLocale("de");
    setRegionCountry(null);
    refreshFormattingLocale();
    expect(getLocale()).toBe("de");
  });

  it("rejects malformed region codes rather than inventing a locale", () => {
    setFormattingLocale("de");
    setRegionCountry("GBR"); // three letters — not ISO alpha-2
    refreshFormattingLocale();
    expect(getLocale()).toBe("de");

    setRegionCountry("12");
    refreshFormattingLocale();
    expect(getLocale()).toBe("de");
  });
});
