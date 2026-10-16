import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Pins the mobile safe-area contract for the app shell.
 *
 * The failure this guards against is not a crash. `env(safe-area-inset-top)`
 * that resolves to 0px compiles fine, renders fine, passes every unit test,
 * and simply puts the header underneath the status bar on the one device
 * class that matters. It can only be caught by asserting the source, which
 * is what the sibling `overflowLayout.test.ts` and `touchTargets.test.ts`
 * already do for the same reason.
 *
 * The rule being enforced is that there is exactly ONE place insets are
 * resolved (`:root` in index.css) and that everything else consumes the
 * variables. A second `env()` call site is not a style preference: it is a
 * second, subtly different answer to "how tall is the status bar", and
 * Capacitor's SystemBars plugin deliberately zeroes the bottom inset while
 * the keyboard is up, which the two would not agree on.
 */

const read = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");

/** Every .tsx under src/, so a contract can be enforced app-wide. */
const tsxFiles = (dir: string): string[] =>
  readdirSync(resolve(__dirname, "../..", dir), { withFileTypes: true }).flatMap((e) => {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) return tsxFiles(p);
    return e.name.endsWith(".tsx") ? [p] : [];
  });

const ALL_TSX = tsxFiles("src");

/**
 * Drop `/* *\/` and `//` comments, leaving string and template literals intact.
 *
 * Needed because several of the names these tests ban survive inside the
 * comments that explain the bug they caused — and a backtick in prose
 * ("`pt-safe-t` was a dead class") is indistinguishable from a template
 * literal to a regex, which made a naive scan report the warning that
 * documents the fix as the violation.
 *
 * An apostrophe between two word characters is treated as prose, not a string
 * delimiter, because JSX text is not a string and this file is full of it
 * ("Couldn't load your athlete profile"). Without that, the fake string ran
 * on and swallowed the comment behind it. The remaining blind spot is a
 * double quote inside JSX text, which no file here does.
 */
const stripComments = (src: string) => {
  const word = (ch?: string) => !!ch && /[A-Za-z0-9]/.test(ch);
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end === -1 ? src.length : end + 2;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      const end = src.indexOf("\n", i);
      i = end === -1 ? src.length : end;
      continue;
    }
    if (c === '"' || c === "`" || (c === "'" && !(word(src[i - 1]) && word(src[i + 1])))) {
      const quote = c;
      out += c;
      i += 1;
      while (i < src.length) {
        if (src[i] === "\\") {
          out += src.slice(i, i + 2);
          i += 2;
          continue;
        }
        out += src[i];
        i += 1;
        if (src[i - 1] === quote) break;
      }
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
};

/** The string and template literals of a file, comments removed. */
const literals = (src: string) =>
  [...stripComments(src).matchAll(/"([^"]*)"|'([^']*)'|`([^`]*)`/g)].map(
    (m) => m[1] ?? m[2] ?? m[3] ?? "",
  );

const css = read("src/index.css");
const sidebar = read("src/components/layout/AppSidebar.tsx");
const bottomNav = read("src/components/layout/BottomNav.tsx");
const quickAction = read("src/components/layout/QuickActionSheet.tsx");
const bottomSheet = read("src/components/ui/bottom-sheet.tsx");

/** Every source file that participates in the shell's inset handling. */
const SHELL_FILES: Record<string, string> = {
  "src/components/layout/AppSidebar.tsx": sidebar,
  "src/components/layout/BottomNav.tsx": bottomNav,
  "src/components/layout/QuickActionSheet.tsx": quickAction,
  "src/components/ui/bottom-sheet.tsx": bottomSheet,
};

describe("safe-area insets", () => {
  it("resolves each inset once, in :root, preferring Capacitor's injected value", () => {
    // Capacitor 8 auto-registers SystemBars, which injects
    // --safe-area-inset-* from real WindowInsetsCompat. That value leads,
    // native env() is the fallback, and 0 is the last resort.
    for (const side of ["top", "right", "bottom", "left"]) {
      expect(css).toContain(
        `--vaylo-inset-${side}: var(--safe-area-inset-${side}, env(safe-area-inset-${side}, 0px));`,
      );
    }
  });

  it("applies the top inset to the body and nothing else", () => {
    // One root rule, so /auth and /onboarding (which render outside
    // AppLayout) are covered and nothing can double-pad.
    expect(css).toMatch(/body\s*\{[^}]*padding-top:\s*var\(--vaylo-inset-top\)/);
  });

  it("never resolves env() outside index.css", () => {
    // index.css is the only permitted home for the fallback chain.
    const offenders = Object.entries(SHELL_FILES)
      .filter(([, src]) => /env\(safe-area-inset-/.test(src))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it("keeps the body clear of a double bottom inset", () => {
    // The tab bar is position:fixed and anchors itself to the bottom inset.
    // Padding the body as well would lift page content off the floor twice.
    const bodyRule = /body\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(bodyRule).not.toMatch(/padding-bottom/);
  });

  it("keeps the tab bar anchored to the bottom inset, not to a fixed height", () => {
    // Native contract: the bar is full-bleed (`bottom-0`, edge to edge) and
    // consumes the inset as *padding* on its own surface, so the hairline top
    // edge always sits exactly above the gesture bar with no floating gap.
    expect(bottomNav).toContain("fixed inset-x-0 bottom-0");
    expect(bottomNav).toContain("pb-[max(0.5rem,var(--vaylo-inset-bottom))]");
    // A fixed pixel height on the bar or its row is what squashes the icons
    // when the inset grows. The lookbehind keeps `min-h-[56px]` on the
    // buttons — which is a floor, and is fine — from counting as a hit.
    expect(bottomNav).not.toMatch(/(?<![a-z-])h-\[\d+px\]/);
  });

  it("gives the drawer header and footer their own insets", () => {
    expect(sidebar).toContain("pt-[max(1.25rem,var(--vaylo-inset-top))]");
    expect(sidebar).toContain("pb-[max(1rem,var(--vaylo-inset-bottom))]");
  });

  it("has no fixed control in the start-top corner", () => {
    // The mobile hamburger used to live here. It was `position: fixed`, so the
    // body inset never reached it, and it was pinned to a hardcoded top-3 —
    // which put 35 of its 40 pixels behind a 47px notch on all 53 routes
    // (caught by scripts/qa-crawl.mjs). The layout overhaul removed it rather
    // than re-pinning it: a floating control at the top edge is exactly what
    // forced ~50 screens to reserve ~56px of vertical space to stay clear of
    // it. This assertion is the guard that it does not come back.
    expect(sidebar).not.toMatch(/className="fixed[^"]*\btop-\[/);
  });

  it("no longer routes navigation through a row on Profile", () => {
    // This test used to assert the exact opposite: that Profile carried an
    // "Every section" row calling openAppNav(), because that row was the only
    // thing keeping the drawer reachable on a phone. The row was removed on
    // request, so what is pinned now is that it is genuinely gone — not hidden
    // behind a flag — and that removing it did not leave a dangling import or
    // an unused handler behind on the screen.
    //
    // The consequence is deliberate, and this test does not pretend otherwise:
    // nothing else dispatches OPEN_NAV_EVENT, so on a phone the navigation
    // drawer now has no way in. The drawer markup is left in place rather than
    // deleted, because the catalogue it holds is still wanted — it just needs a
    // control that works.
    // Comments are stripped before asserting. The screen documents this change
    // in prose, and that prose necessarily names openAppNav() and the old row
    // label — asserting on the raw file would fail on the explanation rather
    // than on the code, which is the opposite of what is being checked.
    const profile = read("src/pages/Profile.tsx")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(profile).not.toContain("openAppNav");
    expect(profile).not.toContain("Every section");
  });

  it("anchors every screen's first element to the shared top gutter", () => {
    // body carries the status-bar inset (asserted above). This is the *design*
    // gutter layered on top of it, as one token — so a screen cannot drift from
    // its neighbours, and the header removal cannot leave a page sitting flush
    // against the status bar.
    expect(css).toMatch(/--vaylo-screen-top:\s*12px/);
    expect(read("src/pages/Profile.tsx")).toContain("pt-[var(--vaylo-screen-top)]");
    expect(read("src/components/layout/HubPage.tsx")).toContain("pt-[var(--vaylo-screen-top)]");
    expect(read("src/pages/Index.tsx")).toContain("pt-[var(--vaylo-screen-top)]");
  });

  it("stacks the mobile drawer above the tab bar and the action sheet", () => {
    // Both used to be z-50. AppLayout renders AppSidebar before BottomNav, so
    // at equal z-index the tab bar painted over the drawer's footer and
    // stayed tappable on top of an open modal drawer.
    const bracketZ = (src: string, anchor: RegExp) =>
      Number(new RegExp(anchor.source + "[^\\n]*?z-\\[(\\d+)\\]").exec(src)?.[1]);
    const plainZ = (src: string, anchor: RegExp) =>
      Number(new RegExp(anchor.source + "[^\\n]*?\\bz-(\\d+)\\b").exec(src)?.[1]);

    // The drawer is anchored `right-0` since it was moved to slide from the
    // right (the earlier `start-0` anchor now matches the desktop aside,
    // which carries a non-bracketed z-30 and read as NaN here).
    const drawerZ = bracketZ(sidebar, /right-0/);
    const scrimZ = bracketZ(sidebar, /fixed inset-0/);
    const navZ = plainZ(bottomNav, /fixed inset-x-0/);
    const actionScrimZ = bracketZ(quickAction, /fixed inset-0/);
    const actionSheetZ = bracketZ(quickAction, /fixed inset-x-3/);

    expect(drawerZ).toBeGreaterThan(navZ);
    expect(scrimZ).toBeGreaterThan(navZ);
    // Above the quick-action stack too, which is the only other floating
    // layer the drawer can collide with.
    expect(drawerZ).toBeGreaterThan(actionScrimZ);
    expect(drawerZ).toBeGreaterThan(actionSheetZ);
  });

  it("keeps the action button from being squeezed into its neighbours", () => {
    // The button is the most compressible item in the row, so on a narrow
    // phone it would collapse against the Train/Perform labels instead of
    // overlapping them cleanly.
    // The class list gained `press` (touch-down dip) and `z-20` (painted over
    // the tab pill) in the interaction pass; the geometric contract this test
    // exists for is unchanged, so it asserts the parts that must survive: a
    // 56px box, shrink-0, and the lift.
    expect(quickAction).toMatch(/className="[^"]*\bshrink-0[^"]*"/);
    expect(quickAction).toMatch(/className="[^"]*h-\[62px\] w-\[62px\][^"]*\bshrink-0\b[^"]*"/);

    // The lift is 4px, and a top margin on a centred flex item moves it by
    // *half* the margin — so the class has to be -mt-2 (8px), not -mt-6.
    // This assertion used to demand -mt-6, which is what shipped: it lifted
    // the centre 12px, three times the documented 4, and pushed the button's
    // top edge ~6px outside the bar's own surface. Measured in the release APK
    // at 411x914: button box y816..873, bar y822..891.
    const lift = Number(/-mt-(\d)/.exec(quickAction)?.[1]);
    const marginPx = (lift === 0 ? 0 : lift) * 0.25 * 16; // n * 4px (Tailwind scale)
    expect(marginPx).toBe(8);
    expect(marginPx / 2).toBe(4);
  });

  it("centres the action button between two equal-width tab groups", () => {
    // The button is the app's primary action, so it has to sit on the bar's
    // centre line. It does not when the four tabs are siblings of it: with
    // `justify-around` an item's position depends on its own width, and
    // "Perform" and "Profile" are wider than "Home" and "Train". Measured in
    // the release APK at 411x914, that put the button's centre at x=191.3 while
    // the bar it sits in was centred at x=205.7 — 14px off-centre.
    //
    // Two `flex-1` groups make the space either side equal whatever the labels
    // say, so the button is centred by construction rather than by luck.
    //
    // Matched on the contract, not on a literal class string: the groups also
    // carry `min-w-0` now (so they can shrink on a 320px phone), and a test that
    // demands one exact class list fails on a change that keeps the guarantee.
    // What must survive is that exactly two `flex-1` groups carry the
    // `justify-around` tab row.
    const groups =
      bottomNav.match(/<div className="[^"]*\bflex-1\b[^"]*\bjustify-around\b[^"]*"/g) ?? [];
    expect(groups).toHaveLength(2);

    // Left group → button → right group, in that order. Matched on the JSX
    // call sites, not the bare names: `indexOf("QuickActionSheet")` finds the
    // import at the top of the file, which is above everything.
    const order = ["LEFT.map((item)", "<QuickActionSheet />", "RIGHT.map((item)"].map((s) =>
      bottomNav.indexOf(s)
    );
    expect(order[0]).toBeGreaterThan(-1);
    expect(order[1]).toBeGreaterThan(order[0]);
    expect(order[2]).toBeGreaterThan(order[1]);
  });

  it("leaves each half of the tab row real slack on a 320px phone", () => {
    // Full-bleed bar: 320 - 16 (px-2) = 304px of content box, split as
    // [left group][56px button][right group] with the row's own 4px gaps.
    // The button keeps its natural width, so each group gets
    // (304 - 56 - 8) / 2 = 120px for two tabs and one gap.
    const rowGap = Number(/flex items-stretch gap-(\d)/.exec(bottomNav)?.[1]);
    const groupGap = Number(/justify-around gap-(\d)/.exec(bottomNav)?.[1]);
    const minW = Number(/min-w-\[(\d+)px\]/.exec(bottomNav)?.[1]);
    const actionW = Number(/h-\[60px\] w-\[60px\]/.test(quickAction) ? 60 : 0);

    expect(minW).toBeGreaterThanOrEqual(44); // touchTargets floor
    expect(groupGap).toBeGreaterThanOrEqual(0);
    const group = (304 - actionW - 2 * rowGap) / 2;
    expect(2 * minW + groupGap).toBeLessThanOrEqual(group);

    // The arithmetic above is necessary but was NOT sufficient, and the app
    // shipped the difference: it models a tab as `min-w` wide, while a tab's
    // real width came from its label — a nowrap "Perform" at 12px with
    // tracking-widest is ~59px, plus 16px of padding — so four tabs needed
    // ~364px inside the 280px box. The row spilled past the screen and the
    // Profile tab was drawn 15px off the right edge, half untappable, on every
    // 320px phone. Measured, not guessed: `npm run ui:audit` at 320x568.
    //
    // What makes the arithmetic true for the real content is that a tab can
    // shrink to its floor and clip instead of pushing: `flex-1` to share its
    // group, `min-w-[48px]` to hold the touch floor, `overflow-hidden` so the
    // worst case is an ellipsis rather than an element outside the viewport.
    const navButton = bottomNav.slice(bottomNav.indexOf("const NavButton"));
    const navButtonClass = /className="(press relative flex[^"]*)"/.exec(navButton)?.[1] ?? "";
    expect(navButtonClass, "NavButton className not found").not.toBe("");
    expect(navButtonClass).toContain("flex-1");
    expect(navButtonClass).toContain("min-w-[48px]");
    expect(navButtonClass).toContain("overflow-hidden");
    // And the label has to be the thing that truncates, not the button that
    // overflows: `w-full` measures it against the tab, `truncate` ellipsises.
    expect(navButton).toMatch(/className=\{`[^`]*\bw-full\b[^`]*\btruncate\b[^`]*`\}/);
  });
});

/* ---------------------------------------------------------------------------
 * The floating tab bar is the thing everything else has to dodge.
 *
 * Measured in-browser at 390x844 with 47px/34px insets injected (the values a
 * notched Android phone reports), the bar's card occupies 34-99px above the
 * floor and its centre action button reached 107px — the button poked above
 * the card, so the stack the bottom-anchored chrome has to clear is the
 * button's top, not the card's. That 107px is kept as the clearance budget on
 * purpose even though the button was brought inside the card later (the -mt-2
 * lift below): the budget is a worst case, and every offset already derived
 * from it stays valid rather than needing to move with it.
 * ------------------------------------------------------------------------ */

/** Page chrome that deliberately floats above the bar rather than under it. */
const BOTTOM_BARS = [
  "src/components/ads/CreditWarning.tsx",
  "src/pages/EventPacks.tsx",
  "src/pages/Coach.tsx",
];

/** Full-width sheets whose primary action sits at the very bottom. */
const BOTTOM_SHEETS = [
  "src/pages/Avatar.tsx",
  "src/pages/Challenges.tsx",
  "src/components/market/CreditTopUpSheet.tsx",
];

describe("floating tab bar clearance", () => {
  it("clears the bar's real height, not a guessed constant", () => {
    // Derived from the measured stack rather than a magic number, so if the
    // row grows a padding step or the action button's negative margin changes,
    // this fails here instead of on a phone.
    const REM_PX = 16;
    // The nav card's rendered height after the M3 re-proportion: 64px tab
    // floor + 6px pt + 8px padding floor = 78px, 90px with a 34px inset...
    // rounded up to the measured worst case the budget below uses.
    const CARD_H = 90;
    // How far the action button rises above the card. This was 8 while the
    // button carried `-mt-6`; `-mt-2` brought its top edge ~1.5px *inside* the
    // card (measured on the release APK: button y824.4..880.0 against a card at
    // y822.9..889.5). The 60px FAB still sits between the groups with the same
    // -mt-2, so the honest value is 0; it is kept at the pre-fix 8 as slack —
    // the assertion below is a budget, and a future lift is caught here.
    const FAB_PROUD = 8;
    const BAR_FLOOR = 8; // max(0.5rem, inset) with no inset, i.e. every browser
    const WORST_INSET = 34; // a gesture-bar inset

    // With an inset the bar's top is inset + CARD_H, so an offset of
    // inset + 7rem clears it by 7rem - CARD_H.
    expect(7 * REM_PX).toBeGreaterThanOrEqual(CARD_H);
    // With no inset the bar sits BAR_FLOOR up, and the same expression is
    // compared against the full stack including the button.
    expect(7 * REM_PX).toBeGreaterThanOrEqual(BAR_FLOOR + CARD_H + FAB_PROUD);
  });

  it("anchors every bottom bar to the inset instead of a hardcoded offset", () => {
    // `bottom-20` (80px) and `bottom-24` (96px) both landed inside the bar.
    for (const p of BOTTOM_BARS) {
      const src = read(p);
      expect(src, p).toContain("bottom-[calc(var(--vaylo-inset-bottom)+7rem)]");
      expect(src, p).not.toMatch(/className="[^"]*\bfixed\b[^"]*\bbottom-(?:20|24)\b/);
    }
  });

  it("keeps the stored-preferences notice out from under the terms banner", () => {
    // Both notices are `position: fixed` in the same corner and neither knows
    // about the other. Measured at 390x844 the terms banner occupied 431-756px
    // and the cookie notice 626-764px, so 130px of the notice was painted under
    // the banner and its text showed through the banner's translucent card.
    //
    // The notice now adds `--vaylo-notice-lift`, which nothing but the banner
    // publishes (its own measured height), so the two cannot be drawn over each
    // other whatever either one's copy wraps to. jsdom cannot see any of this —
    // it has no layout — which is why it is asserted as wiring.
    const cookie = read("src/components/CookieNotice.tsx");
    expect(cookie).toContain("bottom-[calc(var(--vaylo-inset-bottom)+7rem+var(--vaylo-notice-lift))]");
    expect(cookie).not.toMatch(/className="[^"]*\bbottom-20\b/);

    const terms = read("src/components/legal/TermsChangeNotice.tsx");
    expect(terms).toContain('setProperty("--vaylo-notice-lift"');
    expect(terms).toContain('removeProperty("--vaylo-notice-lift")');
    expect(read("src/index.css")).toContain("--vaylo-notice-lift: 0px;");
  });

  it("keeps bottom sheets and their primary actions above the home indicator", () => {
    for (const p of BOTTOM_SHEETS) {
      expect(read(p), p).toContain("var(--vaylo-inset-bottom)");
    }
  });

  it("gives the Coach side panels their own top and bottom insets", () => {
    // `top-0 bottom-0` panels are outside the body's inset padding entirely:
    // the header sat under the status bar and the last row under the gesture
    // bar, on a 288px-wide panel that holds the only way to close them.
    const coach = read("src/pages/Coach.tsx");
    expect(coach).toContain("pt-[max(1rem,var(--vaylo-inset-top))]");
    expect(coach).toContain("pb-[max(0.75rem,var(--vaylo-inset-bottom))]");
  });

  it("never lets an in-page overlay claim the tab bar's own z-50 slot", () => {
    // BottomNav is a later sibling of <main>, so at equal z-index it paints
    // over anything a page renders. A modal on z-50 therefore opened with a
    // bright, fully tappable tab bar sitting on top of its own scrim.
    const offenders = ALL_TSX.filter((p) => p !== "src/components/layout/BottomNav.tsx").filter((p) =>
      /className="[^"]*\bfixed\b[^"]*\bz-50\b/.test(stripComments(read(p))),
    );
    expect(offenders).toEqual([]);
  });

  it("defaults the shared bottom sheet above the tab bar too", () => {
    // The primitive's `z` default is what every caller gets, and three live
    // sheets use it. A default of z-50 put the bar over their footers.
    expect(bottomSheet).toContain('z = "z-[59]"');
  });

  it("uses no dead inset utility classes anywhere in src/", () => {
    // `pt-safe-t`, `bottom-tab` and friends are not in the Tailwind scale and
    // not defined in index.css, so `bottom: bottom-tab` is invalid CSS and the
    // declaration is dropped silently. OfflineBanner carried `pt-safe-t` for
    // the whole safe-area phase and its text sat under the status bar.
    //
    // Only string literals are scanned: several of these dead names survive in
    // comments explaining the very bug this guards against, and a comment
    // cannot reach the DOM.
    const dead = /\b(?:pt|pb|pl|pr|px|py|top|bottom|left|right|start|end)-(?:safe-[trbl]|tab)\b/;
    const offenders = ALL_TSX.filter((p) => literals(read(p)).some((s) => dead.test(s)));
    expect(offenders).toEqual([]);
  });
});
