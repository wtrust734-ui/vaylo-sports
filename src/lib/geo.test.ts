import { describe, expect, it } from "vitest";
import {
  CONTINENTS,
  COUNTRIES,
  continentFor,
  countriesIn,
  countryByCode,
  countryFlag,
  countryName,
  currencyFor,
  normaliseCountryCode,
} from "@/lib/geo";

describe("country reference data", () => {
  it("has a substantial country list", () => {
    expect(COUNTRIES.length).toBeGreaterThan(180);
  });

  it("uses unique, well-formed ISO alpha-2 codes", () => {
    const codes = COUNTRIES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(code).toMatch(/^[A-Z]{2}$/);
  });

  it("assigns every country to a known continent", () => {
    for (const c of COUNTRIES) expect(CONTINENTS).toContain(c.continent);
  });

  it("gives every country a currency", () => {
    for (const c of COUNTRIES) expect(c.currency).toMatch(/^[A-Z]{3}$/);
  });

  it("has countries in every continent", () => {
    for (const continent of CONTINENTS) expect(countriesIn(continent).length).toBeGreaterThan(0);
  });
});

describe("continentFor", () => {
  // UN M49 groupings. These are the placements an athlete will actually see, so
  // they are pinned explicitly rather than trusted to a lookup.
  it("maps representative countries correctly", () => {
    expect(continentFor("GB")).toBe("Europe");
    expect(continentFor("US")).toBe("North America");
    expect(continentFor("BR")).toBe("South America");
    expect(continentFor("KE")).toBe("Africa");
    expect(continentFor("JP")).toBe("Asia");
    expect(continentFor("AU")).toBe("Oceania");
  });

  it("follows UN M49 for the transcontinental cases", () => {
    // Western Asia rather than Europe, per UN M49 — a deliberate, documented choice.
    expect(continentFor("TR")).toBe("Asia");
    expect(continentFor("IL")).toBe("Asia");
    expect(continentFor("CY")).toBe("Asia");
    // ...and Russia as Eastern Europe.
    expect(continentFor("RU")).toBe("Europe");
  });

  it("is case-insensitive", () => {
    expect(continentFor("gb")).toBe("Europe");
  });

  it("returns null rather than guessing for unknown input", () => {
    expect(continentFor("ZZ")).toBeNull();
    expect(continentFor("")).toBeNull();
    expect(continentFor(null)).toBeNull();
    expect(continentFor(undefined)).toBeNull();
  });
});

describe("normaliseCountryCode", () => {
  it("accepts a code in either case", () => {
    expect(normaliseCountryCode("gb")).toBe("GB");
    expect(normaliseCountryCode(" GB ")).toBe("GB");
  });

  it("accepts a full country name", () => {
    expect(normaliseCountryCode("United Kingdom")).toBe("GB");
    expect(normaliseCountryCode("united states")).toBe("US");
  });

  it("never invents a country", () => {
    // A guessed default would silently file an athlete on the wrong board.
    expect(normaliseCountryCode("Atlantis")).toBeNull();
    expect(normaliseCountryCode("")).toBeNull();
    expect(normaliseCountryCode(null)).toBeNull();
  });
});

describe("helpers", () => {
  it("resolves names and currencies", () => {
    expect(countryName("GB")).toBe("United Kingdom");
    expect(currencyFor("GB")).toBe("GBP");
    expect(currencyFor("JP")).toBe("JPY");
    expect(currencyFor("ZZ")).toBeNull();
    expect(countryByCode("ZZ")).toBeNull();
  });

  it("builds a flag emoji from the code", () => {
    expect(countryFlag("GB")).toBe("🇬🇧");
    expect(countryFlag("US")).toBe("🇺🇸");
  });

  it("falls back to a neutral flag for unknown codes", () => {
    expect(countryFlag("ZZ")).toBe("🏳️");
    expect(countryFlag(null)).toBe("🏳️");
  });
});
