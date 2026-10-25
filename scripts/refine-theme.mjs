import { readFileSync, writeFileSync } from 'fs';

const css = readFileSync('site/theme.css','utf8');

// Shared easing tokens used by the new smooth transitions.
const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

// ---- 1) Replace :root with a cohesive dark theme ----
const oldRootRe = /:root\s*\{[\s\S]*?\n\}/;
const rootIdx = css.search(oldRootRe);
const before = css.slice(0, rootIdx);
const after = css.slice(rootIdx + css.slice(rootIdx).match(oldRootRe)[0].length);

const newRoot = `:root {
  /* Vaylo Sports — cohesive dark theme.
     One canvas, one surface, one border, one accent. The product is a dark Android
     app, so the site matches it instead of trying to be a different thing. */
  --bg: #07080c;
  --surface: #0c0f16;
  --surface-2: #131822;
  --surface-3: #1a212d;
  --border: rgb(255 255 255 / 0.08);
  --border-strong: rgb(255 255 255 / 0.18);
  --border-glow: color-mix(in srgb, var(--primary) 38%, transparent);

  /* Paper band lives for editorial contrast only; it is never the site background. */
  --paper: #f4f1ea;
  --paper-text: #10131a;
  --paper-muted: #4b5261;
  --paper-border: rgb(16 19 26 / 0.16);
  --paper-accent: #1b3fd0;

  /* Typography hierarchy. Three text steps, one faint floor for metadata. */
  --text: #eef2f9;
  --muted: #a9b6cc;
  --faint: #8593ab;

  /* Accent. Flat, quiet, used for interactive state and the one thing that needs
     attention on a page. NOT a gradient, NOT a glow. */
  --primary: #9ec3ff;
  --primary-solid: #2f6fe0;
  --primary-deep: #1c3f8b;
  --accent: #cfe0ff;

  /* Semantic status tokens, used sparingly. */
  --ok: #34d399;
  --danger: #f87171;
  --warn: #fbbf24;
  --warn-bg: rgb(251 191 36 / 0.10);
  --warn-border: rgb(251 191 36 / 0.34);

  /* Shadows: dark, neutral, softened. No coloured glows. */
  --shadow-1: 0 1px 2px rgb(2 4 10 / 0.5), 0 10px 26px -20px rgb(2 4 10 / 0.95);
  --shadow-2: 0 2px 4px rgb(2 4 10 / 0.5), 0 20px 44px -24px rgb(2 4 10 / 1);
  --shadow-soft: 0 1px 2px rgb(2 4 10 / 0.4);

  /* Motion helpers (overridden per-component where it matters). */
  --ease: ${EASE};
  --ease-bounce: cubic-bezier(0.34, 1.56, 0.64, 1);
  --ease-smooth: cubic-bezier(0.2, 0, 0, 1);

  /* Reading progress. */
  --progress: 0;

  /* Spacing + radii. */
  --radius: 12px;
  --radius-sm: 8px;
  --radius-lg: 18px;
  --radius-pill: 999px;
  --shell: 1220px;
  --prose: 68ch;
  --gap: clamp(0.9rem, 2vw, 1.25rem);
  --section-y: clamp(3.2rem, 7vw, 5.6rem);

  /* Type. */
  --font: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif;
  --font-display: "Archivo", system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --font-body: "Archivo", system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
`;

let out = before + newRoot + '\n' + after;

// ---- 2) html: small tap highlight removal ----
out = out.replace(
  'html {\n  scroll-behavior: smooth;\n  scroll-padding-top: 5rem; /* clears the sticky header on anchor jumps */\n  /* The background is painted here as well as on body: html is the canvas,\n     so body alone leaves the overscroll area on some browsers unpainted. */\n  background: var(--bg);\n}',
  `html {
  scroll-behavior: smooth;
  scroll-padding-top: 5rem; /* clears the sticky header on anchor jumps */
  background: var(--bg);
  -webkit-tap-highlight-color: transparent;
}`
);

// ---- 3) body: calm background treatment ----
out = out.replace(
  `body {\n  /* The browser's default 8px body margin is not wanted: .shell supplies the\n     gutter, and leaving the default in place makes every page sit 8px off\n     and breaks any 100vh/fixed-positioned layout later. */\n  margin: 0;\n  font: 16px/1.65 var(--font-body);\n  color: var(--text);\n  background: var(--bg);\n  overflow-x: hidden;\n  -webkit-font-smoothing: antialiased;\n  -moz-osx-font-smoothing: grayscale;\n  font-synthesis-weight: none;\n  text-rendering: optimizeLegibility;\n  /* The scheme is declared in the markup too, so form controls, scrollbars and\n     the browser's own UI follow the page instead of staying light. */\n  color-scheme: dark light;\n}`,
  `body {
  margin: 0;
  font: 16px/1.65 var(--font-body);
  color: var(--text);
  background: var(--bg);
  overflow-x: hidden;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  font-synthesis-weight: none;
  text-rendering: optimizeLegibility;
  color-scheme: dark light;
  background-image: radial-gradient(1200px 600px at 80% -10%, color-mix(in srgb, var(--primary) 8%, transparent), transparent 60%),
                    radial-gradient(900px 500px at -10% 110%, color-mix(in srgb, var(--primary-deep) 10%, transparent), transparent 60%);
  background-attachment: fixed;
  background-repeat: no-repeat;
}`
);

// ---- 4) Headings: quiet text color for body headings ----
out = out.replace(
  `h1, h2, h3, h4 {
  font-family: var(--font-display);
  color: #fff;
  letter-spacing: -0.015em;
  line-height: 1.2;
  margin: 0;
  font-synthesis-weight: none;
}
@media (prefers-color-scheme: light) { h1, h2, h3, h4 { color: var(--text); } }`,
  `h1, h2, h3, h4 {
  font-family: var(--font-display);
  color: var(--text);
  letter-spacing: -0.015em;
  line-height: 1.2;
  margin: 0;
  font-synthesis-weight: none;
}
@media (prefers-color-scheme: light) { h1, h2, h3, h4 { color: var(--text); } }`
);

// ---- 5) Hero display headline: keep it bright ----
out = out.replace(
  `.hero h1,
.display {
  font-family: var(--font-display);
  font-size: clamp(2.6rem, 7.4vw, 5.1rem);
  line-height: 0.94;
  letter-spacing: -0.045em;
  font-weight: 800;
  max-width: 16ch;
  text-wrap: balance;
}`,
  `.hero h1,
.display {
  font-family: var(--font-display);
  font-size: clamp(2.6rem, 7.4vw, 5.1rem);
  line-height: 0.94;
  letter-spacing: -0.045em;
  font-weight: 800;
  color: #fff;
  max-width: 16ch;
  text-wrap: balance;
}`
);

// ---- 6) Hero strip stat numbers: quiet text ----
out = out.replace(
  `.hero-strip .stat-num { font-size: clamp(1.35rem, 3.5vw, 1.8rem); font-weight: 800; color: #fff; letter-spacing: -0.02em; font-family: var(--font-display); }`,
  `.hero-strip .stat-num { font-size: clamp(1.35rem, 3.5vw, 1.8rem); font-weight: 800; color: var(--text); letter-spacing: -0.02em; font-family: var(--font-display); }`
);

// ---- 7) Buttons: continuous hover/press/focus ----
out = out.replace(
  `.btn-primary { background: var(--primary-solid); color: #fff; box-shadow: var(--shadow-1); }
.btn-primary:hover { filter: brightness(1.08); color: #fff; }
.btn-primary:focus-visible {
  box-shadow: 0 0 0 4px rgb(5 7 15 / 0.25);
}`,
  `.btn-primary {
  background: var(--primary-solid);
  color: #fff;
  box-shadow: var(--shadow-1);
  transition: background 0.18s var(--ease), box-shadow 0.18s var(--ease), transform 0.12s var(--ease), filter 0.18s var(--ease);
}
.btn-primary:hover {
  background: color-mix(in srgb, var(--primary-solid) 92%, #fff 8%);
  color: #fff;
  box-shadow: var(--shadow-2);
  transform: translateY(-1px);
  filter: brightness(1.05);
}
.btn-primary:active { transform: translateY(1px); box-shadow: var(--shadow-1); filter: brightness(0.97); }
.btn-primary:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 3px;
  box-shadow: 0 0 0 6px color-mix(in srgb, var(--primary) 22%, transparent), var(--shadow-1);
}`
);

out = out.replace(
  `.btn-secondary { background: var(--surface); color: var(--text); border-color: var(--border-strong); }
.btn-secondary:hover { background: var(--surface-2); color: var(--text); }
.btn-secondary:focus-visible {
  box-shadow: 0 0 0 4px rgb(5 7 15 / 0.25);
}`,
  `.btn-secondary {
  background: var(--surface);
  color: var(--text);
  border-color: var(--border-strong);
  transition: background 0.18s var(--ease), color 0.18s var(--ease), border-color 0.18s var(--ease), box-shadow 0.18s var(--ease), transform 0.12s var(--ease);
}
.btn-secondary:hover {
  background: var(--surface-2);
  color: var(--text);
  border-color: color-mix(in srgb, var(--primary) 55%, var(--border-strong));
  box-shadow: var(--shadow-soft);
  transform: translateY(-1px);
}
.btn-secondary:active { transform: translateY(1px); box-shadow: var(--shadow-soft); }
.btn-secondary:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 3px;
  box-shadow: 0 0 0 6px color-mix(in srgb, var(--primary) 22%, transparent);
}`
);

out = out.replace(
  `.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  min-height: 48px;
  padding: 0.75rem 1.4rem;
  border-radius: 11px;
  border: 1px solid transparent;
  font: inherit;
  font-weight: 700;
  text-decoration: none;
  cursor: pointer;
  transition: transform 0.12s ease, filter 0.12s ease, box-shadow 0.12s ease;
}
.btn:active { transform: translateY(1px); }
.btn:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
  box-shadow: 0 0 0 4px rgb(5 7 15 / 0.25);
}`,
  `.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  min-height: 48px;
  padding: 0.75rem 1.4rem;
  border-radius: 11px;
  border: 1px solid transparent;
  font: inherit;
  font-weight: 700;
  text-decoration: none;
  cursor: pointer;
  transition: transform 0.14s var(--ease), filter 0.16s var(--ease), box-shadow 0.16s var(--ease), background 0.18s var(--ease), color 0.18s var(--ease), border-color 0.18s var(--ease);
}
.btn:active { transform: translateY(1px); }
.btn:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 3px;
  box-shadow: 0 0 0 6px color-mix(in srgb, var(--primary) 22%, transparent);
}`
);

// ---- 8) Cards: calm hover ----
out = out.replace(
  `.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 1.25rem;
  transition: border-color 0.18s ease;
}
@media (min-width: 640px) { .card { padding: 1.5rem; } }

.card:hover { border-color: var(--border-strong); }
.card:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }`,
  `.card {
  position: relative;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 1.25rem;
  transition: border-color 0.18s var(--ease), background 0.2s var(--ease), box-shadow 0.2s var(--ease);
  box-shadow: var(--shadow-soft);
}
@media (min-width: 640px) { .card { padding: 1.5rem; } }

.card:hover {
  border-color: var(--border-strong);
  background: var(--surface-2);
  box-shadow: var(--shadow-1);
}
.card:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 3px;
  box-shadow: 0 0 0 6px color-mix(in srgb, var(--primary) 22%, transparent), var(--shadow-soft);
}`
);

// ---- 9) Nav links: continuous underline ----
out = out.replace(
  `.site-nav a::after {
  content: "";
  position: absolute;
  inset-inline: 0;
  bottom: 0.85rem;
  height: 1px;
  background: currentColor;
  transform: scaleX(0);
  transform-origin: left;
  transition: transform 0.18s cubic-bezier(0.22, 1, 0.36, 1);
}
.site-nav a:hover { color: var(--text); }
.site-nav a:hover::after { transform: scaleX(1); }
.site-nav a:focus-visible { outline: 2px solid var(--primary); outline-offset: 4px; border-radius: 3px; }
.site-nav a[aria-current="page"] {
  color: var(--text);
  font-weight: 650;
}
.site-nav a[aria-current="page"]::after { transform: scaleX(1); }`,
  `.site-nav a::after {
  content: "";
  position: absolute;
  inset-inline: 0;
  bottom: 0.85rem;
  height: 1px;
  background: currentColor;
  transform: scaleX(0);
  transform-origin: left;
  transition: transform 0.22s var(--ease);
}
.site-nav a:hover { color: var(--accent); }
.site-nav a:hover::after { transform: scaleX(1); }
.site-nav a:focus-visible { outline: 2px solid var(--primary); outline-offset: 4px; border-radius: 3px; }
.site-nav a[aria-current="page"] {
  color: var(--text);
  font-weight: 650;
}
.site-nav a[aria-current="page"]::after { transform: scaleX(1); }`
);

// ---- 10) Chips: continuous hover ----
out = out.replace(
  `.chip {
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface);
  cursor: pointer;
  transition: border-color 0.14s ease, background 0.14s ease, color 0.14s ease;
}
.chip input { position: absolute; opacity: 0; width: 1px; height: 1px; }
.chip span {
  display: inline-block;
  padding: 0.42rem 0.85rem;
  font-size: 0.88rem;
  font-weight: 600;
  color: var(--muted);
}
.chip:hover { border-color: var(--border-strong); }
.chip:hover span { color: var(--text); }
.chip input:focus-visible + span { outline: 2px solid var(--primary); outline-offset: 3px; border-radius: 999px; }
.chip:has(input:checked) { border-color: var(--primary); background: color-mix(in srgb, var(--primary) 16%, var(--surface)); }
.chip:has(input:checked) span { color: var(--text); }`,
  `.chip {
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface);
  cursor: pointer;
  transition: border-color 0.18s var(--ease), background 0.18s var(--ease), color 0.18s var(--ease), box-shadow 0.18s var(--ease);
  box-shadow: var(--shadow-soft);
}
.chip input { position: absolute; opacity: 0; width: 1px; height: 1px; }
.chip span {
  display: inline-block;
  padding: 0.42rem 0.85rem;
  font-size: 0.88rem;
  font-weight: 600;
  color: var(--muted);
  transition: color 0.16s var(--ease);
}
.chip:hover {
  border-color: var(--border-strong);
  background: var(--surface-2);
  box-shadow: var(--shadow-1);
}
.chip:hover span { color: var(--text); }
.chip input:focus-visible + span { outline: 2px solid var(--primary); outline-offset: 3px; border-radius: 999px; }
.chip:has(input:checked) { border-color: var(--primary); background: color-mix(in srgb, var(--primary) 16%, var(--surface)); box-shadow: 0 0 0 1px var(--border-glow); }
.chip:has(input:checked) span { color: var(--text); }`
);

// ---- 11) Pills: continuous hover ----
out = out.replace(
  `.pill {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.3rem 0.7rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface);
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--muted);
  transition: color 0.12s ease, background 0.12s ease, border-color 0.12s ease,
              box-shadow 0.12s ease;
}
.pill:hover {
  color: var(--text);
  background: var(--surface-2);
  border-color: var(--border-strong);
}
.pill:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
  box-shadow: 0 0 0 4px rgb(5 7 15 / 0.25);
}`,
  `.pill {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.3rem 0.7rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface);
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--muted);
  transition: color 0.16s var(--ease), background 0.16s var(--ease), border-color 0.16s var(--ease), box-shadow 0.16s var(--ease);
  box-shadow: var(--shadow-soft);
}
.pill:hover {
  color: var(--text);
  background: var(--surface-2);
  border-color: var(--border-strong);
  box-shadow: var(--shadow-1);
}
.pill:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 3px;
  box-shadow: 0 0 0 6px color-mix(in srgb, var(--primary) 22%, transparent);
}`
);

// ---- 12) Tag list: continuous hover ----
out = out.replace(
  `.tag-list li {
  padding: 0.35rem 0.8rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface);
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--muted);
  transition: color 0.14s ease, border-color 0.14s ease, background 0.14s ease;
}
.tag-list li:hover { color: var(--text); border-color: var(--border-strong); background: var(--surface-2); }`,
  `.tag-list li {
  padding: 0.35rem 0.8rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface);
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--muted);
  transition: color 0.16s var(--ease), border-color 0.16s var(--ease), background 0.16s var(--ease), box-shadow 0.16s var(--ease);
  box-shadow: var(--shadow-soft);
}
.tag-list li:hover {
  color: var(--text);
  border-color: var(--border-strong);
  background: var(--surface-2);
  box-shadow: var(--shadow-1);
}`
);

// ---- 13) Choice cards: calm lift ----
out = out.replace(
  `.choice {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: start;
  gap: 0.85rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.95rem 1.1rem;
  background: var(--surface);
  cursor: pointer;
  transition: border-color 0.16s ease, background 0.16s ease;
}
.choice:hover { border-color: var(--border-strong); background: var(--surface-2); }
.choice input {
  appearance: none;
  -webkit-appearance: none;
  width: 20px;
  height: 20px;
  margin: 2px 0 0;
  border: 1.5px solid var(--border-strong);
  border-radius: 6px;
  background: var(--bg);
  cursor: pointer;
  flex: none;
  transition: background 0.14s ease, border-color 0.14s ease;
}
.choice input:checked { background: var(--primary-solid); border-color: var(--primary-solid); }
.choice input:checked::after {
  content: "";
  display: block;
  width: 5px;
  height: 10px;
  margin: 1px auto 0;
  border: solid #fff;
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}
.choice input:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
.choice:has(input:checked) { border-color: var(--primary); }`,
  `.choice {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: start;
  gap: 0.85rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.95rem 1.1rem;
  background: var(--surface);
  cursor: pointer;
  transition: border-color 0.18s var(--ease), background 0.18s var(--ease), box-shadow 0.2s var(--ease), transform 0.2s var(--ease);
  box-shadow: var(--shadow-soft);
}
.choice:hover { border-color: var(--border-strong); background: var(--surface-2); box-shadow: var(--shadow-1); transform: translateY(-1px); }
.choice:has(input:checked) { border-color: var(--primary); background: color-mix(in srgb, var(--primary) 10%, var(--surface)); box-shadow: 0 0 0 1px var(--border-glow); transform: none; }
.choice input {
  appearance: none;
  -webkit-appearance: none;
  width: 20px;
  height: 20px;
  margin: 2px 0 0;
  border: 1.5px solid var(--border-strong);
  border-radius: 6px;
  background: var(--bg);
  cursor: pointer;
  flex: none;
  transition: background 0.16s var(--ease), border-color 0.16s var(--ease), box-shadow 0.16s var(--ease);
}
.choice input:checked { background: var(--primary-solid); border-color: var(--primary-solid); box-shadow: 0 0 0 2px color-mix(in srgb, var(--primary) 30%, transparent); }
.choice input:checked::after {
  content: "";
  display: block;
  width: 5px;
  height: 10px;
  margin: 1px auto 0;
  border: solid #fff;
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}
.choice input:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; box-shadow: 0 0 0 4px color-mix(in srgb, var(--primary) 22%, transparent); }
`
);

// ---- 14) Capability rows: smoother slide + glow ----
out = out.replace(
  `.cap {
  position: relative;
  /* Own stacking context: the hover surface below is z-index -1, and without
     this it would paint behind the page background instead of behind the row. */
  z-index: 0;
  display: grid;
  grid-template-columns: 2.6rem minmax(0, 1fr) auto;
  gap: 0.5rem 1rem;
  padding: 1.5rem 0.9rem 1.5rem 0;
  border-bottom: 1px solid var(--border);
  text-decoration: none;
  color: inherit;
  transition: padding 0.25s cubic-bezier(0.22, 1, 0.36, 1);
}
.cap::before {
  content: "";
  position: absolute;
  inset: 0 -0.9rem;
  z-index: -1;
  border-radius: 10px;
  background: var(--surface);
  opacity: 0;
  transition: opacity 0.2s ease;
}
.cap:hover::before,
.cap:focus-visible::before { opacity: 1; }
.cap:hover { padding-left: 0.9rem; }
.cap-num {
  font-family: var(--font-mono);
  font-size: 0.76rem;
  color: var(--faint);
  padding-top: 0.45rem;
  font-variant-numeric: tabular-nums;
}
.cap h3 {
  margin: 0;
  font-size: clamp(1.1rem, 1.9vw, 1.4rem);
  letter-spacing: -0.022em;
}
.cap p { margin: 0.35rem 0 0; font-size: 0.95rem; max-width: 62ch; }
.cap-arrow {
  align-self: center;
  color: var(--primary);
  opacity: 0;
  transform: translateX(-6px);
  transition: opacity 0.2s ease, transform 0.2s cubic-bezier(0.22, 1, 0.36, 1);
}
.cap:hover .cap-arrow,
.cap:focus-visible .cap-arrow { opacity: 1; transform: none; }`,
  `.cap {
  position: relative;
  z-index: 0;
  display: grid;
  grid-template-columns: 2.6rem minmax(0, 1fr) auto;
  gap: 0.5rem 1rem;
  padding: 1.5rem 0.9rem 1.5rem 0;
  border-bottom: 1px solid var(--border);
  text-decoration: none;
  color: inherit;
  transition: padding 0.28s var(--ease), background 0.28s var(--ease), border-color 0.18s var(--ease);
}
.cap::before {
  content: "";
  position: absolute;
  inset: 0 -0.9rem;
  z-index: -1;
  border-radius: 10px;
  background: var(--surface-2);
  opacity: 0;
  transition: opacity 0.22s var(--ease), background 0.22s var(--ease), box-shadow 0.22s var(--ease);
  box-shadow: var(--shadow-soft);
}
.cap:hover::before,
.cap:focus-visible::before { opacity: 1; background: var(--surface-3); box-shadow: var(--shadow-1); }
.cap:hover { padding-left: 0.9rem; }
.cap-num {
  font-family: var(--font-mono);
  font-size: 0.76rem;
  color: var(--faint);
  padding-top: 0.45rem;
  font-variant-numeric: tabular-nums;
  transition: color 0.18s var(--ease);
}
.cap:hover .cap-num { color: var(--muted); }
.cap h3 {
  margin: 0;
  font-size: clamp(1.1rem, 1.9vw, 1.4rem);
  letter-spacing: -0.022em;
  transition: color 0.18s var(--ease);
}
.cap:hover h3 { color: var(--accent); }
.cap p { margin: 0.35rem 0 0; font-size: 0.95rem; max-width: 62ch; transition: color 0.18s var(--ease); }
.cap:hover p { color: var(--text); }
.cap-arrow {
  align-self: center;
  color: var(--primary);
  opacity: 0;
  transform: translateX(-6px);
  transition: opacity 0.22s var(--ease), transform 0.22s var(--ease);
}
.cap:hover .cap-arrow,
.cap:focus-visible .cap-arrow { opacity: 1; transform: none; }
`
);

// ---- 15) Notes / warns / oks: calm lift ----
out = out.replace(
  `.note,
.warn,
.ok {
  border-radius: var(--radius);
  padding: 1rem 1.15rem;
  margin: 1.5rem 0;
  max-width: var(--prose);
  transition: transform 0.18s cubic-bezier(0.22, 1, 0.36, 1),
              box-shadow 0.18s cubic-bezier(0.22, 1, 0.36, 1),
              border-color 0.18s ease;
}
.note:hover, .warn:hover, .ok:hover {
  transform: translateY(-2px);
  box-shadow: 0 10px 28px rgb(5 7 15 / 0.24);
}
.note { background: var(--surface); border: 1px solid var(--border); border-left: 3px solid var(--primary-solid); }
.warn { background: var(--warn-bg); border: 1px solid var(--warn-border); border-left: 3px solid var(--warn); }
.ok { background: var(--surface); border: 1px solid var(--border); border-left: 3px solid var(--ok); }
.note p, .warn p, .ok p { color: var(--text); margin-bottom: 0.5rem; max-width: none; }
.note p:last-child, .warn p:last-child, .ok p:last-child { margin-bottom: 0; }`,
  `.note,
.warn,
.ok {
  border-radius: var(--radius);
  padding: 1rem 1.15rem;
  margin: 1.5rem 0;
  max-width: var(--prose);
  transition: transform 0.2s var(--ease), box-shadow 0.2s var(--ease), border-color 0.16s var(--ease);
  box-shadow: var(--shadow-soft);
}
.note:hover, .warn:hover, .ok:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-1);
}
.note { background: var(--surface); border: 1px solid var(--border); border-left: 3px solid var(--primary-solid); }
.warn { background: var(--warn-bg); border: 1px solid var(--warn-border); border-left: 3px solid var(--warn); }
.ok { background: var(--surface); border: 1px solid var(--border); border-left: 3px solid var(--ok); }
.note p, .warn p, .ok p { color: var(--text); margin-bottom: 0.5rem; max-width: none; }
.note p:last-child, .warn p:last-child, .ok p:last-child { margin-bottom: 0; }`
);

// ---- 16) Form inputs: continuous focus ----
out = out.replace(
  `input[type="text"],
input[type="email"],
input[type="url"],
input[type="tel"],
input[type="number"],
select,
textarea {
  width: 100%;
  min-height: 48px;
  padding: 0.7rem 0.85rem;
  border-radius: 11px;
  border: 1px solid var(--border-strong);
  background: var(--surface);
  color: var(--text);
  font: inherit;
  transition: border-color 0.12s ease, box-shadow 0.12s ease;
}
textarea { min-height: 9rem; resize: vertical; line-height: 1.6; }`,
  `input[type="text"],
input[type="email"],
input[type="url"],
input[type="tel"],
input[type="number"],
select,
textarea {
  width: 100%;
  min-height: 48px;
  padding: 0.7rem 0.85rem;
  border-radius: 11px;
  border: 1px solid var(--border-strong);
  background: var(--surface);
  color: var(--text);
  font: inherit;
  transition: border-color 0.16s var(--ease), box-shadow 0.16s var(--ease), background 0.16s var(--ease);
  box-shadow: var(--shadow-soft);
}
textarea { min-height: 9rem; resize: vertical; line-height: 1.6; }
input[type="text"]:hover,
input[type="email"]:hover,
input[type="url"]:hover,
input[type="tel"]:hover,
input[type="number"]:hover,
select:hover,
textarea:hover {
  background: var(--surface-2);
  border-color: color-mix(in srgb, var(--primary) 55%, var(--border-strong));
}`
);

out = out.replace(
  `input:focus-visible, select:focus-visible, textarea:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 1px;
  border-color: var(--primary);
}`,
  `input:focus-visible, select:focus-visible, textarea:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
  border-color: var(--primary);
  box-shadow: 0 0 0 5px color-mix(in srgb, var(--primary) 22%, transparent), var(--shadow-soft);
  background: var(--surface-2);
}`
);

// ---- 17) Form status: continuous ----
out = out.replace(
  `.form-status {
  border-radius: var(--radius);
  padding: 1rem 1.15rem;
  margin-top: 1.25rem;
  border: 1px solid var(--border);
  background: var(--surface);
  transition: border-color 0.12s ease, box-shadow 0.12s ease;
}
.form-status:empty { display: none; }
.form-status.is-error { border-color: var(--danger); background: color-mix(in srgb, var(--danger) 10%, var(--surface)); }
.form-status.is-ok { border-color: var(--ok); background: color-mix(in srgb, var(--ok) 10%, var(--surface)); }
.form-status p { color: var(--text); margin-bottom: 0.5rem; max-width: none; }
.form-status p:last-child { margin-bottom: 0; }
.form-status .ref { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-weight: 700; }`,
  `.form-status {
  border-radius: var(--radius);
  padding: 1rem 1.15rem;
  margin-top: 1.25rem;
  border: 1px solid var(--border);
  background: var(--surface);
  transition: border-color 0.18s var(--ease), background 0.2s var(--ease), box-shadow 0.2s var(--ease);
  box-shadow: var(--shadow-soft);
}
.form-status:empty { display: none; }
.form-status.is-error { border-color: var(--danger); background: color-mix(in srgb, var(--danger) 10%, var(--surface)); box-shadow: var(--shadow-soft); }
.form-status.is-ok { border-color: var(--ok); background: color-mix(in srgb, var(--ok) 10%, var(--surface)); box-shadow: var(--shadow-soft); }
.form-status p { color: var(--text); margin-bottom: 0.5rem; max-width: none; }
.form-status p:last-child { margin-bottom: 0; }
.form-status .ref { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-weight: 700; }
`
);

// ---- 18) Back link + doc-index: continuous ----
out = out.replace(
  `  .back-link {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  margin: 1.5rem 0 1.25rem;
  font-size: 0.9rem;
  font-weight: 650;
  color: var(--primary);
  text-decoration: none;
  transition: color 0.14s ease, gap 0.14s ease, transform 0.14s ease;
}
.back-link:hover { color: var(--accent); gap: 0.55rem; }
.back-link:focus-visible { outline: 2px solid var(--primary); outline-offset: 3px; border-radius: 4px; }`,
  `.back-link {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  margin: 1.5rem 0 1.25rem;
  font-size: 0.9rem;
  font-weight: 650;
  color: var(--primary);
  text-decoration: none;
  transition: color 0.18s var(--ease), gap 0.22s var(--ease), transform 0.18s var(--ease);
}
.back-link:hover { color: var(--accent); gap: 0.55rem; transform: translateX(2px); }
.back-link:focus-visible { outline: 2px solid var(--primary); outline-offset: 3px; }
`
);

out = out.replace(
  `  .doc-index a {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 1rem 1.15rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  text-decoration: none;
  transition: transform 0.18s cubic-bezier(0.22, 1, 0.36, 1),
              box-shadow 0.18s cubic-bezier(0.22, 1, 0.36, 1),
              border-color 0.18s ease;
}
.doc-index a:hover {
  transform: translateY(-2px);
  border-color: var(--border-strong);
  box-shadow: 0 10px 28px rgb(5 7 15 / 0.24);
}
.doc-index a:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
.doc-index .t { font-weight: 650; color: var(--text); }
.doc-index .d { font-size: 0.92rem; color: var(--muted); max-width: none; transition: color 0.16s var(--ease); }
.doc-index a:hover .t { color: var(--accent); }
.doc-index a:hover .d { color: var(--text); }`,
  `.doc-index {
  list-style: none;
  padding: 0;
  margin: 1.5rem 0 0;
  display: grid;
  gap: 0.75rem;
}
.doc-index > li { margin: 0; }
.doc-index a {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;    padding: 1rem 1.15rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    text-decoration: none;
    transition: transform 0.18s cubic-bezier(0.22, 1, 0.36, 1),
                box-shadow 0.18s cubic-bezier(0.22, 1, 0.36, 1),
                border-color 0.18s ease;
    box-shadow: var(--shadow-soft);
  }
  .doc-index a:hover {
    transform: translateY(-2px);
    border-color: var(--border-strong);
    background: var(--surface-2);
    box-shadow: 0 10px 28px rgb(5 7 15 / 0.24);
  }
  .doc-index a:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
  .doc-index .t { font-weight: 650; color: var(--text); }
  .doc-index a:hover .t { color: var(--accent); }
  .doc-index .d { font-size: 0.92rem; color: var(--muted); max-width: none; transition: color 0.16s var(--ease); }
  .doc-index a:hover .d { color: var(--text); }
`
);

// ---- 19) Table rows: soft hover ----
out = out.replace(
  `th, td { text-align: left; padding: 0.7rem 0.85rem; border-bottom: 1px solid var(--border); vertical-align: top; transition: background 0.16s var(--ease); }
th { color: var(--muted); font-weight: 650; background: var(--surface); }
td { color: var(--muted); }
tr:hover td { background: var(--surface-2); }
td strong { color: var(--text); }
`
);

// ---- 20) Closing block: smooth ----
out = out.replace(
  `.closing {
  padding: var(--section-y) 0;
  border-top: 1px solid var(--border);
  position: relative;
  overflow: hidden;
}
.closing h2 {
  margin: 0;
  font-family: var(--font-display);
  font-size: clamp(2.2rem, 5.8vw, 3.85rem);
  line-height: 0.98;
  letter-spacing: -0.045em;
  max-width: 18ch;
}
.closing p { margin-top: 1.25rem; max-width: 52ch; }`,
  `.closing {
  padding: var(--section-y) 0;
  border-top: 1px solid var(--border);
  position: relative;
  overflow: hidden;
}
.closing h2 {
  margin: 0;
  font-family: var(--font-display);
  font-size: clamp(2.2rem, 5.8vw, 3.85rem);
  line-height: 0.98;
  letter-spacing: -0.045em;
  color: #fff;
  max-width: 18ch;
  transition: color 0.2s var(--ease);
}
.closing:hover h2 { color: var(--accent); }
.closing p { margin-top: 1.25rem; max-width: 52ch; transition: color 0.2s var(--ease); }
.closing:hover p { color: var(--text); }
`
);

writeFileSync('site/theme.css', out);
console.log('OK: site/theme.css rewritten.');
