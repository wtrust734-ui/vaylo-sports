// ============================================================================
// ACCOUNT DELETION
// ----------------------------------------------------------------------------
// This page exists because Google Play requires a reachable URL explaining how
// a user can request account deletion, and because it is simply the page people
// need.
//
// Two rules govern everything here:
//
//   1. Never say anything has been deleted when it has not. The in-app route
//      really does delete, and says so. The web route *requests* a deletion, and
//      the page says exactly that, because the backend requires a fresh
//      authenticated token proving you are the account owner and a website form
//      cannot supply one.
//
//   2. Say what survives. A deletion that quietly keeps something is worse than
//      one that admits it, because people make decisions on the assumption that
//      "deleted" means gone.
// ============================================================================

import { section, list, supportForm, esc } from "../parts.mjs";

const DELETION_CATEGORIES = [
  {
    value: "deletion",
    label: "Delete my Vaylo Sports account and its data",
  },
  {
    value: "privacy",
    label: "Delete my personal data but keep my account",
  },
  { value: "general", label: "A question about deletion before I decide" },
];

/** What the deletion function removes. Kept in step with _shared/userTables.ts. */
const REMOVED = [
  "Your profile, avatar and account settings",
  "Every training session, measurement and derived metric",
  "Health and wellness data you connected or entered",
  "Everything you posted: shared activities, notes, images and videos",
  "Communities, challenges and leaderboard entries",
  "Messages and friend connections",
  "Purchase and entitlement records linked to your user id",
  "Uploaded files, including form-analysis video",
  "Reports you filed about other content",
  "The sign-in itself, so the login can no longer be used",
];

export const deleteAccount = {
  path: "/delete-account/",
  title: "Delete your account",
  description:
    "How to delete your Vaylo Sports account and all its data: the instant in-app route, the web request route, what is removed, and what survives.",
  body: `
    <div class="shell">
      <div style="padding-top:2.5rem">
        <p class="eyebrow">Account</p>
        <h1>Delete your Vaylo Sports account</h1>
        <p class="lead" style="margin-top:1rem">
          You can do this yourself, in the app, without asking us and without giving
          a reason. It is immediate and it is not reversible.
        </p>
      </div>

      <div class="ok" style="margin-top:1.5rem">
        <p><strong>Fastest route:</strong> in the app, go to
        <em>Profile &rarr; Delete account permanently</em>. It re-asks you to
        confirm, then deletes and verifies. No email, no waiting, no approval.</p>
      </div>
    </div>

${section({
  id: "how",
  eyebrow: "Self-service",
  heading: "Deleting in the app",
  body: `      <ol class="prose-list">
        <li>Open the app, sign in, and go to the <strong>Profile</strong> tab.</li>
        <li>Scroll to the bottom and tap <strong>Delete account permanently</strong>,
        which sits under <em>Sign Out</em>. The same screen is reachable from
        <em>Profile &rarr; Legal &amp; Safety &rarr; Delete your account</em>.</li>
        <li>Confirm it is you. Enter your password and tap <strong>Verify</strong>. If
        you do not sign in with a password, tap <strong>Re-authenticate</strong> and
        sign in with the provider you normally use. This is deliberate: deletion asks
        for a fresh sign-in so a session left open on a shared device cannot destroy
        somebody else&rsquo;s account.</li>
        <li>Type <strong>DELETE MY ACCOUNT</strong> and tick the acknowledgement box.</li>
        <li>Tap <strong>Delete Account</strong>, then <strong>Permanently
        Delete</strong>. The app runs the deletion and checks afterwards that nothing
        remains in any table that can hold your data.</li>
      </ol>
      <div class="note">
        <p><strong>What you see afterwards is a verified result, not a promise.</strong>
        The app counts rows in every table that can hold your data and tells you what
        it found. If anything survived, it says so rather than claiming success.</p>
      </div>`,
})}

${section({
  className: "section-alt",
  id: "web",
  eyebrow: "From the web",
  heading: "Requesting deletion without the app",
  body: `      <p>If you cannot get into the app &mdash; no longer have access to the email,
      or you would simply rather not use the app &mdash; you can ask us to delete the
      account. <strong>This is a request, and we will confirm when it is done. It is
      not instant, because we have to verify that you are the account owner before
      destroying anything.</strong></p>
      ${list([
        "<strong>Include the email address the Vaylo account was created with.</strong> Without it we cannot find the account, and we will not guess.",
        "<strong>We will reply to that address</strong> to confirm who we think you are before deleting anything.",
        `<strong>If you cannot access that address</strong>, tell us what else you can
        prove &mdash; username, approximate sign-up date &mdash; and we will work through it with you.`,
        "<strong>Download your data first</strong> if you want a copy. Deletion cannot be undone.",
      ])}
      <p>The full process, including verification and everything that is removed, is
      in the <a href="/legal/account-deletion/">Account Deletion notice</a>.</p>`,
})}

${section({
  id: "removed",
  eyebrow: "What happens",
  heading: "What deletion removes",
  body: `      ${list(REMOVED)}
      <h3>What survives, and why</h3>
      <div class="note">
        <p><strong>One anonymous record.</strong> A salted hash of your user id, a
        status and a timestamp. No name, no email, nothing that identifies you, and
        nothing from which your account can be reconstructed.</p>
        <p><strong>Purchase and tax records.</strong> Kept as long as accounting law
        requires, separate from your profile and unlinked to your user id. This is a
        legal obligation, not a choice.</p>
        <p style="margin-bottom:0"><strong>Nothing else.</strong> If you think
        something of yours survives that is not on this list, tell us and we will
        check it.</p>
      </div>`,
})}

${section({
  className: "section-alt",
  id: "things-to-do-first",
  eyebrow: "Before you go",
  heading: "Three things worth doing first",
  body: `      <ol class="prose-list">
        <li><strong>Cancel any subscription in Google Play.</strong> Deleting your Vaylo
        account does <em>not</em> cancel a Google Play subscription, and an app you
        have deleted is not somewhere you can cancel from. Play Store &rarr;
        <em>Payments &amp; subscriptions</em>.</li>
        <li><strong>Download your data.</strong>
        <em>Profile &rarr; Legal &amp; Safety Centre &rarr; Download your data</em>.
        It takes seconds and it cannot be done afterwards.</li>
        <li><strong>Note down anything you will miss.</strong> Unspent credits and
        coins are lost with the account. Some things &mdash; an injury history, the
        notes on a rehab &mdash; are genuinely hard to recreate.</li>
      </ol>
      <div class="warn">
        <p><strong>Deletion cannot be undone.</strong> There is no recovery window and
        no support ticket that can bring the account back. Make sure you have what
        you need first.</p>
      </div>`,
})}

${section({
  id: "request",
  eyebrow: "Make a request",
  heading: "Request deletion by email or form",
  intro: `<p>Either route reaches the same place. Both are read by a person.</p>`,
  body: `    <div class="grid grid-2" style="align-items:start">
      <div class="card">
${supportForm({
  id: "deletion",
  categories: DELETION_CATEGORIES,
  heading: "Request account deletion",
  intro: `<p>We will reply to confirm before anything is removed. Nothing is deleted
          by submitting this form.</p>`,
  submitLabel: "Request deletion",
  accountRefHint:
    "The email address your Vaylo account was created with. Without it we cannot find your account, and we will not guess.",
  showSubject: false,
})}
      </div>
      <div>
        <div class="card">
          <h3 style="margin-top:0">Or email us</h3>
          <p>If you would rather not use a form, email
          <a href="mailto:CONTACT_EMAIL_PLACEHOLDER">the contact address</a> with the
          email address your Vaylo account was created with.</p>
          <p style="margin-bottom:0">A parent or guardian can request deletion of a
          child&rsquo;s account at any time, without giving a reason, and we do it.</p>
        </div>
        <div class="card" style="margin-top:1rem">
          <h3 style="margin-top:0">Deleting only some of your data</h3>
          <p>You do not have to delete everything to stop sharing it. Disconnecting
          Health Connect or a wearable stops that data being used, and privacy
          settings control what leaves your account.</p>
          <p style="margin-bottom:0"><a href="/privacy/">Privacy &amp; data centre</a></p>
        </div>
        <div class="card" style="margin-top:1rem">
          <h3 style="margin-top:0">Something is wrong instead</h3>
          <p>If you want an account deleted because of something that happened on
          Vaylo &mdash; harassment, a breach, a safety failure &mdash; please say so in
          the message. Those are not routine requests and we do not treat them as
          routine.</p>
          <p style="margin-bottom:0"><a href="/safety/">Safety Centre</a></p>
        </div>
      </div>
    </div>`,
})}

${section({
  className: "section-alt",
  eyebrow: "Related",
  heading: "Documents",
  body: `      <div class="btn-row">
        <a class="btn btn-secondary" href="/legal/account-deletion/">Account deletion notice</a>
        <a class="btn btn-secondary" href="/legal/data-rights/">Your data rights</a>
        <a class="btn btn-secondary" href="/privacy/">Privacy &amp; data centre</a>
        <a class="btn btn-secondary" href="/support/">Support</a>
      </div>`,
})}`,
};
export default deleteAccount;
