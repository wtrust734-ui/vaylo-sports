import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Guards the mobile-overflow fixes.
 *
 * This is a static check rather than a render, and the reason is that the
 * failures it catches are invisible in a unit test and obvious on a phone: a
 * card with `min-w-[290px]` inside a 280px column does not throw, does not
 * snapshot differently, and simply draws off the right edge of the screen.
 *
 * The bar it enforces is deliberately narrow. A fixed pixel width is fine when
 * it is either (a) inside a component that scrolls horizontally on purpose, or
 * (b) hidden until a breakpoint where there is room for it. It is not fine
 * when it is an unconditional floor on a box in normal flow, because a flex or
 * grid item's `min-width` wins over its container and takes the whole page
 * wide with it.
 *
 * The allowlist below is the interesting part: it records *why* each surviving
 * fixed width is safe, so a reviewer can check the reasoning rather than trust
 * a number.
 */

const SRC = join(process.cwd(), "src");

/** Skip anything that is generated or vendored. */
const IGNORE_DIRS = new Set(["node_modules", "dist", "build", ".git"]);

const walk = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (IGNORE_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.tsx$/.test(entry.name) && statSync(full).isFile()) out.push(full);
  }
  return out;
};

/**
 * The narrowest phone this app claims to support. 320px is the floor in the
 * brief, and it is the width at which a 290px minimum plus a 20px page gutter
 * stops fitting.
 */
const MIN_VIEWPORT = 320;

/**
 * Escape hatches, matched against the *same JSX line*. A container that scrolls
 * on purpose, or a class that only applies from a breakpoint up, is fine.
 */
const SAFE_ON_LINE = [
  /overflow-x-auto/,
  /overflow-auto/,
  /overflow-x-scroll/,
  // Desktop-only: the element does not exist in the mobile layout at all.
  /\bhidden\b/,
  /\blg:(?!hidden)/,
  /\bsm:(?!hidden)/,
  /\bmd:(?!hidden)/,
  /\bxl:/,
];

/**
 * Fixed widths that are individually fine and are kept for a stated reason.
 * Keyed by file path, value -> reason.
 *
 * Kept short on purpose. Every entry here is a place where a future edit could
 * remove the reason, which is why each one names what would break.
 */
const ALLOWED: Record<string, Record<string, string>> = {
  "components/layout/AppSidebar.tsx": {
    "272": "the desktop aside, which is `hidden lg:flex` — no mobile layout",
  },
  "pages/Avatar.tsx": {
    "520": "decorative ambient-glow circle, `absolute`, inside a wrapper with `overflow-hidden`",
    "300": "decorative ambient-glow circle, `absolute`, inside a wrapper with `overflow-hidden`",
  },
};

/**
 * Strip comments before matching class names.
 *
 * Without this the test fails on the comments that *explain* the fixes — the
 * note in Coach.tsx that says `bottom-tab` was not a real class is a string
 * match for `bottom-tab`. A guard that has to be worded around is a guard that
 * stops being read.
 */
const stripComments = (source: string): string =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

const files = walk(SRC);

describe("mobile overflow regression", () => {
  it("finds source files to scan", () => {
    // A scanner that scanned nothing would report clean, which is the exact
    // failure mode this file exists to prevent.
    expect(files.length).toBeGreaterThan(50);
  });

  it("has no unconditional fixed width wider than the narrowest phone", () => {
    const offenders: string[] = [];

    for (const file of files) {
      const rel = relative(SRC, file).replace(/\\/g, "/");
      const text = readFileSync(file, "utf8");
      const lines = stripComments(text).split("\n");

      lines.forEach((line, i) => {
        // w-[NNNpx], min-w-[NNNpx], max-w-[NNNpx]
        const re = /\b(min-|max-)?w-\[(\d+)px\]/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(line)) !== null) {
          const kind = m[1] ?? "";
          const value = Number(m[2]);

          // A `max-w` can only shrink; it is the one fixed width that cannot
          // push a container wider.
          if (kind === "max-") continue;

          if (value <= MIN_VIEWPORT - 30) continue; // comfortably narrow

          if (SAFE_ON_LINE.some((re2) => re2.test(line))) continue;

          const allowed = ALLOWED[rel];
          if (allowed && allowed[String(value)]) continue;

          offenders.push(
            `${rel}:${i + 1}  ${kind}w-[${value}px] — ` +
              `no overflow container or breakpoint guard on this line`,
          );
        }
      });
    }

    expect(
      offenders,
      `\nFixed pixel widths that can exceed a ${MIN_VIEWPORT}px viewport:\n` +
        offenders.map((o) => `  ${o}`).join("\n") +
        `\n\nEither make it fluid (w-full / a vw fraction / a responsive ` +
        `prefix), or put the horizontal scrolling on the container that is ` +
        `meant to scroll.\n`,
    ).toEqual([]);
  });

  it("does not reintroduce a top safe-area pad next to the root one", () => {
    // The root rule in index.css pads `body` once. A second pad inside
    // AppLayout would double it, which reads as "the app has a huge gap under
    // the status bar" and is the failure this test exists to keep fixed.
    const layout = stripComments(readFileSync(join(SRC, "components/layout/AppLayout.tsx"), "utf8"));
    expect(layout).not.toMatch(/pt-safe-t/);
  });

  it("keeps the AI chat composer clear of the tab bar", () => {
    // `bottom-tab` was never a real Tailwind class, so the composer silently
    // had no bottom offset and sat on top of the navigation. Any future
    // reintroduction of an undefined `bottom-*` token should fail here.
    const coach = stripComments(readFileSync(join(SRC, "pages/Coach.tsx"), "utf8"));
    expect(coach).not.toMatch(/bottom-tab/);
  });

  it("keeps long AI replies wrappable", () => {
    // A long unbroken token in a flex item with the default min-width:auto
    // sets the item's floor and drags the row wider than the screen.
    const coach = readFileSync(join(SRC, "pages/Coach.tsx"), "utf8");
    expect(coach).toMatch(/min-w-0 max-w-\[85%\]/);
  });

  it("does not let a form control set a flex row's minimum width", () => {
    // `flex-1` is shorthand for `flex: 1 1 0%`, which is the *basis*, not a
    // guarantee: flex items keep the CSS default `min-width: auto`, which
    // refuses to shrink below the element's intrinsic width. An `<input>` has
    // a default `size=20`, so a bare `flex-1` input next to a button pushes
    // that button past the right edge of a 320px screen. This was live in
    // Nutrition (the water "Add" button), ChallengeDetail (the "Log" row) and
    // NaturalLanguageGoalInput (the "Parse" button).
    //
    // Elements are matched as whole blocks rather than line by line: the third
    // of those three spreads `<input`, its handlers and its `className` over
    // five lines, and a line-based check silently passed it.
    const offenders: string[] = [];
    const CONTROL = /<(input|textarea|select)\b/g;

    for (const file of files) {
      const rel = relative(SRC, file).replace(/\\/g, "/");
      const text = stripComments(readFileSync(file, "utf8"));

      let m: RegExpExecArray | null;
      while ((m = CONTROL.exec(text)) !== null) {
        // The element ends at the first `/>` (self-closing) or a bare `>` that
        // is not inside a `{...}` expression. Taking the first `/>` or `>` is
        // good enough here: a handler containing `=>` always sits inside a
        // `{...}` expression, and no form control in this app has a `>` in a
        // plain string attribute.
        const tail = text.slice(m.index);
        const end = tail.search(/\/?>/);
        if (end === -1) continue;
        const block = tail.slice(0, end);
        const line = text.slice(0, m.index).split("\n").length;

        const cls = /className=(?:"([^"]*)"|\{`([^`]*)`\})/.exec(block);
        const value = cls ? cls[1] ?? cls[2] ?? "" : "";
        if (!value) continue;
        if (!/\bflex-1\b/.test(value)) continue;
        if (/\bmin-w-0\b/.test(value)) continue;

        offenders.push(
          `${rel}:${line}  <${m[1]}> has flex-1 but no min-w-0 — ` +
            `it will not shrink below its intrinsic width`,
        );
      }
    }

    expect(
      offenders,
      `\nForm controls that will push their row wider than the screen:\n` +
        offenders.map((o) => `  ${o}`).join("\n") +
        `\n\nAdd min-w-0 so the control can actually shrink.\n`,
    ).toEqual([]);
  });

  it("does not use a bare auto-track grid for stacked content", () => {
    // A bare `grid gap-*` produces an `auto` track, and `auto` is sized to the
    // items' *max-content*. `truncate` is `white-space: nowrap`, so a card
    // whose title is truncated still reports the full unwrapped string as its
    // max-content — the track grows past the container and the card is drawn
    // off the right edge. `grid-cols-1` is `minmax(0, 1fr)`, which clamps the
    // track to the container. This was live in the Challenges suggestion
    // cards, where the track measured 301px inside a 263px column.
    //
    // Only an *unprefixed* `grid-cols-*` counts. `md:grid-cols-2` leaves the
    // mobile base as a bare auto track, which is the width that overflows.
    //
    // `grid` combined with `place-items-center` is an icon box, not a layout
    // grid, and is exempt.
    const offenders: string[] = [];
    const BARE_GRID = /className=(?:"([^"]*)"|\{`([^`]*)`\})/g;

    for (const file of files) {
      const rel = relative(SRC, file).replace(/\\/g, "/");
      const lines = stripComments(readFileSync(file, "utf8")).split("\n");

      lines.forEach((line, i) => {
        BARE_GRID.lastIndex = 0;
        let g: RegExpExecArray | null;
        while ((g = BARE_GRID.exec(line)) !== null) {
          const value = g[1] ?? g[2] ?? "";
          if (!/(^|\s)grid(\s|$)/.test(value)) continue;
          if (/(^|\s)grid-cols-/.test(value)) continue;
          if (/place-items-center|place-content|grid-flow/.test(value)) continue;
          // A class list assembled by interpolation cannot be judged
          // textually. The one such case (ArOverlay's metrics HUD) always
          // supplies a `grid-cols-*` at runtime, so its track is already
          // minmax(0, 1fr) and the bare `grid` is only the gap. Re-check this
          // if another interpolated grid appears.
          if (value.includes("${") && /grid-cols-/.test(value)) continue;
          const onlyBreakpoint = /(^|\s)(sm|md|lg|xl|2xl):grid-cols-/.test(value);
          offenders.push(
            `${rel}:${i + 1}  \`grid\` with no base grid-cols-*` +
              (onlyBreakpoint ? " (only a breakpoint variant, so mobile gets an auto track)" : "") +
              ` — the track is sized to max-content and can overflow`,
          );
        }
      });
    }

    expect(
      offenders,
      `\nGrids whose auto track can exceed their container:\n` +
        offenders.map((o) => `  ${o}`).join("\n") +
        `\n\nUse grid-cols-1, which is minmax(0, 1fr).\n`,
    ).toEqual([]);
  });
});
