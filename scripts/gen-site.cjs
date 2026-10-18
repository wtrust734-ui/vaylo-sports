#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const AD_SITE = path.join(ROOT, "vaylo ad site");

const OUT_WEB = path.join(ROOT, "website");
const OUT_AD = AD_SITE;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

ensureDir(OUT_WEB);
ensureDir(OUT_AD);

function writeWeb(name, body) {
  fs.writeFileSync(path.join(OUT_WEB, name), body, "utf8");
}

function writeAd(name, body) {
  fs.writeFileSync(path.join(OUT_AD, name), body, "utf8");
}

const STUDIO_SOURCE = path.join(OUT_WEB, "studio.inline.html");
let STUDIO_HTML = "";
if (fs.existsSync(STUDIO_SOURCE)) {
  STUDIO_HTML = fs.readFileSync(STUDIO_SOURCE, "utf8");
} else {
  console.warn("gen-site: studio.inline.html was not found at the site root — it will be regenerated from repo storage next run");
}

const WEB_INDEX = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Vaylo Sports — Make ads for your app</title>
    <meta name="description" content="Vaylo Sports: create advertising for your app from a simple site." />
    <style>
      :root {
        --bg: #05070f;
        --panel: #0e1218;
        --ink: #f5f7fa;
        --muted: #9aa4b2;
        --accent: #6fb0ff;
      }
      * { box-sizing: border-box; }
      html, body { margin: 0; background: var(--bg); color: var(--ink); font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; }
      .wrap { max-width: 880px; margin: 0 auto; padding: 48px 20px; }
      header { margin-bottom: 32px; }
      h1 { font-size: 38px; line-height: 1.1; margin: 0 0 12px; letter-spacing: -0.01em; }
      p.lead { color: var(--muted); font-size: 18px; line-height: 1.5; margin: 0; }
      .card {
        background: var(--panel);
        border: 1px solid #1f2732;
        border-radius: 14px;
        padding: 24px;
        margin-top: 28px;
      }
      .card h2 { margin: 0 0 10px; font-size: 20px; }
      .card p { color: var(--muted); line-height: 1.5; margin: 0 0 14px; }
      ul { margin: 0; padding-left: 20px; color: var(--muted); line-height: 1.5; }
      li { margin-bottom: 6px; }
      a.btn {
        display: inline-block;
        background: var(--accent);
        color: #04060a;
        text-decoration: none;
        padding: 12px 18px;
        border-radius: 10px;
        font-weight: 600;
      }
      a.btn:hover { opacity: 0.9; }
      .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 18px; }
      .small { color: var(--muted); font-size: 13px; }
      footer { margin-top: 48px; border-top: 1px solid #1f2732; padding-top: 18px; color: var(--muted); font-size: 13px; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <header>
        <h1>Vaylo Sports</h1>
        <p class="lead">Make ads for your app from a simple site.</p>
      </header>

      <section class="card">
        <h2>What this is</h2>
        <p>A lightweight advertising site for Vaylo Sports. It is the public-facing entry point you can share, link, and point traffic to.</p>
        <ul>
          <li>Short, clear copy</li>
          <li>No app login required to read it</li>
          <li>Fast to deploy and update</li>
        </ul>
      </section>

      <section class="card">
        <h2>Why this exists</h2>
        <p>You said you would use the deployed site for advertising. This gives you a real URL you can send to people, with the basic pitch front and center.</p>
        <p class="small">This site is intentionally separate from the app build so the public page can stay simple and stable.</p>
      </section>

      <div class="grid">
        <div class="card">
          <h2>For people hearing about it</h2>
          <p>The first screen tells them what Vaylo Sports is and where to go next.</p>
        </div>
        <div class="card">
          <h2>For you</h2>
          <p>One place to point ads, messages, and links instead of pasting app URLs everywhere.</p>
        </div>
      </div>

      <div class="card" style="text-align:center; margin-top:36px;">
        <p style="color:var(--muted);">When you are ready, add the real call to action, branding, and destination links here.</p>
      </div>

      <footer>
        Vaylo Sports advertising site. Keep it updated when the product, offers, or destination change.
      </footer>
    </div>
  </body>
</html>
`;

const AD_INDEX = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Vaylo Sports — Make ads for your app</title>
    <meta name="description" content="Vaylo Sports: create advertising for your app from a simple site." />
    <style>
      :root {
        --bg: #05070f;
        --panel: #0e1218;
        --ink: #f5f7fa;
        --muted: #9aa4b2;
        --accent: #6fb0ff;
      }
      * { box-sizing: border-box; }
      html, body { margin: 0; background: var(--bg); color: var(--ink); font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; }
      .wrap { max-width: 880px; margin: 0 auto; padding: 48px 20px; }
      header { margin-bottom: 32px; }
      h1 { font-size: 38px; line-height: 1.1; margin: 0 0 12px; letter-spacing: -0.01em; }
      p.lead { color: var(--muted); font-size: 18px; line-height: 1.5; margin: 0; }
      .card {
        background: var(--panel);
        border: 1px solid #1f2732;
        border-radius: 14px;
        padding: 24px;
        margin-top: 28px;
      }
      .card h2 { margin: 0 0 10px; font-size: 20px; }
      .card p { color: var(--muted); line-height: 1.5; margin: 0 0 14px; }
      ul { margin: 0; padding-left: 20px; color: var(--muted); line-height: 1.5; }
      li { margin-bottom: 6px; }
      a.btn {
        display: inline-block;
        background: var(--accent);
        color: #04060a;
        text-decoration: none;
        padding: 12px 18px;
        border-radius: 10px;
        font-weight: 600;
      }
      a.btn:hover { opacity: 0.9; }
      .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 18px; }
      .small { color: var(--muted); font-size: 13px; }
      footer { margin-top: 48px; border-top: 1px solid #1f2732; padding-top: 18px; color: var(--muted); font-size: 13px; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <header>
        <h1>Vaylo Sports</h1>
        <p class="lead">Make ads for your app from a simple site.</p>
      </header>

      <section class="card">
        <h2>What this is</h2>
        <p>A lightweight advertising site for Vaylo Sports. It is the public-facing entry point you can share, link, and point traffic to.</p>
        <ul>
          <li>Short, clear copy</li>
          <li>No app login required to read it</li>
          <li>Fast to deploy and update</li>
        </ul>
      </section>

      <section class="card">
        <h2>Why this exists</h2>
        <p>You said you would use the deployed site for advertising. This gives you a real URL you can send to people, with the basic pitch front and center.</p>
        <p class="small">This site is intentionally separate from the app build so the public page can stay simple and stable.</p>
      </section>

      <div class="grid">
        <div class="card">
          <h2>For people hearing about it</h2>
          <p>The first screen tells them what Vaylo Sports is and where to go next.</p>
        </div>
        <div class="card">
          <h2>For you</h2>
          <p>One place to point ads, messages, and links instead of pasting app URLs everywhere.</p>
        </div>
      </div>

      <div class="card" style="text-align:center; margin-top:36px;">
        <p style="color:var(--muted);">When you are ready, add the real call to action, branding, and destination links here.</p>
      </div>

      <footer>
        Vaylo Sports advertising site. Keep it updated when the product, offers, or destination change.
      </footer>
    </div>
  </body>
</html>
`;

writeWeb("index.html", WEB_INDEX);
writeWeb("_redirects", "/*\t/index.html\n");
writeWeb("robots.txt", "User-agent: *\nAllow: /\n");
writeAd("index.html", AD_INDEX);
writeAd("_redirects", "/*\t/index.html\n");
writeAd("robots.txt", "User-agent: *\nAllow: /\n");
if (STUDIO_HTML) {
  writeWeb("studio.inline.html", STUDIO_HTML);
  writeAd("studio.inline.html", STUDIO_HTML);
}

console.log("generated website", OUT_WEB);
console.log("generated ad site", OUT_AD);
console.log("website files:", fs.readdirSync(OUT_WEB).length);
console.log("ad site files:", fs.readdirSync(OUT_AD).length);
