// ============================================================================
// TOP-GAP PROBE — where does the first line of content actually start?
// ----------------------------------------------------------------------------
// The accessibility tree gives a text node a box whose height depends on its
// font metrics, so comparing two screens' first nodes compares their fonts, not
// their gutters. This reads the pixels instead: the status bar is a bright band
// at the very top, and everything below it until the first run of ink is the
// screen's top gap.
//
//   node app-audit-shots/topgap.cjs r-home.png r-train.png ...
//
// Column range, so the probe can ignore a right-hand scrollbar thumb.
// ============================================================================

const { decode, lum } = require("./png.cjs");

const DPR = 2.625;
const X0 = 0;
const X1 = 1040; // ignore the scrollbar strip on the right

/** Modal luminance of a region: the page background dominates a screenshot. */
function background(img) {
  const hist = new Int32Array(256);
  for (let y = 60; y < img.height - 60; y++)
    for (let x = X0; x < X1; x++) hist[Math.round(lum(img, x, y))]++;
  let best = 0;
  for (let i = 1; i < 256; i++) if (hist[i] > hist[best]) best = i;
  return best;
}

/** Rows with ink: >= `minRun` pixels brighter than bg + tol, held for 2 rows. */
function inkRows(img, fromY, toY, bg, tol, minRun) {
  const rows = [];
  for (let y = fromY; y < Math.min(toY, img.height); y++) {
    let n = 0, lo = -1, hi = -1;
    for (let x = X0; x < X1; x++) {
      if (lum(img, x, y) > bg + tol) {
        if (lo < 0) lo = x;
        hi = x;
        n++;
      }
    }
    rows.push({ y, n, lo, hi });
  }
  return rows;
}

const css = (v) => (v / DPR).toFixed(1).padStart(5);

for (const file of process.argv.slice(2)) {
  const img = decode(file);
  const bg = background(img);
  const rows = inkRows(img, 0, 320, bg, 16, 6);

  // The status bar: the first band of ink. It ends at the last row of that band
  // before 8 consecutive empty rows.
  let i = 0;
  while (i < rows.length && rows[i].n < 6) i++;
  const barStart = i < rows.length ? rows[i].y : null;
  let gapStart = i;
  while (gapStart < rows.length && rows[gapStart].n >= 6) gapStart++;
  let empty = 0;
  while (gapStart + empty < rows.length && rows[gapStart + empty].n < 6) empty++;
  const barEnd = gapStart > 0 ? rows[gapStart - 1].y : null;

  // The first content ink: the next run after the status bar that is at least
  // two rows tall (a one-row blip is antialiasing, not a line of text).
  let content = null;
  for (let k = gapStart; k < rows.length - 1; k++) {
    if (rows[k].n >= 6 && rows[k + 1].n >= 6) { content = rows[k]; break; }
  }

  console.log(`\n=== ${file}  ${img.width}x${img.height}  bg lum ${bg}`);
  console.log(
    `status bar   y ${barStart}..${barEnd}   css ${css(barStart)}..${css(barEnd)}` +
      `   (band ${((barEnd - barStart + 1) / DPR).toFixed(1)} css tall)`
  );
  if (content) {
    console.log(
      `first content y ${content.y}  css ${css(content.y)}` +
        `   x ${content.lo}..${content.hi}  css x ${css(content.lo)}..${css(content.hi)}`
    );
    console.log(
      `top gap below status bar: ${((content.y - barEnd - 1) / DPR).toFixed(1)} css` +
        `   (from status-bar top: ${(content.y / DPR).toFixed(1)} css)`
    );
  } else {
    console.log("no content ink found in the first 320 rows");
  }
}
