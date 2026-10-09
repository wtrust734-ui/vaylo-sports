// ============================================================================
// APK DRILLER — navigate by accessible label, then report the screen's layout
// ----------------------------------------------------------------------------
// Getting to a detail screen used to mean reading coordinates off a screenshot
// and hoping. Every navigable surface in this app carries an accessible label
// (the tiles use `aria-label="{label} — {description}"`), so the accessibility
// tree already contains a tap map. This walks it.
//
//   node app-audit-shots/drill.cjs "Perform" "Goals"
//   node app-audit-shots/drill.cjs --report-only
//
// Each argument is a regex matched against a *clickable* node's label; the first
// match is tapped. Use `--back` to press the Android back button between steps.
//
// The report is deliberately about the things a person notices and a unit test
// cannot: where the content box sits relative to the viewport, whether anything
// is painted outside it, and whether any control is too small to hit.
// ============================================================================

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ADB =
  process.env.ADB ||
  "C:/Users/gemme/AppData/Local/Android/Sdk/platform-tools/adb.exe";
const DPR = 2.625;
const VIEWPORT = 411.4;
const OUT = path.join(__dirname, "walks");
fs.mkdirSync(OUT, { recursive: true });

const adb = (args) =>
  execFileSync(ADB, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const wait = (ms) =>
  execFileSync(process.execPath, ["-e", `setTimeout(()=>{},${ms})`]);

function read() {
  adb(["shell", "uiautomator", "dump", "/sdcard/ui.xml"]);
  const xml = adb(["shell", "cat", "/sdcard/ui.xml"]);
  const out = [];
  const re = /<node\b[^>]*>/g;
  let m;
  while ((m = re.exec(xml))) {
    const tag = m[0];
    const attr = (n) => {
      const a = new RegExp(`\\b${n}="([^"]*)"`).exec(tag);
      return a ? a[1] : "";
    };
    const label = attr("text") || attr("content-desc");
    if (!label) continue;
    const b = /\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/.exec(attr("bounds"));
    if (!b) continue;
    const [x1, y1, x2, y2] = b.slice(1).map(Number);
    if (x2 - x1 <= 0 && y2 - y1 <= 0) continue;
    out.push({
      label,
      x1,
      y1,
      x2,
      y2,
      w: (x2 - x1) / DPR,
      h: (y2 - y1) / DPR,
      clickable: attr("clickable") === "true",
    });
  }
  return out;
}

const c = (v) => (v / DPR).toFixed(1);
const short = (s, n = 60) =>
  s.replace(/&amp;/g, "&").replace(/\s+/g, " ").trim().slice(0, n);

function report(name, ns) {
  const L = [`\n================ ${name}  (${ns.length} labelled nodes)`];
  // The content box: the extremes of everything actually painted.
  const lo = Math.min(...ns.map((n) => n.x1));
  const hi = Math.max(...ns.map((n) => n.x2));
  const excludedBottom = ns.filter((n) => n.y1 > 800 * DPR); // nav bar / FAB zone
  const body = ns.filter((n) => !excludedBottom.includes(n));
  const bodyLo = body.length ? Math.min(...body.map((n) => n.x1)) : lo;
  const bodyHi = body.length ? Math.max(...body.map((n) => n.x2)) : hi;
  L.push(
    `  gutters: left ${c(bodyLo)}  right ${(VIEWPORT - bodyHi / DPR).toFixed(1)}` +
      `   (body x ${c(bodyLo)}..${c(bodyHi)})`
  );
  const over = ns.filter((n) => n.x1 < 0 || n.x2 > 1080);
  if (over.length) {
    L.push(`  OUTSIDE VIEWPORT: ${over.length}`);
    for (const n of over) L.push(`    ! x ${c(n.x1)}..${c(n.x2)}  ${short(n.label)}`);
  }
  // Controls below the 44px touch floor the repo's own test enforces.
  const small = ns.filter(
    (n) => n.clickable && (n.w < 44 || n.h < 44) && n.y1 < 800 * DPR
  );
  if (small.length) {
    L.push(`  small tap targets (<44px): ${small.length}`);
    for (const n of small.slice(0, 8)) {
      L.push(`    ! ${c(n.x1)}..${c(n.x2)} x ${n.h.toFixed(0)}h  ${short(n.label, 34)}`);
    }
  }
  // Column structure: the distinct left edges in the body, most common first.
  const tally = new Map();
  for (const n of body) tally.set(c(n.x1), (tally.get(c(n.x1)) ?? 0) + 1);
  const cols = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  L.push(
    `  left edges: ` + cols.map(([x, n]) => `${x}px×${n}`).join("  ")
  );
  // Header rhythm: the first few nodes, which is where a missing eyebrow or a
  // different top gutter shows up.
  const top = [...ns].sort((a, b) => a.y1 - b.y1).slice(0, 4);
  L.push(`  top: ` + top.map((n) => `y${c(n.y1)} "${short(n.label, 22)}"`).join(" | "));
  return L.join("\n");
}

const args = process.argv.slice(2).filter((a) => a !== "--back");
const pressBack = process.argv.includes("--back");
const screens = [];

if (!args.length) {
  console.log(report("current", read()));
} else {
  for (const want of args) {
    if (want === "--back") continue;
    const ns = read();
    const re = new RegExp(want, "i");
    const hit = ns.find((n) => n.clickable && re.test(n.label));
    if (!hit) {
      console.log(`\n!! no clickable node matching /${want}/ — dumping what is here`);
      console.log(report("stuck", ns));
      screens.push(report("stuck", ns));
      break;
    }
    const cx = Math.round((hit.x1 + hit.x2) / 2);
    const cy = Math.round((hit.y1 + hit.y2) / 2);
    console.log(`\n--> tap /${want}/ at ${cx},${cy}  ("${short(hit.label, 40)}")`);
    adb(["shell", "input", "tap", String(cx), String(cy)]);
    wait(2800);
    const after = read();
    const text = report(want, after);
    console.log(text);
    screens.push(text);
  }
  fs.writeFileSync(path.join(OUT, "drill.txt"), screens.join("\n"));
  console.log(`\nwritten to app-audit-shots/walks/drill.txt`);
}
