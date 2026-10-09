// ============================================================================
// APK SCREEN WALKER — dump the accessibility tree of each screen, in order
// ----------------------------------------------------------------------------
// The element inspector (ui.cjs) reads one screen. This drives the app between
// screens and prints a compact layout transcript for each, so the four tab roots
// can be compared for the things that only show up *between* screens: a header
// rhythm that changes, page padding that differs by a few px, a section that
// starts at a different gutter.
//
//   node app-audit-shots/walk.cjs home:122:2210 train:309:2210 ...
//
// Each step is name:tapX:tapY (device px). The tap is optional; without it the
// current screen is dumped as-is.
// ============================================================================

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ADB =
  process.env.ADB ||
  "C:/Users/gemme/AppData/Local/Android/Sdk/platform-tools/adb.exe";
const DPR = 2.625;
const OUT = path.join(__dirname, "walks");
fs.mkdirSync(OUT, { recursive: true });

const adb = (args) =>
  execFileSync(ADB, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const sleep = (ms) => execFileSync(process.execPath, ["-e", `setTimeout(()=>{},${ms})`]);

function dump(name) {
  adb(["shell", "uiautomator", "dump", "/sdcard/ui.xml"]);
  const xml = adb(["shell", "cat", "/sdcard/ui.xml"]);
  fs.writeFileSync(path.join(OUT, `${name}.xml`), xml);
  return xml;
}

function nodes(xml) {
  const out = [];
  const re = /<node\b[^>]*>/g;
  let m;
  while ((m = re.exec(xml))) {
    const tag = m[0];
    const attr = (n) => {
      const a = new RegExp(`\\b${n}="([^"]*)"`).exec(tag);
      return a ? a[1] : "";
    };
    const text = attr("text") || attr("content-desc");
    if (!text) continue;
    const b = /\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/.exec(attr("bounds"));
    if (!b) continue;
    const [x1, y1, x2, y2] = b.slice(1).map(Number);
    if (x2 - x1 <= 0 && y2 - y1 <= 0) continue; // zero-size: hidden/offscreen
    out.push({ text, x1, y1, x2, y2 });
  }
  return out;
}

const c = (v) => (v / DPR).toFixed(1).padStart(5);
const short = (s, n = 46) =>
  s.replace(/&amp;/g, "&").replace(/\s+/g, " ").trim().slice(0, n);

function report(name, xml) {
  const ns = nodes(xml);
  const lines = [`\n================ ${name} — ${ns.length} labelled nodes`];
  const lo = Math.min(...ns.map((n) => n.x1));
  const hi = Math.max(...ns.map((n) => n.x2));
  lines.push(
    `content box: css x ${c(lo)}..${c(hi)}   (viewport 0.0..411.4)  ` +
      `left gap ${(lo / DPR).toFixed(1)}  right gap ${(411.4 - hi / DPR).toFixed(1)}`
  );
  const over = ns.filter((n) => n.x1 < 0 || n.x2 > 1080);
  lines.push(`nodes outside the viewport: ${over.length}`);
  for (const n of over.slice(0, 6)) {
    lines.push(`   ! x ${c(n.x1)}..${c(n.x2)} y ${c(n.y1)}..${c(n.y2)}  ${short(n.text)}`);
  }
  // Group rows by y-band so the vertical rhythm is readable.
  const sorted = [...ns].sort((a, b) => a.y1 - b.y1 || a.x1 - b.x1);
  let lastY = -999;
  for (const n of sorted) {
    const band = Math.abs(n.y1 - lastY) <= 26 ? " " : "|";
    lastY = n.y1;
    lines.push(
      `${band} y ${c(n.y1)}..${c(n.y2)}  x ${c(n.x1)}..${c(n.x2)}  ${short(n.text)}`
    );
  }
  return lines.join("\n");
}

const steps = process.argv.slice(2);
if (!steps.length) {
  console.log("usage: walk.cjs name[:tapX:tapY] ...");
  process.exit(1);
}
const all = [];
for (const step of steps) {
  const [name, tx, ty] = step.split(":");
  if (tx && ty) {
    adb(["shell", "input", "tap", tx, ty]);
    sleep(2600);
  }
  const text = report(name, dump(name));
  all.push(text);
  console.log(text);
}
fs.writeFileSync(path.join(OUT, "transcript.txt"), all.join("\n"));
console.log(`\nwritten to app-audit-shots/walks/transcript.txt`);
