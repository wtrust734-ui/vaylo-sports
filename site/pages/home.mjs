// ============================================================================
// HOMEPAGE
// ----------------------------------------------------------------------------
// The brief for this page is that it must not overclaim. That rules out the
// usual sports-app homepage: no "world's best", no guaranteed improvement, no
// medical-adjacent benefit claims, no invented statistics, no partner logos.
//
// What it does instead is say what the app actually is, show the feature set
// that genuinely works today, and separate it clearly from what is built but
// not yet switched on. A visitor should finish this page able to tell whether
// Vaylo is for them — and should not have been told anything that is not true.
// ============================================================================

import { SITE, SPORTS, FEATURES } from "../data/site.mjs";
import { section, list, storeCta, esc } from "../parts.mjs";

/**
 * The hero. Honest about what the product is in two sentences, and no phone.
 *
 * It used to reserve its right half for a phone mockup holding one screenshot of
 * the Training screen. That was removed on 2026-10-08 with the rest of the app
 * preview: a single device capture promises a product tour the site does not
 * give, and it was the largest image the site shipped. What replaced it is the
 * line underneath the buttons — four facts a visitor can check — so the hero
 * still answers "what is this" without a picture standing in for an answer.
 */
function hero() {
  const liveAreas = FEATURES.filter((f) => f.status === "live");
  const liveCount = liveAreas.reduce((n, g) => n + g.items.length, 0);

  // The four facts beside the headline. Every one of them is already stated
  // elsewhere on this page or in a linked document — the point of the card is to
  // put the handful of things a visitor actually decides on next to the
  // headline, instead of making them read the whole page to find out it is
  // Android-only.
  const facts = [
    `<strong>Android only, for now.</strong> There is no iOS build, and no Play Store listing yet — we will not link to one that does not exist.`,
    `<strong>${liveCount} features across ${liveAreas.length} areas</strong> are working today, and the ones that are not are listed below rather than hidden.`,
    `<strong>No advertising or analytics SDK</strong> and no advertising identifier. Sponsored placements are labelled and 18+.`,
    `<strong>Private by default.</strong> Sharing is per activity and yours to withdraw, and a minor's profile cannot be public.`,
  ];

  return `
  <section class="hero">
    <div class="shell hero-grid hero-lift">
      <div>
        <p class="eyebrow">For athletes in every sport</p>
        <h1>A training log that tells you what your <span class="hl">own numbers</span> mean.</h1>
        <p class="lead" style="margin-top:1.25rem">
          Vaylo Sports records what you actually train, then works it back to you:
          load, readiness, recovery, and the limiter most likely holding you
          back. It works across running, cycling, swimming, team sports, racket
          sports, combat sports and everything in between.
        </p>
        <p class="lead" style="margin-top:1rem">
          It is a tool for organising and understanding your own training. It is
          not a doctor, not a physio, and not a coach — and it will tell you when
          to stop rather than push on.
        </p>
        <div class="btn-row">
          <a class="btn btn-primary" href="/features/">See what is in the app</a>
          <a class="btn btn-secondary" href="/safety/">How we keep you safe</a>
        </div>
      </div>

      <div class="card hero-aside">
        <p class="eyebrow" style="margin-bottom:1.1rem">At a glance</p>
        <ul class="prose-list">
${facts.map((f) => `          <li>${f}</li>`).join("\n")}
        </ul>
      </div>
    </div>
  </section>`;
}

/** The honesty panel — the thing most sites of this kind leave out. */
function statusPanel() {
  const live = FEATURES.filter((f) => f.status === "live");
  const soon = FEATURES.filter((f) => f.status === "soon");
  const off = FEATURES.filter((f) => f.status === "off");
  const liveCount = live.reduce((n, g) => n + g.items.length, 0);

  return `
    <div class="grid grid-3">
      <div class="card">
        <h3 style="margin-top:0">Working today</h3>
        <p style="font-size:0.95rem">
          <strong>${liveCount} features across ${live.length} areas</strong> — logging,
          metrics, the Limiter Test, injury scaffolding, nutrition, the Learning
          Hub, event packs and the community side. Open the app and they run.
        </p>
      </div>
      <div class="card">
        <h3 style="margin-top:0">Built, not yet switched on</h3>
        <p style="font-size:0.95rem">
          <strong>${soon.reduce((n, g) => n + g.items.length, 0)} AI features.</strong> The
          server capability that runs them is not enabled, so the app says so when
          you open them. We list them rather than pretend.
        </p>
      </div>
      <div class="card">
        <h3 style="margin-top:0">Deliberately off</h3>
        <p style="font-size:0.95rem">
          <strong>${off.reduce((n, g) => n + g.items.length, 0)} integrations.</strong> Wearable
          sync, GPS and the coach marketplace are disabled for stated reasons. No
          data moves to or from them.
        </p>
      </div>
    </div>`;
}

function sportsSection() {
  return section({
    eyebrow: "All sports",
    heading: "Not a running app",
    intro: `<p>Vaylo Sports was built around a training log, not around one sport.
      You pick your sport — or more than one — and the app adapts. Here is the
      list the app actually offers, which is a closed list because an
      everything-for-everyone picker would be useless to you.</p>`,
    body: `      <ul class="tag-list">
${SPORTS.map((s) => `        <li>${esc(s)}</li>`).join("\n")}
      </ul>
      <div class="btn-row">
        <a class="btn btn-secondary" href="/features/">All features</a>
        <a class="btn btn-secondary" href="/legal/health-safety/">How Vaylo handles training load</a>
      </div>`,
  });
}

function featureHighlights() {
  const groups = FEATURES.filter((f) => f.status === "live").slice(0, 4);
  return `
    <div class="grid grid-2">
${groups
  .map(
    (group) => `      <div class="card">
        <h3 style="margin-top:0">${esc(group.group)}</h3>
        ${list(group.items.map((i) => `<strong>${esc(i.name)}.</strong> ${esc(i.body)}`))}
      </div>`
  )
  .join("\n")}
    </div>
    <div class="btn-row">
      <a class="btn btn-primary" href="/features/">See every feature</a>
    </div>`;
}

function pillars() {
  return section({
    eyebrow: "Why it is built this way",
    heading: "Three things Vaylo will not do",
    intro: "",
    body: `      <div class="grid grid-3">
        <div class="card">
          <h3 style="margin-top:0">It will not diagnose you</h3>
          <p>Injury Management organises a rehab a professional has already given
          you. It does not diagnose, and it carries a permanent on-screen notice
          telling you to see a physiotherapist or doctor for sharp, persistent or
          worsening pain.</p>
        </div>
        <div class="card">
          <h3 style="margin-top:0">It will not feed your data to advertisers</h3>
          <p>There is no advertising SDK, no analytics SDK and no advertising
          identifier in the app. Sponsored placements are 18+, always labelled, and
          report back to brands as anonymous counts — never your name, location or
          training data.</p>
          <p style="margin-bottom:0"><a href="/legal/advertising/">Advertising &amp; tracking disclosure</a></p>
        </div>
        <div class="card">
          <h3 style="margin-top:0">It will not hide a limitation</h3>
          <p>Where a number is plain arithmetic on what you logged, we say so. Where
          a sentence was written by a language model, we say that too — and explain
          why it can be confidently wrong.</p>
          <p style="margin-bottom:0"><a href="/legal/ai-disclaimer/">AI &amp; coaching disclaimer</a></p>
        </div>
      </div>`,
  });
}

function safetySection() {
  return section({
    className: "section-alt",
    eyebrow: "Safety",
    heading: "Built for younger athletes as well as adults",
    intro: `<p>For athletes under 18, Vaylo switches off the things a young person can
      be harmed by, and caps training volume by age. None of it is a substitute
      for a parent, a coach or a doctor.</p>`,
    body: `      <div class="grid grid-4">
        <div class="card"><h3 style="margin-top:0;font-size:1rem">No advertising</h3><p style="font-size:0.92rem">Never shown to anyone under 18. Enforced by the database, not the interface.</p></div>
        <div class="card"><h3 style="margin-top:0;font-size:1rem">No nutrition advice</h3><p style="font-size:0.92rem">Calorie and weight features are blocked for under-18s, with an explanation.</p></div>
        <div class="card"><h3 style="margin-top:0;font-size:1rem">Private by default</h3><p style="font-size:0.92rem">A minor's profile cannot be made public at all.</p></div>
        <div class="card"><h3 style="margin-top:0;font-size:1rem">Age-capped volume</h3><p style="font-size:0.92rem">Sessions, minutes and rest days capped by age band.</p></div>
      </div>
      <div class="btn-row">
        <a class="btn btn-primary" href="/safety/">Visit the Safety Centre</a>
        <a class="btn btn-secondary" href="/legal/child-safety/">Child &amp; young athlete safety</a>
      </div>`,
  });
}

function trustSection() {
  return section({
    eyebrow: "Trust",
    heading: "Read the documents before you decide",
    intro: `<p>Everything Vaylo claims about your data, its limits and its liabilities is
      written down in public, in plain English, and linked from every page of this
      site.</p>`,
    body: `      <div class="grid grid-2">
        <div class="card">
          <h3 style="margin-top:0">Your data</h3>
          <p>What is collected, why, which third parties process it, how long it is
          kept, and how to get a copy or delete it — without emailing us.</p>
          <p style="margin-bottom:0"><a href="/privacy/">Privacy &amp; data centre</a> &middot;
          <a href="/legal/privacy/">Privacy Policy</a></p>
        </div>
        <div class="card">
          <h3 style="margin-top:0">Delete your account</h3>
          <p>Self-service deletion in the app is immediate and verified. This page
          explains exactly what is removed, and what the one anonymous record is
          for.</p>
          <p style="margin-bottom:0"><a href="/delete-account/">Account deletion</a></p>
        </div>
      </div>`,
  });
}

export const home = {
  path: "/",
  title: "Training log and analysis for athletes in every sport",
  description:
    "Vaylo Sports is an all-sports training app: log sessions, understand load and recovery, find your limiter and prepare for events. Read how it handles your data and your safety.",
  updated: "2026-10-08",
  // What a search engine needs to know that the visible page does not spell out.
  //
  // The Organization node every page carries is added by site/layout.mjs, so
  // only the two homepage-only nodes are declared here.
  //
  // SoftwareApplication is deliberately incomplete, and that is the honest
  // version of it. There is no `downloadUrl`, because there is no listing to
  // point at; no `offers`, because buying is not switched on and a price would
  // be invented; and no `aggregateRating`, because nobody has rated anything.
  // Those three fields are what turn this node into a rich result, and every one
  // of them would be a fabrication today. The node states what is true — the
  // name, the category, the platform — and grows the rest when there is
  // something real to put in it.
  jsonLd: [
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: SITE.name,
      inLanguage: "en-GB",
      ...(SITE.url ? { url: SITE.url.replace(/\/+$/, "") } : {}),
    },
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: SITE.name,
      applicationCategory: "SportsApplication",
      operatingSystem: "Android",
      inLanguage: "en-GB",
      description:
        "An all-sports training log with analysis attached: record what you train, and read load, recovery, readiness and the limiter most likely holding you back.",
      ...(SITE.url ? { url: SITE.url.replace(/\/+$/, "") } : {}),
    },
  ],
  body:
    hero() +
    section({
      eyebrow: "Straight answers",
      heading: "What works, what does not, and what is switched off",
      intro: `<p>Most apps of this kind blur that line. Vaylo does not, so here it is
        before you install anything.</p>`,
      body: statusPanel(),
      className: "section-tight",
    }) +
    sportsSection() +
    section({
      eyebrow: "The app",
      heading: "What you actually get",
      intro: `<p>A summary. The full list, with the honest status of each feature, is
        on the <a href="/features/">features page</a>.</p>`,
      body: featureHighlights(),
    }) +
    pillars() +
    safetySection() +
    trustSection() +
    section({
      className: "section-alt",
      eyebrow: "Get started",
      heading: "Try Vaylo Sports",
      intro: `<p>${SITE.platforms.join(", ")} only, at the moment.</p>`,
      body: `      <div class="btn-row">
        ${storeCta()}
        <a class="btn btn-secondary" href="/support/">Support centre</a>
        <a class="btn btn-secondary" href="/about/">About Vaylo</a>
      </div>`,
    }),
};
export default home;
