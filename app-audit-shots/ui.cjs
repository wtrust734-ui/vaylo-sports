// ============================================================================
// APK UI INSPECTOR — element bounds read out of the installed release APK
// ----------------------------------------------------------------------------
// WebView DevTools is off in a release build, so the DOM is not reachable. The
// accessibility tree IS: Chromium bridges it to the platform, and
// `uiautomator dump` reads it off the device. That makes this the only way to
// get real element text and bounds from the artifact that actually ships,
// rather than from a browser build that is tuned to the same CSS but is not the
// thing under test.
//
//   node app-audit-shots/ui.cjs dump            refresh ui.xml from the device
//   node app-audit-shots/ui.cjs list [regex]    every labelled node, with bounds
//   node app-audit-shots/ui.cjs find <regex>    matches + a tap point, in source px
//   node app-audit-shots/ui.cjs edges           widest/narrowest content extents
//
// Coordinates: the dump is in device pixels (1080x2400 at 420dpi), so every
// printed css figure is device/2.625 — the same conversion png.cjs uses, which
// is what lets the two tools agree.
// ============================================================================

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ADB =
  process.env.ADB ||
  "C:/Users/gemme/AppData/Local/Android/Sdk/platform-tools/adb.exe";

const XML = path.join(__dirname, "ui.xml");
const DPR = 2.625;

const adb = (args) =>
  execFileSync(ADB, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

function refresh() {
  adb(["shell", "uiautomator", "dump", "/sdcard/ui.xml"]);
  const out = adb(["shell", "cat", "/sdcard/ui.xml"]);
  fs.writeFileSync(XML, out);
  return out;
}

// Always re-read the device. Caching this was a real trap: `find` silently
// returned tap points from whichever screen was dumped last, so a drill into a
// hub that was not the previous screen reported "no match" for a label that was
// plainly on screen.
function load() {
  return refresh();
}

/** Every node that carries a label, in document order. */
function nodes(xml) {
  const out = [];
  const re = /<node\b[^>]*>/g;
  let m;
  while ((m = re.exec(xml))) {
    const tag = m[0];
    const attr = (name) => {
      const a = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
      return a ? a[1] : "";
    };
    const text = attr("text");
    const desc = attr("content-desc");
    if (!text && !desc) continue;
    const b = /\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/.exec(attr("bounds"));
    if (!b) continue;
    const [x1, y1, x2, y2] = b.slice(1).map(Number);
    out.push({
      kind: text ? "text" : "desc",
      label: text || desc,
      x1,
      y1,
      x2,
      y2,
      w: x2 - x1,
      h: y2 - y1,
      cls: attr("class"),
      clickable: attr("clickable") === "true",
    });
  }
  return out;
}

const css = (v) => (v / DPR).toFixed(1);
const clip = (s, n = 42) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

const fmt = (n) =>
  `x=${String(n.x1).padStart(4)}..${String(n.x2).padStart(4)}` +
  ` y=${String(n.y1).padStart(4)}..${String(n.y2).padStart(4)}` +
  ` w=${String(n.w).padStart(4)} h=${String(n.h).padStart(3)}` +
  `  css x=${css(n.x1)}..${css(n.x2)} y=${css(n.y1)}..${css(n.y2)}` +
  `  ${n.clickable ? "[tap]" : "     "} ${n.kind === "desc" ? "@" : " "}${clip(n.label)}`;

const [cmd, ...rest] = process.argv.slice(2);

if (cmd === "dump") {
  const xml = refresh();
  console.log(`ui.xml refreshed — ${nodes(xml).length} labelled nodes`);
} else if (cmd === "list" || cmd === "find") {
  const xml = load();
  const all = nodes(xml);
  const filter = rest[0] ? new RegExp(rest[0], "i") : null;
  const hits = filter ? all.filter((n) => filter.test(n.label)) : all;
  if (!hits.length) console.log("no matches");
  for (const n of hits) {
    console.log(fmt(n));
    if (cmd === "find") {
      const cx = Math.round((n.x1 + n.x2) / 2);
      const cy = Math.round((n.y1 + n.y2) / 2);
      console.log(`        tap ${cx} ${cy}`);
    }
  }
  if (filter) console.log(`${hits.length} of ${all.length} nodes`);
} else if (cmd === "edges") {
  // Where the ink actually stops on each side. A node that reaches the physical
  // edge (x=0 or 1080) is overflowing the layout viewport; a node whose right
  // edge sits well inside the others is a wrapped or mis-sized block.
  const all = nodes(load());
  const lo = Math.min(...all.map((n) => n.x1));
  const hi = Math.max(...all.map((n) => n.x2));
  console.log(`leftmost  x1=${lo} (css ${css(lo)})`);
  console.log(`rightmost x2=${hi} (css ${css(hi)})`);
  const wide = all.filter((n) => n.x2 - n.x1 > 900).slice(0, 12);
  console.log(`\nwidest nodes (${wide.length}):`);
  for (const n of wide) console.log("  " + fmt(n));
  const touching = all.filter((n) => n.x1 <= 0 || n.x2 >= 1080);
  console.log(`\ntouching a physical edge: ${touching.length}`);
  for (const n of touching.slice(0, 8)) console.log("  " + fmt(n));
} else {
  console.log("usage: dump|list [regex]|find <regex>|edges");
  process.exit(1);
}
