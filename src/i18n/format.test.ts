// ============================================================================
// THE LOCALE LAYER, WHICH THE UI NOW DEPENDS ON
// ----------------------------------------------------------------------------
// Every date and number on a screen goes through this module (the raw
// `toLocale*` calls it replaced followed the DEVICE locale, so an English phone
// printed English dates in a German app). That makes two properties worth
// pinning, and neither is visible by reading the code:
//
//   * the output follows the language set with setFormattingLocale, not the
//     order the arguments happen to be in;
//   * `formatDateTimeExact` is the drop-in for a bare `toLocaleString()`, so it
//     has to carry the date AND the time — the whole reason it exists rather
//     than reusing the shorter `formatDateTime`.
//
// Assertions compare two locales against each other rather than against a
// literal string: month names and separators belong to ICU, and a test that
// hardcodes "März" fails the day a Node release ships newer locale data.
// ============================================================================

import { afterEach, describe, expect, it } from "vitest";

import { formatDateTimeExact, formatDate, formatNumber, setFormattingLocale } from "./format";

afterEach(() => {
  // Leave the module as the rest of the suite expects to find it.
  setFormattingLocale("en");
});

describe("formats follow the chosen language", () => {
  it("reads a date the way its language reads a date", () => {
    // 4 March 2026 — day and month differ, so the two orders cannot collide.
    const date = new Date(2026, 2, 4);

    setFormattingLocale("en");
    const english = formatDate(date);
    setFormattingLocale("de");
    const german = formatDate(date);

    expect(english).not.toBe(german);
    expect(german).toMatch(/4/);
    expect(german).toMatch(/3/);
  });

  it("reads a number the way its language reads a number", () => {
    setFormattingLocale("en");
    const english = formatNumber(1234.5);
    setFormattingLocale("de");
    const german = formatNumber(1234.5);

    expect(english).not.toBe(german);
    expect(english).toMatch(/1,234/);
    expect(german).toMatch(/1\.234/);
  });
});

describe("formatDateTimeExact", () => {
  it("carries both the date and the time, to the second", () => {
    // What a bare `toLocaleString()` produced, and what every call site swapped
    // for this expects to still be there.
    const formatted = formatDateTimeExact(new Date(2026, 9, 9, 14, 5, 6));

    expect(formatted).toMatch(/2026/);
    // Minutes and seconds read the same on a 12- and a 24-hour clock, so these
    // two hold on any device. The HOUR is not asserted here: `en` resolves to
    // whatever the device speaks, and an en-US device correctly reads "2:05:06
    // PM" where en-GB reads "14:05:06". The clock follows the language, and the
    // test for that is the one below.
    expect(formatted).toMatch(/05/);
    expect(formatted).toMatch(/06/);
    expect(formatted).toMatch(/:/);
    expect(formatted).not.toBe("—");
  });

  it("reads the hour on the locale's clock, not the device default", () => {
    // German reads 14:05 where en-US reads 2:05 PM. Pinning this instead of the
    // device is the reason the module exists.
    setFormattingLocale("de");
    expect(formatDateTimeExact(new Date(2026, 9, 9, 14, 5, 6))).toMatch(/14/);
  });

  it("accepts the ISO strings and millisecond numbers the screens pass it", () => {
    expect(formatDateTimeExact("2026-10-09T14:05:06Z")).toMatch(/2026/);
    expect(formatDateTimeExact(Date.parse("2026-10-09T14:05:06Z"))).toMatch(/2026/);
  });

  it("still marks an unreadable value rather than printing Invalid Date", () => {
    // The screens render this beside a real label ("Samples · …"), so a bad row
    // must read as missing data, not as a crash or a mangled string.
    expect(formatDateTimeExact("not a date")).toBe("—");
    expect(formatDate("not a date")).toBe("—");
  });
});
