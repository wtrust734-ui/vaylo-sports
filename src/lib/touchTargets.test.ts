// Guards the touch-target floor in src/index.css.
//
// Why this test exists: the floor is one CSS rule, and nothing about deleting it
// looks like a mistake — the app still builds, still type-checks, and every unit
// test still passes, because jsdom has no layout engine and therefore cannot
// measure a single control. The rule is the only thing standing between the app
// and the 88 sub-44px controls that `npm run ui:audit` found on Event Packs, so
// it gets a test that fails loudly if it is ever removed or narrowed.
//
// What this test cannot do is verify the effect: it checks that the rule is
// still written down, not that it applies. `npm run ui:check` renders all 46
// routes in Chrome and fails if any control measures under 44px.

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const css = readFileSync("src/index.css", "utf8");

describe("touch-target floor", () => {
  it("keeps a 44px minimum height on real controls", () => {
    const floor = /:where\(([\s\S]*?)\)\s*\{\s*min-height:\s*44px;/m.exec(css);
    expect(floor, "the touch-target floor is missing from src/index.css").not.toBeNull();

    const selectors = floor![1];
    for (const control of [
      "button",
      '[role="button"]',
      '[role="tab"]',
      '[role="switch"]',
      "select",
      "textarea",
    ]) {
      expect(selectors, `${control} fell out of the floor`).toContain(control);
    }
  });

  it("is a floor, not a style: utilities can still override it", () => {
    // `:where()` contributes no specificity, so any min-h-* utility on a
    // component wins. A plain `button { min-height: 44px }` would beat every
    // utility in the app and there would be no way to opt a compact row out.
    const floor = /:where\([\s\S]*?\)\s*\{\s*min-height:\s*44px;/m.exec(css);
    expect(floor).not.toBeNull();
    expect(css).not.toMatch(/^\s*button\s*\{[^}]*min-height/m);
  });

  it("leaves inline prose alone", () => {
    // Text links inside a sentence are not controls. The floor deliberately
    // lists elements rather than sweeping in every bare <a href>, which is what
    // a global `min-height` on anchors would do.
    const floor = /:where\(([\s\S]*?)\)\s*\{\s*min-height:\s*44px;/m.exec(css);
    expect(floor![1]).not.toContain("a[href]");
  });

  it("leaves checkboxes and range inputs at their native size", () => {
    // A 44px-tall checkbox is a worse control, not a better one. The app draws
    // its own switches and toggles for the cases where size matters.
    const floor = /:where\(([\s\S]*?)\)\s*\{\s*min-height:\s*44px;/m.exec(css);
    expect(floor![1]).toContain('input:not([type="checkbox"])');
    expect(floor![1]).toContain('[type="radio"]');
  });
});
