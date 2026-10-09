// ============================================================================
// GENERATES THE OPEN GRAPH CARD
// ----------------------------------------------------------------------------
// Rasterises site/assets/og-card.html to site/assets/og.png at 1200x630, the
// image every page shares as og:image.
//
//   node scripts/gen-og-image.cjs
//
// This is a SOURCE-ASSET step, not a build step, and it is deliberately not
// wired into `npm run site:build`. gen-website.cjs copies og.png out of the
// source tree the same way it copies logo.png, so a build machine — including
// CI, which has no browser — produces the site without rasterising anything.
// Run this by hand when the card's copy or design changes, and commit the PNG.
//
// Why a real browser rather than a canvas library: rendering this card needs
// text shaping with a real font stack, and the card is supposed to look like the
// page it links to. Chrome already exists on the machine that runs the site
// build; a headless browser is the only rasteriser guaranteed to agree with the
// browser a visitor uses about how the type wraps.
//
// ---------------------------------------------------------------------------
// It finds a browser rather than assuming one path. On Windows that is Edge or
// Chrome in either Program Files; on macOS it is the app bundle; on Linux it is
// whatever is on PATH. If none is found it says so and exits non-zero, and the
// committed PNG stays as it is — a stale card is a cosmetic problem, and
// failing the whole site build over it would not be.
// ============================================================================

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const SRC = path.join(root, "site", "assets", "og-card.html");
const OUT = path.join(root, "site", "assets", "og.png");

const WIDTH = 1200;
const HEIGHT = 630;

/** Candidate browser executables, in the order we would rather use them. */
function candidates() {
  const win = [
    process.env["ProgramFiles"] && path.join(process.env["ProgramFiles"], "Google/Chrome/Application/chrome.exe"),
    process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "Google/Chrome/Application/chrome.exe"),
    process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "Microsoft/Edge/Application/msedge.exe"),
    process.env["ProgramFiles"] && path.join(process.env["ProgramFiles"], "Microsoft/Edge/Application/msedge.exe"),
    process.env["LOCALAPPDATA"] && path.join(process.env["LOCALAPPDATA"], "Google/Chrome/Application/chrome.exe"),
  ];
  const mac = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ];
  const linux = ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/microsoft-edge"];
  return [...win, ...mac, ...linux].filter(Boolean);
}

function findBrowser() {
  for (const candidate of candidates()) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/** Read a PNG's IHDR, so the check below is on the real bytes and not on hope. */
function pngSize(file) {
  const bytes = fs.readFileSync(file);
  const signature = bytes.subarray(0, 8).toString("hex");
  if (signature !== "89504e470d0a1a0a") return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function main() {
  if (!fs.existsSync(SRC)) {
    console.error(`gen-og-image: missing ${path.relative(root, SRC)}`);
    process.exit(1);
  }

  const browser = findBrowser();
  if (!browser) {
    console.error(
      "gen-og-image: no Chrome, Edge or Chromium found — install one, or edit the\n" +
        `                card by hand and replace ${path.relative(root, OUT)} yourself.`
    );
    process.exit(1);
  }

  // A throwaway profile, so this cannot touch (or be affected by) a browser the
  // developer is actually using, and so it works on a machine where the default
  // profile is locked by a running window.
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "vaylo-og-"));
  const url = require("node:url").pathToFileURL(SRC).href;

  console.log(`gen-og-image: rendering ${WIDTH}x${HEIGHT} with ${path.basename(browser)}`);

  try {
    execFileSync(
      browser,
      [
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        "--no-first-run",
        "--no-default-browser-check",
        "--force-device-scale-factor=1",
        `--user-data-dir=${profile}`,
        `--window-size=${WIDTH},${HEIGHT}`,
        `--screenshot=${OUT}`,
        url,
      ],
      { stdio: "pipe", timeout: 120_000 }
    );
  } catch (error) {
    console.error(`gen-og-image: the browser failed to render the card.\n${error.message}`);
    process.exit(1);
  } finally {
    fs.rmSync(profile, { recursive: true, force: true });
  }

  const size = pngSize(OUT);
  if (!size) {
    console.error(`gen-og-image: ${path.relative(root, OUT)} is not a PNG`);
    process.exit(1);
  }
  if (size.width !== WIDTH || size.height !== HEIGHT) {
    // Not fatal in itself — some platforms still crop it — but it means the card
    // will be cropped or letterboxed somewhere, so it should not pass silently.
    console.error(
      `gen-og-image: expected ${WIDTH}x${HEIGHT}, got ${size.width}x${size.height}. ` +
        "The window size and the card's own width/height must agree."
    );
    process.exit(1);
  }

  console.log(
    `gen-og-image: wrote ${path.relative(root, OUT)} — ${size.width}x${size.height}, ` +
      `${(fs.statSync(OUT).size / 1024).toFixed(1)} KiB`
  );
}

main();
