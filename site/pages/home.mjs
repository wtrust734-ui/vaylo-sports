// ============================================================================
// HOMEPAGE
// ----------------------------------------------------------------------------
// The brief for this page is that it must not overclaim — and, since the 2026
// rebuild, that it must also be worth reading. Those are not in tension. What
// the page is not allowed to do is the usual sports-app homepage: no "world's
// best", no guaranteed improvement, no medical-adjacent benefit claims, no
// invented statistics, no partner logos, no fake screenshots.
//
// What it does instead:
//
//   * Opens with one sentence about what the product is, and four numbers that
//     are counted from the app's own feature list rather than typed here.
//   * Draws a training week rather than photographing one. The signal panel is
//     SVG, labelled as an illustration, and makes no claim to be a screenshot.
//   * Tells the story: idea in 2024, building from 2025, still building in
//     2026, launch in 2027.
//   * Lists what the app actually does as a numbered ledger, then separates
//     what works today from what is built but switched off.
//
// Every section here is reachable by a link, every count is derived, and every
// claim that needs a document links to it.
// ============================================================================

import { SITE, SPORTS, FEATURES } from "../data/site.mjs";
import { section, list, storeCta, esc } from "../parts.mjs";

/** The live feature count, computed so the copy cannot drift from the data. */
const liveGroups = FEATURES.filter((f) => f.status === "live");
const liveCount = liveGroups.reduce((n, g) => n + g.items.length, 0);
const soonCount = FEATURES.filter((f) => f.status === "soon").reduce(
  (n, g) => n + g.items.length,
  0
);
const offCount = FEATURES.filter((f) => f.status === "off").reduce(
  (n, g) => n + g.items.length,
  0
);

/** A stat cell. `count` is the number the counter animates to. */
function stat(count, label, suffix = "") {
  return `        <div>
          <span class="stat-num" data-count="${count}"${suffix ? ` data-suffix="${esc(suffix)}"` : ""}>${count}${esc(suffix)}</span>
          <span class="stat-label">${esc(label)}</span>
        </div>`;
}

/**
 * The drawn training week beside the headline.
 *
 * It is a chart of a shape, not of a person: the line is hand-written path data
 * and the only numbers on it are day labels. The caption says so in the page,
 * and the whole panel is aria-hidden with a text alternative underneath —
 * there is no information in it a screen reader needs, and describing a
 * decorative curve wastes a reader's time.
 */
function signalPanel() {
  return `      <div>
      <div class="signal" aria-hidden="true">
        <div class="signal-head">
          <span class="signal-title">A training week</span>
          <span class="signal-tag">Illustration</span>
        </div>
        <svg viewBox="0 0 320 152" role="presentation" focusable="false">
          <line class="grid-line" x1="0" y1="26" x2="320" y2="26" />
          <line class="grid-line" x1="0" y1="66" x2="320" y2="66" />
          <line class="grid-line" x1="0" y1="106" x2="320" y2="106" />
          <line class="flag-line" x1="0" y1="42" x2="320" y2="42" />
          <circle class="flag-dot" cx="268" cy="42" r="2.5" />
          <path
            class="load-fill"
            d="M0 118 C 22 112, 38 98, 56 100 S 86 86, 106 88 S 138 62, 160 68 S 194 46, 214 54 S 248 32, 268 36 S 300 22, 320 26 L320 150 L0 150 Z"
          />
          <path
            class="load-line"
            d="M0 118 C 22 112, 38 98, 56 100 S 86 86, 106 88 S 138 62, 160 68 S 194 46, 214 54 S 248 32, 268 36 S 300 22, 320 26"
          />
          <text class="axis-label" x="0" y="150">MON</text>
          <text class="axis-label" x="52" y="150">TUE</text>
          <text class="axis-label" x="104" y="150">WED</text>
          <text class="axis-label" x="156" y="150">THU</text>
          <text class="axis-label" x="208" y="150">FRI</text>
          <text class="axis-label" x="260" y="150">SAT</text>
          <text class="axis-label" x="304" y="150">SUN</text>
        </svg>
        <div class="signal-foot">
          <span><b>Acute load</b> and the ramp it flags</span>
          <span><b>Arithmetic</b> on your own sessions</span>
        </div>
      </div>
      <p class="visually-hidden">
        Decorative illustration: a line rising across a seven-day week, with a
        threshold marked on Saturday.
      </p>
      </div>`;
}

function hero() {
  return `
  <section class="hero">
    <div class="shell hero-grid hero-lift">
      <div>
        <p class="hero-meta">
          <span class="dot" aria-hidden="true"></span>
          <span>An independent build</span>
          <span aria-hidden="true">&middot;</span>
          <span>Building since 2025</span>
          <span aria-hidden="true">&middot;</span>
          <span>${esc(SITE.platforms.join(" / "))}</span>
        </p>

        <h1>
          <span class="hero-line">Your training,</span>
          <span class="hero-line">read back</span>
          <span class="hero-line">to you.</span>
        </h1>

        <p class="hero-sub">
          Vaylo Sports is a training log that works across every sport you play,
          and then does something with the record: load, readiness, recovery and
          the one limiter most likely holding you back &mdash; calculated from
          what you actually logged, not from a template.
        </p>

        <div class="btn-row">
          <a class="btn btn-primary" href="/features/">See what is in the app</a>
          <a class="btn btn-secondary" href="#story">Read the story</a>
        </div>

        <div class="hero-strip">
${stat(SPORTS.length, "sports in the picker")}
${stat(liveCount, "features working today")}
${stat(0, "ad or analytics SDKs")}
${stat(2027, "launch year")}
        </div>
      </div>

${signalPanel()}
    </div>
  </section>`;
}

/**
 * The sport band.
 *
 * The list is rendered twice, the second copy aria-hidden, so the CSS marquee
 * can translate by exactly -50% and loop without a seam. site.js is not
 * involved: without scripting it still reads as a wrapped row of sports.
 */
function sportBand() {
  const items = SPORTS.map((s) => `<li>${esc(s)}</li>`).join("");
  return `
  <div class="sport-band">
    <div class="marquee" aria-label="Sports in the picker">
      <ul>${items}</ul>
      <ul aria-hidden="true">${items}</ul>
    </div>
  </div>`;
}

/**
 * The story.
 *
 * Four years, four lines, in the owner's own sequence: the idea in 2024, the
 * first build in 2025, the long build through 2026, launch in 2027. 2026 is
 * marked as the current year in the markup rather than by a script, because the
 * sitemap's dates and this page's copy are both hand-maintained and a page that
 * silently rewrites itself is one more thing that can be wrong.
 */
function story() {
  const items = [
    {
      year: "2024",
      tag: "The idea",
      body: "Vaylo started as a question rather than a product: if a training log already knows every session you have done, why is it still only showing you a calendar? The idea was to make the record answer back.",
    },
    {
      year: "2025",
      tag: "The first build",
      body: "Building began, one screen at a time: log a session, read the load it added, keep the plan honest against the week that actually happened. Everything that could be arithmetic on your own data was built as arithmetic, not as a guess dressed up as AI.",
    },
    {
      year: "2026",
      tag: "Still building",
      body: "The year spent turning a working app into a product that can be trusted: the safety rules for younger athletes, the documents behind every claim, the parts of the app that should say no. It is slower than adding features, and it is the reason the app can be launched at all.",
      now: true,
    },
    {
      year: "2027",
      tag: "Launch",
      body: "The Android release opens in 2027. The waiting list is open now, and it is used for one thing: telling you when that happens.",
    },
  ];

  return `
  <section class="story" id="story">
    <div class="shell story-grid">
      <div>
        <p class="chapter-label"><b>01</b> The story</p>
        <h2>Built in the open,<br />slowly on purpose.</h2>
        <p class="story-lead" style="margin-top:1.25rem">
          Vaylo Sports is not a studio's product. It is one build, started from
          an idea in 2024, written through 2025 and 2026, and launching in 2027.
        </p>
        <p>
          That pace is deliberate. A training app is trusted with the one thing
          an athlete has least of &mdash; recovery capacity &mdash; so the
          features that could do harm were the last ones added and the first
          ones constrained.
        </p>
        <p class="muted" style="font-size:0.9rem">
          The full account, including what is still missing, is on the
          <a href="/about/">About page</a>.
        </p>
      </div>

      <div class="timeline">
        <div class="timeline-rail" aria-hidden="true"><div class="timeline-fill"></div></div>
${items
  .map(
    (item) => `        <div class="tl-item${item.now ? " is-now" : ""}">
          <p class="tl-year">${item.year}${item.now ? '<span class="tl-tag">Now</span>' : ""}</p>
          <p style="margin-top:0.2rem"><strong>${esc(item.tag)}.</strong> ${esc(item.body)}</p>
        </div>`
  )
  .join("\n")}
      </div>
    </div>
  </section>`;
}

/**
 * What the app does, as a numbered ledger.
 *
 * Six rows, each one a real capability and each linked to the matching anchor
 * on the features page. A grid of identical cards was the alternative; a
 * numbered list reads as an inventory, which is what this is.
 */
function capabilities() {
  const caps = [
    {
      name: "Log the session",
      href: "/features/#performance-log",
      body: "Sport, duration, RPE, notes, how it felt. The Performance Log is the record every other number is calculated from.",
    },
    {
      name: "Read the load",
      href: "/features/#performance-dashboard",
      body: "Acute load, the acute-to-chronic ratio, readiness and recovery, read against your own history rather than a population average.",
    },
    {
      name: "Find the limiter",
      href: "/features/#limiter-test",
      body: "A test that names the one thing most likely to be holding you back, so the next block of training has a target.",
    },
    {
      name: "Prepare for the event",
      href: "/features/#event-packs",
      body: "Structured programmes towards a date, with a taper and race-day guidance, plus recurring routines for the weeks in between.",
    },
    {
      name: "Recover on purpose",
      href: "/features/#recovery-tracking",
      body: "Sleep, soreness, mood and energy beside the load that produced them &mdash; and an injury scaffold that organises rehab you were already given, without diagnosing anything.",
    },
    {
      name: "Learn the sport",
      href: "/features/#learning-hub",
      body: "Written lessons, drills and quizzes, including load management for growing athletes, plus tactical notes on the opponents you actually face.",
    },
  ];

  return `
${caps
  .map(
    (cap, i) => `        <a class="cap" href="${cap.href}">
          <span class="cap-num">${String(i + 1).padStart(2, "0")}</span>
          <span>
            <h3>${esc(cap.name)}</h3>
            <p>${cap.body}</p>
          </span>
          <span class="cap-arrow" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M9 7h8v8" /></svg>
          </span>
        </a>`
  )
  .join("\n")}`;
}

/** The honesty panel — what works, what is built, what is switched off. */
function statusPanel() {
  return `
    <div class="grid grid-3">
      <div class="card">
        <h3 style="margin-top:0">Working today</h3>
        <p style="font-size:0.95rem">
          <strong>${liveCount} features across ${liveGroups.length} areas</strong> &mdash;
          logging, metrics, the Limiter Test, injury scaffolding, nutrition, the
          Learning Hub, event packs and the community side. Open the app and they run.
        </p>
      </div>
      <div class="card">
        <h3 style="margin-top:0">Built, not yet switched on</h3>
        <p style="font-size:0.95rem">
          <strong>${soonCount} AI features.</strong> The server capability that runs them
          is not enabled, so the app says so when you open them. We list them rather
          than pretend.
        </p>
      </div>
      <div class="card">
        <h3 style="margin-top:0">Deliberately off</h3>
        <p style="font-size:0.95rem">
          <strong>${offCount} integrations.</strong> Wearable sync, GPS and the coach
          marketplace are disabled for stated reasons. No data moves to or from them.
        </p>
      </div>
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
          report back to brands as anonymous counts &mdash; never your name, location or
          training data.</p>
          <p style="margin-bottom:0"><a href="/legal/advertising/">Advertising &amp; tracking disclosure</a></p>
        </div>
        <div class="card">
          <h3 style="margin-top:0">It will not hide a limitation</h3>
          <p>Where a number is plain arithmetic on what you logged, we say so. Where
          a sentence was written by a language model, we say that too &mdash; and explain
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
          kept, and how to get a copy or delete it &mdash; without emailing us.</p>
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

function closing() {
  return `
  <section class="closing">
    <div class="shell">
      <p class="chapter-label"><b>03</b> Launching 2027</p>
      <h2>The app arrives in 2027.<br />The list opens now.</h2>
      <p>
        Android only, at least at first. Join the waiting list and you will get one
        email: the one that says it is out. No newsletter, no marketing sequence,
        and no sharing of your address with anyone.
      </p>
      <div class="btn-row">
        <a class="btn btn-primary" href="/waitlist/">Join the waiting list</a>
        <a class="btn btn-secondary" href="/features/">See every feature</a>
        ${SITE.playStoreUrl ? "" : '<a class="btn btn-secondary" href="/support/">Support</a>'}
      </div>
    </div>
  </section>`;
}

export const home = {
  path: "/",
  title: "Training log and analysis for athletes in every sport",
  description:
    "Vaylo Sports is an all-sports training app: log sessions, understand load and recovery, find your limiter and prepare for events. Building since 2025, launching on Android in 2027.",
  updated: "2026-10-23",
  // What a search engine needs to know that the visible page does not spell out.
  //
  // The Organization node every page carries is added by site/layout.mjs, so
  // only the two homepage-only nodes are declared here. SoftwareApplication is
  // deliberately incomplete: no downloadUrl (there is no listing), no offers
  // (buying is not switched on) and no aggregateRating (nobody has rated
  // anything). Those three fields are what make a rich result, and each would be
  // a fabrication today.
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
    sportBand() +
    story() +
    section({
      eyebrow: "The app",
      heading: "What it actually does",
      intro: `<p class="chapter-label"><b>02</b> What it does</p>
        <p>Six things, in the order an athlete meets them. The full inventory,
        including what is built but not switched on, is on the
        <a href="/features/">features page</a>.</p>`,
      body: `<div class="caps">
${capabilities()}
      </div>`,
    }) +
    section({
      eyebrow: "Straight answers",
      heading: "What works, what does not, and what is switched off",
      intro: `<p>Most apps of this kind blur that line. Vaylo does not, so here it is
        before you install anything.</p>`,
      body: statusPanel(),
      className: "section-tight",
    }) +
    pillars() +
    safetySection() +
    trustSection() +
    closing(),
};
export default home;
