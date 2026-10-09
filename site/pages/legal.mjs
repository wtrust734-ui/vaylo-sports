// ============================================================================
// LEGAL CENTRE
// ----------------------------------------------------------------------------
// The index of the published documents. It does not restate their content —
// each is the document itself, served from the same source the Play Console
// link points at, so there is one version of every policy rather than a website
// copy and a store copy that drift apart.
//
// It also answers the one question the index cannot: how to delete your account
// and its data from inside the app, step by step, with the labels an athlete
// will actually see on the screen in front of them.
// ============================================================================

import { LEGAL_DOCUMENTS } from "../data/site.mjs";
import { section, list, esc } from "../parts.mjs";

function docList(filter) {
  return `      <ul class="doc-index">
${LEGAL_DOCUMENTS.filter(filter)
  .map(
    (doc) => `        <li>
          <a href="/legal/${doc.slug}/">
            <span class="t">${esc(doc.title)}</span>
            <span class="d">${esc(doc.summary)}</span>
          </a>
        </li>`
  )
  .join("\n")}
      </ul>`;
}

export const legal = {
  path: "/legal/",
  title: "Legal Centre",
  description:
    "Every Vaylo Sports legal document in plain English: privacy, terms, AI disclaimers, safety notices, community guidelines, reporting routes, purchases, refunds, data rights and more.",
  body: `
    <div class="shell">
      <div style="padding-top:2.5rem">
        <p class="eyebrow">Legal Centre</p>
        <h1>Every Vaylo Sports document</h1>
        <p class="lead" style="margin-top:1rem">
          Written in plain English, describing what the app actually does. These
          are the same documents the app links to, so there is one version of each
          rather than a website copy and a store copy.
        </p>
      </div>

      <div class="note">
        <p><strong>These documents do not make Vaylo risk-free, and they are not a
        claim of compliance.</strong> They describe the product honestly. Reading
        them does not replace legal advice, and they cannot remove our
        responsibility for what the app does.</p>
      </div>

      <h2>Core</h2>
${docList((d) => ["privacy", "terms", "account-deletion"].includes(d.slug))}

      <h2>Safety</h2>
${docList((d) =>
  [
    "child-safety",
    "community-guidelines",
    "health-safety",
    "injury-guidance",
    "nutrition-disclaimer",
    "mental-wellbeing",
  ].includes(d.slug)
)}

      <h2>Reporting and complaints</h2>
${docList((d) =>
  [
    "report-safety-concern",
    "report-content",
    "complaints",
    "security-disclosure",
  ].includes(d.slug)
)}

      <h2>Money</h2>
${docList((d) =>
  ["purchases", "refunds", "competition-terms"].includes(d.slug)
)}

      <h2>Data and technology</h2>
${docList((d) =>
  [
    "ai-disclaimer",
    "ai-data-use",
    "ai-training-advice",
    "video-analysis-disclaimer",
    "wearable-health-privacy",
    "data-rights",
    "cookies",
    "advertising",
    "intellectual-property",
  ].includes(d.slug)
)}

      <h2>Contact</h2>
${docList((d) => ["terms", "contact", "waitlist-terms"].includes(d.slug))}
    </div>

${section({
  id: "delete-your-data",
  className: "section-alt",
  eyebrow: "Delete your data",
  heading: "How to delete everything, from inside the app",
  intro: `<p>You do not need to email us, and you do not need to give a reason.
    Deletion is self-service in the Android app, it takes effect immediately, and
    the app reports what it removed rather than claiming success.</p>`,
  body: `      <ol class="prose-list">
        <li><strong>Open Vaylo Sports and sign in.</strong> Deletion is tied to your
        account, so it has to be your session.</li>
        <li><strong>Go to the Profile tab.</strong></li>
        <li><strong>Scroll to the bottom and tap <em>Delete account
        permanently</em>.</strong> It sits under <em>Sign Out</em>. The same screen
        is reachable from <em>Profile &rarr; Legal &amp; Safety &rarr; Delete your
        account</em>.</li>        <li><strong>Confirm it is you.</strong> The next screen asks for it
        deliberately, so a session left open on a shared phone cannot destroy
        somebody else's account. Enter your password and tap <em>Verify</em> —
        or, if you do not sign in with a password, tap <em>Re-authenticate</em>
        and sign in with the provider you normally use.</li>
        <li><strong>Type <code>DELETE MY ACCOUNT</code>.</strong> Exactly that, in
        capitals.</li>
        <li><strong>Tick the acknowledgement box</strong> that says you understand
        the deletion is permanent and cannot be recovered.</li>
        <li><strong>Tap <em>Delete Account</em>, then <em>Permanently
        Delete</em></strong> in the confirmation that appears.</li>
        <li><strong>Nothing else is needed.</strong> The account, its login and
        every table that can hold your data are deleted straight away, and you
        are signed out.</li>
      </ol>

      <h3>Do these two things first</h3>
      <div class="note">
        <p><strong>Download your data.</strong> <em>Profile &rarr; Legal &amp;
        Safety &rarr; Download your data</em> produces a JSON file of everything we
        hold: profile, training, health, social and purchase records. It takes
        seconds, and it cannot be done afterwards.</p>
        <p style="margin-bottom:0"><strong>Cancel any Google Play
        subscription.</strong> Deleting your Vaylo account does not cancel a
        subscription bought through Google Play, and an app you have deleted is
        not somewhere you can cancel it from. Play Store &rarr; <em>Payments &amp;
        subscriptions</em>.</p>
      </div>

      <h3>What is removed, and the three things that are not</h3>
      <p>Everything is removed: your profile, every training session and derived
      metric, connected health data, posts, communities, challenges, messages,
      friendships, uploads, purchase and entitlement records, reports you filed,
      and the sign-in itself.</p>
      <p>Three things survive, and the
      <a href="/legal/account-deletion/">Account Deletion notice</a> names each
      one:</p>
      ${list([
        "<strong>One anonymous deletion record</strong> — a salted hash of your user id, a status and a timestamp. No name, no email, and nothing the account can be rebuilt from.",
        "<strong>Purchase and tax records</strong>, kept for as long as accounting law requires, separate from your profile and no longer linked to your user id.",
        "<strong>Nothing else.</strong> If you believe something of yours survived that is not on that list, tell us and we will check it rather than reassure you.",
      ])}

      <h3>If you cannot get into the app</h3>
      <p>Email the address on the account from that address if you still have it,
      and we will delete the account and confirm when it is done. That route is a
      request rather than an instant action, because we have to verify you are the
      account owner before destroying anything.</p>

      <div class="btn-row">
        <a class="btn btn-primary" href="/delete-account/">The full deletion route</a>
        <a class="btn btn-secondary" href="/legal/account-deletion/">Account Deletion notice</a>
        <a class="btn btn-secondary" href="/legal/data-rights/">Your data rights</a>
      </div>`,
})}`,
};
export default legal;
