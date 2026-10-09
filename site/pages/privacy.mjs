// ============================================================================
// PRIVACY & DATA CENTRE
// ----------------------------------------------------------------------------
// The user-facing answer to "what happens to my data", written so someone can
// read it in two minutes and act on it, then linked to the full policy.
//
// The three actions that matter — access, correction, deletion — are presented
// in the order that reflects how much work each one is. Download and delete are
// self-service and instant; everything else is an email.
//
// A working request form is included, because asking someone to compose an email
// is a real drop-off. It posts to the same endpoint as support, and degrades to
// the email address when the endpoint is not deployed.
// ============================================================================

import { section, list, supportForm, esc } from "../parts.mjs";

const PRIVACY_CATEGORIES = [
  { value: "privacy", label: "Access my data, correct it, or object to how it is used" },
  { value: "deletion", label: "Delete my account or my personal data" },
  { value: "general", label: "A general privacy question" },
];

function categoriesTable() {
  const rows = [
    ["Account", "Email address, display name, avatar, date of birth, sport"],
    ["Training", "Sessions you log: duration, RPE, distance, notes, form"],
    ["Measurements", "Metrics you enter, and calculations derived from them"],
    ["Health & wellness", "Only what you choose to connect or enter. Never used for advertising"],
    ["Content", "Posts, notes, profile text, images and videos you upload"],
    ["Community", "Communities, challenges, leaderboard entries, friends, blocks and reports you make"],
    ["Purchases", "Purchase and entitlement records. Not your card details &mdash; Google handles payment"],
    ["Consent", "The terms version and health consent you accepted, and when"],
    ["Technical", "Server logs: IP address, request time, device user-agent, error detail"],
  ];

  return `      <div class="table-wrap">
        <table>
          <caption>What the app collects. Nothing here is collected unless you provide it or use the feature that requires it.</caption>
          <thead><tr><th scope="col">Category</th><th scope="col">What it holds</th></tr></thead>
          <tbody>
${rows
  .map(
    ([a, b]) =>
      `            <tr><td><strong>${esc(a)}</strong></td><td>${esc(b)}</td></tr>`
  )
  .join("\n")}
          </tbody>
        </table>
      </div>`;
}

export const privacy = {
  path: "/privacy/",
  title: "Privacy & Data Centre",
  description:
    "What Vaylo Sports collects, what it does not, how to download, correct or delete your data, and how advertising and analytics work.",
  body: `
    <div class="shell">
      <div style="padding-top:2.5rem">
        <p class="eyebrow">Privacy &amp; data</p>
        <h1>What we hold, and how to get rid of it</h1>
        <p class="lead" style="margin-top:1rem">
          The full detail is in the <a href="/legal/privacy/">Privacy Policy</a>. This
          page is the short version, with the actions that matter.
        </p>
      </div>

      <div class="ok" style="margin-top:1.5rem">
        <p><strong>Downloading and deleting are self-service.</strong> Both are one tap
        in the app, both are instant, and neither needs us to approve it. You do not
        have to email anybody.</p>
      </div>
    </div>

${section({
  id: "actions",
  eyebrow: "Your actions",
  heading: "What you can do, and how",
  body: `      <div class="grid grid-3">
        <div class="card">
          <h3 style="margin-top:0">Get a copy</h3>
          <p style="font-size:0.94rem">A JSON file of everything we hold, downloaded
          straight to your device.</p>
          <p style="font-size:0.94rem"><em>Profile &rarr; Legal &amp; Safety Centre
          &rarr; Download your data</em></p>
          <p style="font-size:0.9rem;margin-bottom:0">If any part cannot be read, the
          app tells you exactly which and why, rather than sending a partial file
          quietly.</p>
        </div>
        <div class="card">
          <h3 style="margin-top:0">Correct it</h3>
          <p style="font-size:0.94rem">Edit your profile and any training entry
          directly in the app. No request needed.</p>
          <p style="font-size:0.94rem;margin-bottom:0">If something is wrong that you
          cannot edit, ask and we will fix it.</p>
        </div>
        <div class="card">
          <h3 style="margin-top:0">Delete it</h3>
          <p style="font-size:0.94rem">Delete your account and every table that can
          hold your data, verified afterwards.</p>
          <p style="font-size:0.94rem;margin-bottom:0"><a href="/delete-account/">How
          deletion works</a></p>
        </div>
      </div>
      <p style="margin-top:1rem">Anything else &mdash; restricting use, objecting,
      withdrawing consent &mdash; is an email or the form below. We respond
      <strong>within 30 days</strong>, free, wherever you live.</p>`,
})}

${section({
  className: "section-alt",
  id: "what-we-hold",
  eyebrow: "The short version",
  heading: "What the app collects",
  body: categoriesTable(),
})}

${section({
  id: "tracking",
  eyebrow: "Advertising and analytics",
  heading: "What tracking exists",
  body: `      <div class="ok">
        <p><strong>None.</strong> Vaylo Sports contains no advertising SDK, no
        analytics SDK, no third-party tracker, and no advertising identifier. The app
        does not read Google's Advertising ID.</p>
      </div>
      <p>The only advertising in the app is four sponsored placements. Each is
      always labelled, each is shown to adults only &mdash; enforced by a database
      constraint, not a screen &mdash; and each reports back to the brand as
      anonymous per-day counts of impressions and taps.</p>
      ${list([
        "A brand never receives your name, contact details, location, training data, health data, sport, age or any identifier.",
        "Athletes under 18 are excluded from sponsor reporting entirely.",
        "Your health data is never used to select, personalise or measure advertising.",
      ])}
      <p><a href="/legal/advertising/">Full advertising &amp; tracking disclosure</a>
      &middot; <a href="/legal/cookies/">Cookie policy</a></p>`,
})}

${section({
  className: "section-alt",
  id: "third-parties",
  eyebrow: "Who else processes it",
  heading: "The complete list of third parties",
  body: `      <div class="table-wrap">
        <table>
          <thead><tr><th scope="col">Provider</th><th scope="col">Why</th><th scope="col">What they receive</th></tr></thead>
          <tbody>
            <tr><td><strong>Supabase</strong></td><td>Database, sign-in, file storage, server functions</td><td>Your data, on our instruction</td></tr>
            <tr><td><strong>OpenAI</strong></td><td>Generating AI coaching text, when you use those features</td><td>Only the text needed for the feature you used</td></tr>
            <tr><td><strong>Google</strong></td><td>AI model for video analysis; Android distribution and billing</td><td>Only what each of those requires</td></tr>
            <tr><td><strong>Discord, Facebook</strong></td><td>Optional third-party sign-in</td><td>They confirm your identity. We send them no training data</td></tr>
            <tr><td><strong>Google Play Billing</strong></td><td>Taking payments</td><td>They process payment. We never see your card details</td></tr>
            <tr><td><strong>Wearable providers</strong></td><td>Strava, Garmin, Fitbit, Oura, WHOOP, Polar, Suunto, COROS</td><td><strong>Nothing.</strong> This integration is switched off, so no connection is made</td></tr>
          </tbody>
        </table>
      </div>
      <div class="note">
        <p><strong>Wearable sync is off right now.</strong> We list it because it is
        written into the app, not because it is active. Nothing is exchanged.</p>
      </div>`,
})}

${section({
  className: "section-alt",
  id: "children",
  eyebrow: "Children",
  heading: "If you are under 18",
  body: `      ${list([
        "Advertising is never shown to you, and your activity is never counted in sponsor reporting.",
        "Nutrition and calorie features are switched off entirely.",
        "Your profile is private by default and cannot be made public.",
        "Training volume is capped by your age band, with more frequent deload weeks.",
      ])}
      <p>A parent or guardian can ask us to delete your account at any time, without
      giving a reason. <a href="/legal/child-safety/">Child &amp; young athlete safety</a></p>`,
})}

${section({
  id: "request",
  eyebrow: "Make a request",
  heading: "Ask for access, correction or deletion",
  intro: `<p>Use the form below, or email
    <a href="mailto:CONTACT_EMAIL_PLACEHOLDER">the contact address</a>. Include the
    email address on your Vaylo account so we can find you.</p>`,
  body: `    <div class="grid grid-2" style="align-items:start">
      <div class="card">
${supportForm({
  id: "privacy",
  categories: PRIVACY_CATEGORIES,
  heading: "Your data request",
  intro: `<p>We respond within 30 days and do not charge.</p>`,
  submitLabel: "Send request",
  showSubject: true,
  accountRefHint: "The email address on your Vaylo account. We cannot find your account without it.",
  // This page IS the privacy centre, so the default note's link to it would
  // point at the reader's own screen. Point at the document that sets out what
  // happens to the request instead.
  privacyNote:
    'What you send is used to answer this request and for nothing else. It is not ' +
    'added to a mailing list and it is not sold or shared. Your rights over what we ' +
    'already hold are set out in <a href="/legal/data-rights/">Your Data Rights</a>.',
})}
      </div>
      <div>
        <div class="card">
          <h3 style="margin-top:0">You can also complain</h3>
          <p>You do not have to come to us first. In the UK you can complain to the
          <strong>Information Commissioner&rsquo;s Office</strong> at any time, and
          elsewhere in the EU to the authority where you live.</p>
          <p style="margin-bottom:0">Nothing in our terms prevents you complaining,
          to us or to anyone else.</p>
        </div>
        <div class="card" style="margin-top:1rem">
          <h3 style="margin-top:0">One thing we have not settled</h3>
          <p>The exact retention period for server logs &mdash; which can include your
          IP address and device details &mdash; is not yet decided, so it is not
          published as a number. Your account data is kept until you delete it, and
          purchase records for as long as tax law requires.</p>
          <p style="margin-bottom:0"><a href="/legal/data-rights/">Your data rights in full</a></p>
        </div>
      </div>
    </div>`,
})}`,
};
export default privacy;
