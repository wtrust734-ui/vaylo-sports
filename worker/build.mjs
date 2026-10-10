/**
 * Bundles the shared render engine into the worker image.
 *
 * The plan builder lives in supabase/functions/_shared/renderPlan.ts so that the
 * edge functions, the tests and this worker all use ONE definition of what a
 * render is. This script reads it from there directly.
 *
 * WHY THE PATH MATTERS, AND WHY THERE IS A STAMP
 *
 * It used to point at `src/renderPlan.ts` — a copy kept inside the worker. That
 * copy no longer exists, so `npm run build` failed and `dist/renderPlan.mjs` sat
 * unchanged, and the worker kept rendering with an OLD engine while the tests and
 * the edge functions used the new one. The visible symptom was a fix that passed
 * every test and changed nothing in a real export.
 *
 * So the bundle is built from the single source of truth, and the hash of that
 * source is written beside it. `server.mjs` refuses to start when the source is
 * present and no longer matches, which turns a silent stale-bundle render into a
 * message that says what to run.
 */
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, "../supabase/functions/_shared/renderPlan.ts");

mkdirSync(resolve(here, "dist"), { recursive: true });

await build({
  entryPoints: [source],
  outfile: resolve(here, "dist/renderPlan.mjs"),
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  logLevel: "info",
});

const sourceHash = createHash("sha256").update(readFileSync(source)).digest("hex");
writeFileSync(
  resolve(here, "dist/build-info.json"),
  JSON.stringify({ entryPoint: source, sourceHash, builtAt: new Date().toISOString() }, null, 2) + "\n",
);

console.log(`bundled dist/renderPlan.mjs from ${source}`);
console.log(`source hash ${sourceHash.slice(0, 12)}`);
