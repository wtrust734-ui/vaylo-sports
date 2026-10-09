// ============================================================================
// FEATURES
// ----------------------------------------------------------------------------
// Every feature listed here exists in the Vaylo Sports codebase, and each is
// labelled with whether it works today, is built but not switched on, or is
// deliberately disabled. The "not switched on" section is the one that matters
// most: publishing it is what stops this page becoming a description of a
// product that does not exist.
// ============================================================================

import { FEATURES, SPORTS } from "../data/site.mjs";
import { section, list, esc } from "../parts.mjs";

/**
 * A URL-safe fragment for a heading.
 *
 * Every group and every feature gets one, so a link can point at
 * /features/#limiter-test rather than at a page the reader then has to search.
 * That is what makes the page quotable: support replies, waiting-list emails and
 * the FAQ all need to land someone on one paragraph rather than four screens of
 * feature list.
 */
const slug = (value) =>
  value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const STATUS_BADGE = {
  live: '<span class="pill">Working today</span>',
  soon: '<span class="pill">Built, not yet switched on</span>',
  off: '<span class="pill">Deliberately off</span>',
};

function groupBlock(group) {
  return `
      <section id="${slug(group.group)}" style="margin-top:2.5rem">
        <div style="display:flex;flex-wrap:wrap;align-items:center;gap:0.75rem">
          <h2 style="margin:0;font-size:1.3rem">${esc(group.group)}</h2>
          ${STATUS_BADGE[group.status]}
        </div>
${
  group.note
    ? `\n        <div class="${group.status === "off" ? "note" : "warn"}">
          <p>${esc(group.note)}</p>
        </div>\n`
    : ""
}
        <div class="grid grid-2">
${group.items    .map(
    (item) => `          <div class="card" id="${slug(item.name)}">
            <h3 style="margin-top:0;font-size:1rem">${esc(item.name)}</h3>
            <p style="font-size:0.95rem">${esc(item.body)}</p>
          </div>`
  )
  .join("\n")}
        </div>
      </section>`;
}

const groupsHtml = FEATURES.map(groupBlock).join("\n");

export const features = {
  path: "/features/",
  title: "Features",
  description:
    "Every feature in Vaylo Sports, with its real status: what works today, what is built but not switched on, and what is deliberately disabled.",
  body: `
    <div class="shell">
      <div style="padding-top:2.5rem">
        <p class="eyebrow">Features</p>
        <h1>Everything Vaylo Sports does, and what state it is in</h1>
        <p class="lead" style="margin-top:1rem">
          Each area below is labelled with whether it works right now, is built but
          not yet switched on, or is deliberately turned off. We publish the last
          two because the alternative is a feature page describing something you
          cannot use.
        </p>
      </div>

      <div class="note">
        <p><strong>Sports supported:</strong> ${SPORTS.map((s) => esc(s)).join(", ")}.</p>
        <p style="margin-bottom:0">This is the list the app offers. If your sport is
        not on it, choose <em>Other</em> and log your sessions anyway — the core
        logging and metrics do not depend on the sport.</p>
      </div>

      <div class="toc">
        <strong>On this page</strong>
        <ol>
${FEATURES.map(
  (group) =>
    `          <li><a href="#${slug(group.group)}">${esc(group.group)}</a></li>`
).join("\n")}
        </ol>
      </div>
${groupsHtml}

      <div class="btn-row" style="margin-top:3rem">
        <a class="btn btn-primary" href="/legal/ai-disclaimer/">How the AI features work</a>
        <a class="btn btn-secondary" href="/safety/">Safety Centre</a>
        <a class="btn btn-secondary" href="/legal/purchases/">What buying gives you</a>
      </div>
    </div>`,
};
export default features;
