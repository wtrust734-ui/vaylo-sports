/* ============================================================================
   Vaylo Sports — ad build
   Inlines core.css + core.js into every ad so each ad becomes ONE portable
   .html file: openable from a desktop, emailable to an editor, uploadable to
   Figma/Frame.io, and servable by anything without a dependency graph.

   Source of truth is ads/adN-*.html (they <link>/<script> core.* for live
   editing in an editor with a local server). Never hand-edit dist/.
     node ads/build.mjs
   ========================================================================== */

import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, 'dist');

const css = await readFile(join(here, 'core.css'), 'utf8');
const js = await readFile(join(here, 'core.js'), 'utf8');

const SRC_RE = /<link rel="stylesheet" href="\.?\/?core\.css" \/>/;
const JS_RE = /<script src="\.?\/?core\.js"><\/script>/;

function inline(html) {
  if (!SRC_RE.test(html)) throw new Error('core.css link tag not found — did the ad file change?');
  if (!JS_RE.test(html)) throw new Error('core.js script tag not found — did the ad file change?');
  return html
    .replace(SRC_RE, `<style>\n${css}\n</style>`)
    .replace(JS_RE, `<script>\n${js}\n</script>`);
}

await mkdir(dist, { recursive: true });

const files = (await readdir(here)).filter((f) => /^ad\d.*\.html$/.test(f)).sort();
if (files.length === 0) throw new Error('no ad files found in ads/');

const manifest = [];
for (const f of files) {
  const html = await readFile(join(here, f), 'utf8');
  const out = inline(html);
  const dest = join(dist, f);
  await writeFile(dest, out, 'utf8');
  manifest.push({ file: f, kb: Math.round(out.length / 1024) });
}

/* ---- keyframe contact sheets -------------------------------------------
   Each ad's own beat ruler is the shot list, so pull the cuts straight out of
   the built file and render the ad frozen on each one. This is the storyboard
   a director would shoot from, generated from the same data the ad runs on —
   it can never drift from the edit. */
function beatsOf(html) {
  const block = html.match(/\[\[\s*0\s*,\s*'([^']+)'?\][\s\S]*?\.forEach\(\(\[t, l\]\) => ad\.beat\(t, l\)\)/);
  if (!block) return [];
  return [...block[0].matchAll(/\[\s*([\d.]+)\s*,\s*'([^']*)'\s*\]/g)].map((m) => [+m[1], m[2]]);
}

function titleOf(html) {
  const m = html.match(/<title>([^<]+)<\/title>/);
  return m ? m[1].replace(/\s*\(.*$/, '') : 'Ad';
}
function metaOf(html) {
  const m = html.match(/<span class="hud-meta">([^<]+)<\/span>/);
  return m ? m[1] : '';
}

const sheets = [];
for (const m of manifest) {
  const src = await readFile(join(dist, m.file), 'utf8');
  const beats = beatsOf(src);
  if (beats.length === 0) continue;

  // one still per cut, plus a late hold so the end card is always reviewable
  const stills = beats.map(([t, label], i) => {
    const next = beats[i + 1] ? beats[i + 1][0] : 0;
    // sample 320ms into each scene so entrances have settled but the scene is live
    const end = next || NaN;
    const at = Number.isNaN(end) ? t + 1.6 : Math.min(t + 0.45, t + (end - t) * 0.72);
    return { at: Number(at.toFixed(2)), t, label };
  });

  const sheetFile = `frames-${m.file.replace(/\.html$/, '')}.html`;
  const portrait = !/4:5|1:1/.test(metaOf(src));
  const sheet = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${titleOf(src)} — keyframes</title>
<style>
  body{margin:0;background:#05070f;color:hsl(210 40% 97%);font-family:'Inter',system-ui,sans-serif;padding:36px}
  h1{font-family:'Space Grotesk',sans-serif;font-size:28px;margin:0 0 4px;letter-spacing:-.02em}
  .meta{color:hsl(225 14% 56%);font-size:13px;margin:0 0 30px}
  .strip{display:flex;gap:20px;overflow-x:auto;padding-bottom:20px;align-items:flex-start}
  .shot{flex:0 0 auto;display:grid;gap:9px}
  .thumb{border-radius:10px;overflow:hidden;background:#000;box-shadow:0 0 0 1px hsl(225 14% 56% / .2)}
  .thumb iframe{border:0;display:block;${portrait ? 'height:760px;width:428px' : 'height:640px;width:512px'}}
  .cap{display:flex;gap:10px;align-items:baseline;font-size:12px}
  .tc{font-family:'Space Grotesk',monospace;color:hsl(212 100% 68%);min-width:52px}
  .lb{font-weight:700;letter-spacing:.06em;text-transform:uppercase;font-size:11px;color:hsl(225 14% 56%)}
</style></head><body>
<h1>${titleOf(src)} — keyframes</h1>
<p class="meta">${metaOf(src)} · generated from the ad's own cut points · ${stills.length} shots</p>
<div class="strip">
${stills.map((s) => `  <div class="shot">
    <div class="thumb"><iframe src="${m.file}?t=${s.at}&clean=1" loading="lazy" title="${s.label}"></iframe></div>
    <div class="cap"><span class="tc">${s.t.toFixed(2)}s</span><span class="lb">${s.label}</span></div>
  </div>`).join('\n')}
</div>
</body></html>`;
  await writeFile(join(dist, sheetFile), sheet, 'utf8');
  sheets.push({ file: sheetFile, shots: stills.length });
}

// contact sheet — one page showing every ad, so the whole slate is reviewable
const sheet = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Vaylo Sports — 5-ad slate</title>
<style>
  body{margin:0;background:#05070f;color:hsl(210 40% 97%);font-family:'Inter',system-ui,sans-serif;padding:40px}
  h1{font-family:'Space Grotesk',sans-serif;font-size:30px;margin:0 0 6px}
  p.lede{color:hsl(225 14% 56%);margin:0 0 36px;max-width:70ch;line-height:1.6}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:28px}
  .card{background:hsl(233 28% 9%);border:1px solid hsl(225 14% 56% / .16);border-radius:14px;padding:16px;display:grid;gap:12px}
  .thumb{background:#000;border-radius:10px;overflow:hidden;display:grid;place-items:center;min-height:220px}
  .thumb iframe{border:0;width:100%;height:430px}
  .meta{font-size:12px;color:hsl(225 14% 56%);line-height:1.6}
  .meta b{color:hsl(210 40% 97%);display:block;font-size:14px;margin-bottom:4px}
  a{color:hsl(212 100% 68%)}
</style></head><body>
<h1>Vaylo Sports — 5-ad social slate</h1>
<p class="lede">Every ad runs. Click any frame to play it, or open the file directly. The single claim underneath all five:
<b style="color:inherit">everyone tracks, nobody scores you, Vaylo does</b> — because VPR is computed locally from the athlete's own logs, and is therefore the one flagship claim that works today with no AI provider key.</p>
<div class="grid">
${manifest.map((m) => {
  const sheet = sheets.find((s) => s.file === `frames-${m.file.replace(/\.html$/, '')}.html`);
  return `  <div class="card">
    <div class="thumb"><iframe src="${m.file}" loading="lazy" title="${m.file}"></iframe></div>
    <div class="meta"><b>${m.file.replace(/\.html$/, '')}</b>${m.kb} KB · standalone<br /><a href="${m.file}">open full size</a>${sheet ? ` · <a href="${sheet.file}">${sheet.shots} keyframes</a>` : ''}</div>
  </div>`;
}).join('\n')}
</div>
</body></html>`;
await writeFile(join(dist, 'index.html'), sheet, 'utf8');

console.log('built:');
for (const m of manifest) console.log(`  dist/${m.file}  ${m.kb} KB`);
for (const s of sheets) console.log(`  dist/${s.file}  (${s.shots} keyframes)`);
console.log(`  dist/index.html  (contact sheet)`);
