// ============================================================================
// SUPPORT REQUEST — form that emails the operator
// ----------------------------------------------------------------------------
// Every submitted message is stored in `support_requests` and emailed to the
// operator's inbox, with a one-click control so a reply address can end it.
// The form posts to the `support-request` edge function, which stores the row
// and then mails it using the same SMTP client already proven working for the
// waiting-list mail. If that endpoint is not deployed, the form degrades to
// the plain mailto link on the page.
// ============================================================================

import { section, list, supportForm, SUPPORT_CATEGORIES, esc } from "../parts.mjs";

export const support = {
  path: "/support/",
  title: "Support Centre",
  description:
    "Get help with Vaylo Sports: account problems, privacy and data requests, safety and child-safety reports, purchases, bugs and copyright complaints. Use the form below to email the operator.",
  body: `
    <div class="shell">
      <div style="padding-top:2.5rem">
        <p class="eyebrow">Support</p>
        <h1>Support Centre</h1>
        <p class="lead" style="margin-top:1rem">
          Start with the shortcuts below &mdash; most questions are answered faster by
          doing it yourself than by waiting for us. If none of them works, the form
          at the bottom reaches a person and sends them an email.
        </p>
      </div>
    </div>

${section({
  id: "self-service",
  eyebrow: "Do it yourself",
  heading: "Instant, no waiting",
  body: `      <div class="table-wrap">
        <table>
          <caption>Every action below works immediately and needs no email.</caption>
          <thead><tr><th scope="col">What you want</th><th scope="col">Where</th></tr></thead>
          <tbody>
            <tr><td><strong>Download everything we hold about you</strong></td><td>In the app: <em>Profile &rarr; Legal &amp; Safety Centre &rarr; Download your data</em></td></tr>
            <tr><td><strong>Delete your account and its data</strong></td><td>In the app: <em>Profile &rarr; Delete account permanently</em> &mdash; or <a href="/delete-account/">the full process here</a></td></tr>
            <tr><td><strong>Correct your details or a training entry</strong></td><td>Edit directly in the app</td></tr>
            <tr><td><strong>Change who can see your profile</strong></td><td>Privacy settings in your profile. Private by default</td></tr>
            <tr><td><strong>Stop sharing health data</strong></td><td>Disconnect Health Connect or any wearable</td></tr>
            <tr><td><strong>Report harmful content</strong></td><td>The <em>Report</em> control on the post or profile</td></tr>
            <tr><td><strong>Stop seeing someone</strong></td><td><em>Block</em> on their profile. They are not told</td></tr>
            <tr><td><strong>Cancel a subscription</strong></td><td>Google Play &rarr; <em>Payments &amp; subscriptions</em></td></tr>
            <tr><td><strong>Request a refund</strong></td><td>Google Play for the charge, and us for the service &mdash; <a href="/legal/refunds/">how refunds work</a></td></tr>
          </tbody>
        </table>
      </div>`,
})}

${section({
  className: "section-alt",
  id: "urgent",
  eyebrow: "Before you write",
  heading: "Urgent and safety issues",
  body: `      <div class="note" style="max-width:52rem">
        <p><strong>If a child is at immediate risk, call the police or the NSPCC
        Child Protection Helpline on 0808 8000 111 &mdash; do not wait for us.</strong></p>
        <p><strong>If you cannot sign in and the account is locked, email us and we
        will get you in.</strong> Do not keep trying, or the account can lock further.</p>
        <p><strong>If you have been charged and not received what you paid for, or a
        subscription does not cancel, tell us now.</strong> Refunds and cancellations
        are handled as soon as the charge is confirmed.</p>
      </div>`,
})}

${section({
  id: "how-we-reply",
  eyebrow: "What happens next",
  heading: "What an email to us looks like",
  body: `      <ul class="prose-list">
        <li><strong>You send us an email</strong> &mdash; from the form below or by replying to a received reply.</li>
        <li><strong>We store it</strong> &mdash; in the <em>support_requests</em> inbox, which only the operator can see.</li>
        <li><strong>Nothing is sent anywhere else</strong> &mdash; we do not add you to a mailing list, and we have no marketing list.</li>
        <li><strong>We reply to the email address you give</strong> &mdash; on the same thread, so there is no guessing which account to find.</li>
        <li><strong>A reply address can end the stream</strong> &mdash; the one-click control at the bottom of our reply stops that address from receiving any further support email.</li>
      </ul>`,
})}

${supportForm({
  id: "support-request",
  categories: SUPPORT_CATEGORIES,
  heading: "Send a message to the operator",
  intro: "Choose the category that best matches what you need, and tell us what happened. We will reply to the address you give, on the same thread so there is no guessing.",
  submitLabel: "Send",
})}

    </div>
  `,
};
export default support;
