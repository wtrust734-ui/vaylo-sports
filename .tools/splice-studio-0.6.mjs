import fs from "node:fs";

const target = "vaylo ad web app/0.6.html";
let html = fs.readFileSync(target, "utf8");
const css = fs.readFileSync(".tools/studio-0.6.css", "utf8");

// Replace the entire <style> block (old CSS lives between <style> and the first </style>)
const styleStart = html.indexOf("<style>");
const styleEnd = html.indexOf("</style>", styleStart);
if (styleStart < 0 || styleEnd < 0) throw new Error("style block not found");
html = html.slice(0, styleStart) + "<style>\n" + css.replace(/\n$/, "") + "\n</style>" + html.slice(styleEnd + "</style>".length);

// Branding bumps
html = html.replace("<title>Vaylo Brain — Live Studio 0.5</title>", "<title>Vaylo Brain — Live Studio 0.6</title>");
html = html.replace("<small>Live Studio 0.5 — real backend</small>", "<small>Live Studio 0.6 — real backend</small>");

fs.writeFileSync(target, html);
console.log("spliced OK — title 0.6:", /Live Studio 0\.6/.test(html), "· old 0.5 refs left:", (html.match(/0\.5/g) || []).length, "· new CSS present:", html.includes("auroraDrift"), "· length:", html.length);
