// ============================================================================
// WHAT HAS CHANGED
// ----------------------------------------------------------------------------
// A dated record of what has changed on this website and in the published
// documents, newest first.
//
// Every entry here is checkable against something in the repository rather than
// remembered: the legal entries are the version line each document carries at
// the top of its own page, and the website entries are changes that are visible
// in the generated output. That constraint is the whole point of the page. A
// changelog that is written from memory drifts, and a changelog that drifts is
// worse than no changelog, because it is the one page a reader is meant to be
// able to trust about what moved.
//
// It is deliberately NOT app release notes. There is no public release yet, so
// there is nothing to release-note; claiming otherwise would be inventing
// history. When there is a listing, the app's own "what's new" belongs in the
// store, and this page will keep recording the website and the policies.
// ============================================================================

import { section } from "../parts.mjs";

const ENTRIES = [
  {
    date: "2026-10-08",
    label: "8 October 2026",
    changes: [
      "<strong>Privacy Policy &rarr; version 1.4</strong> and <strong>Terms of Service &rarr; version 1.4</strong>, both effective from this date. The version line at the top of each document is the authoritative one.",
      "<strong>Child &amp; Young Athlete Safety &rarr; 1.3</strong> and <strong>Your Data Rights &rarr; 1.2</strong>.",
      "<strong>Deleting Your Account &rarr; 1.1.</strong> Deletion is now described step for step as the app actually performs it, including the confirmation phrase and the verification the app runs afterwards.",
      "<strong>AI &amp; Coaching Disclaimer, AI Training Advice and AI Data Use &rarr; 1.1</strong>, and the health, injury, mental wellbeing, nutrition and contact notices &rarr; 1.1.",
      "<strong>Added to this website:</strong> a questions and answers page, an accessibility statement, and this page.",
      "<strong>Removed from this website:</strong> the screen-by-screen app preview pages and the device screenshots they carried.",
      "<strong>Speed:</strong> the stylesheet every page blocks on now ships minified &mdash; about 60% smaller after compression, with nothing removed that a reader sees.",
    ],
  },
  {
    date: "2026-10-07",
    label: "7 October 2026",
    changes: [
      "<strong>Advertising &amp; Tracking Disclosure &rarr; 1.2</strong>, restating exactly which advertising identifiers and SDKs are absent from the build.",
      "<strong>Cookie Policy &rarr; 1.1.</strong>",
      "<strong>The app's cookie and storage notice &rarr; version dated 7 October 2026.</strong> It reports a fact rather than asking for consent, because there is nothing here to consent to: the site sets no tracking cookie at all.",
    ],
  },
  {
    date: "2026-10-06",
    label: "6 October 2026",
    changes: [
      "<strong>A security pass over this website added a Content-Security-Policy, HSTS and a Permissions-Policy to every response.</strong> The policy was verified against what the site actually loads, which is why it can be strict: there are no inline scripts, no inline styles beyond what React and the legal viewer need, and no evaluation anywhere in the build.",
    ],
  },
  {
    date: "2026-10-04",
    label: "4 October 2026",
    changes: [
      "<strong>Credits, Subscriptions &amp; Virtual Currency &rarr; 1.3.</strong>",
      "<strong>Refunds &amp; Cancellation &rarr; 1.2</strong> and <strong>Waiting List Terms &rarr; 1.2.</strong>",
    ],
  },
  {
    date: "2026-10-02",
    label: "2 October 2026",
    changes: [
      "<strong>Seven documents published for the first time at version 1.0:</strong> Competitions &amp; Promotion Terms, the complaints procedure, reporting content or a user, reporting a safety concern, security and vulnerability reporting, the video analysis disclaimer, and the wearable and health data notice.",
    ],
  },
  {
    date: "2026-10-01",
    label: "1 October 2026",
    changes: [
      "<strong>Community Guidelines and Intellectual Property published at version 1.0</strong>, the first two documents on the site.",
    ],
  },
];

function entry(item) {
  return `        <div class="card">
          <h3 style="margin-top:0">${item.label}</h3>
          <ul class="prose-list">
${item.changes.map((c) => `            <li>${c}</li>`).join("\n")}
          </ul>
        </div>`;
}

export const whatsNew = {
  path: "/whats-new/",
  title: "What has changed",
  description:
    "A dated record of every change to this website and to the published Vaylo Sports policies, including the version each document moved to.",
  updated: "2026-10-08",
  body: `
    <div class="shell">
      <div style="padding-top:2.5rem">
        <p class="eyebrow">Record</p>
        <h1>What has changed, and when</h1>
        <p class="lead" style="margin-top:1rem">
          Every change to this website and to the published documents, newest
          first. When a policy changes, the version it moved to is named here as
          well as on the document itself.
        </p>
        <p class="lead" style="margin-top:1rem;max-width:64ch">
          This is not app release notes. There is no public release yet, so there
          is nothing to write release notes about, and inventing a history for a
          product that has not shipped would be the least useful thing this page
          could do.
        </p>
      </div>

      <div class="doc-meta" style="margin-top:1.5rem">
        Each document carries its own version and effective date, and that line
        is the authoritative one. This page is the index to them.
      </div>

      <div class="grid">
${ENTRIES.map(entry).join("\n")}
      </div>
    </div>

${section({
  className: "section-alt",
  eyebrow: "Why bother",
  heading: "A policy you cannot tell has changed is not much of a policy",
  intro: `<p>Most sites update a privacy policy silently and leave the date at the
    top. This page exists so that the question &ldquo;what changed, and was it
    something I should care about&rdquo; has an answer that does not involve
    diffing two versions yourself.</p>`,
  body: `      <div class="btn-row">
        <a class="btn btn-primary" href="/legal/">All legal documents</a>
        <a class="btn btn-secondary" href="/legal/privacy/">Privacy Policy</a>
        <a class="btn btn-secondary" href="/legal/terms/">Terms of Service</a>
        <a class="btn btn-secondary" href="/legal/data-rights/">Your data rights</a>
      </div>`,
})}`,
};
export default whatsNew;
