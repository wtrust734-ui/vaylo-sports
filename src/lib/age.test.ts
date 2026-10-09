import { describe, it, expect } from "vitest";
import {
  ADULT_AGE,
  MIN_AGE,
  ageBand,
  ageFromDob,
  earliestDob,
  isAdultDob,
  isUnderMinimumAge,
  registrationAgeRefusalReason,
  validateDob,
} from "./age";

const AT = new Date("2026-09-21T12:00:00Z");

describe("age helpers", () => {
  it("has an 18+ sponsor boundary", () => {
    expect(ADULT_AGE).toBe(18);
  });

  it("computes whole years, not date diffs", () => {
    expect(ageFromDob("2008-09-21", AT)).toBe(18); // birthday today
    expect(ageFromDob("2008-09-20", AT)).toBe(18);
    expect(ageFromDob("2008-09-22", AT)).toBe(17); // birthday tomorrow
    expect(ageFromDob("2010-01-01", AT)).toBe(16);
    expect(ageFromDob("1990-12-31", AT)).toBe(35);
  });

  it("treats an unknown or invalid date of birth as not an adult", () => {
    expect(ageFromDob(null, AT)).toBeNull();
    expect(ageFromDob(undefined, AT)).toBeNull();
    expect(ageFromDob("", AT)).toBeNull();
    expect(ageFromDob("not-a-date", AT)).toBeNull();
    expect(isAdultDob(null, AT)).toBe(false);
    expect(isAdultDob("not-a-date", AT)).toBe(false);
    expect(ageBand(null, AT)).toBe("unknown");
  });

  it("flips to adult on the 18th birthday, not before", () => {
    expect(isAdultDob("2008-09-22", AT)).toBe(false);
    expect(isAdultDob("2008-09-21", AT)).toBe(true);
    expect(ageBand("2008-09-22", AT)).toBe("minor");
    expect(ageBand("2008-09-21", AT)).toBe("adult");
  });

  it("handles a 29 February birthday in a non-leap year", () => {
    expect(ageFromDob("2008-02-29", new Date("2026-02-28T12:00:00Z"))).toBe(17);
    expect(ageFromDob("2008-02-29", new Date("2026-03-01T12:00:00Z"))).toBe(18);
  });

  it("rejects implausible input and accepts a blank field", () => {
    expect(validateDob("", AT)).toBeNull(); // optional
    expect(validateDob("2027-01-01", AT)).toMatch(/future/i);
    expect(validateDob("1801-01-01", AT)).toMatch(/year/i);
    expect(validateDob("2000-05-05", AT)).toBeNull();
  });

  it("bounds the earliest accepted date", () => {
    expect(earliestDob(AT)).toBe("1926-09-21");
  });
});

describe("minimum-age floor (legal 13+ rule)", () => {
  it("publishes a 13+ floor, separate from the 18+ adult boundary", () => {
    expect(MIN_AGE).toBe(13);
    expect(MIN_AGE).toBeLessThan(ADULT_AGE);
  });

  it("refuses a declared date of birth under 13", () => {
    expect(isUnderMinimumAge("2014-09-21", AT)).toBe(true); // turned 12 today
    expect(isUnderMinimumAge("2013-09-22", AT)).toBe(true); // 13 tomorrow
    expect(registrationAgeRefusalReason("2014-09-21", AT)).toMatch(/13/);
    expect(registrationAgeRefusalReason("2013-09-22", AT)).toMatch(/13/);
  });

  it("admits the athlete on their 13th birthday, not the day before", () => {
    expect(isUnderMinimumAge("2013-09-21", AT)).toBe(false); // 13 today
    expect(registrationAgeRefusalReason("2013-09-21", AT)).toBeNull();
  });

  it("does not refuse an unknown or invalid date of birth here", () => {
    // That is the separate "we do not know" state reported by validateDob, and
    // treating it as a refusal would block the optional-date-of-birth path.
    expect(isUnderMinimumAge(null, AT)).toBe(false);
    expect(isUnderMinimumAge(undefined, AT)).toBe(false);
    expect(isUnderMinimumAge("", AT)).toBe(false);
    expect(isUnderMinimumAge("not-a-date", AT)).toBe(false);
    expect(registrationAgeRefusalReason(null, AT)).toBeNull();
    expect(registrationAgeRefusalReason("not-a-date", AT)).toBeNull();
  });

  it("lets a 13-to-17-year-old through, since only the 18+ boundary is adult-only", () => {
    expect(registrationAgeRefusalReason("2010-01-01", AT)).toBeNull(); // 16
    expect(registrationAgeRefusalReason("1990-12-31", AT)).toBeNull(); // adult
  });
});
