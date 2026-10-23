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
            <tr><td><strong>Request a refund</strong></td><td>In the app: <em>Profile &rarr; Purchases &amp; refunds</em> &mdash; <a href="#refund-how">step by step below</a>. Google Play remains the route for the charge itself; <a href="/legal/refunds/">how refunds work</a></td></tr>
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
  className: "section-alt",
  id: "refund-how",
  eyebrow: "Purchases and refunds",
  heading: "How to request a refund",
  body: `      <p style="max-width:52rem">
        Refunds are handled inside the app, not by email alone, so that every request has
        a record you can follow. Open <strong>Vaylo Sports</strong> and go to
        <strong>Profile &rarr; Purchases &amp; refunds</strong>.
      </p>
      <ol class="prose-list" style="max-width:52rem">
        <li><strong>Choose the transaction.</strong> Pick the AI request that took credits, the purchase, or your subscription.</li>
        <li><strong>Choose a reason.</strong> Only reasons that apply to that transaction are offered.</li>
        <li><strong>Add what happened.</strong> A sentence or two is enough. It is required when a person has to weigh the request up.</li>
        <li><strong>Submit.</strong> You get a case reference such as <strong>RF-261023-AB12</strong>.</li>
        <li><strong>Track it in the same screen.</strong> Its status changes as it is reviewed, and you can ask for a human review if a request is declined.</li>
      </ol>
      <h3>What the statuses mean</h3>
      <ul class="prose-list" style="max-width:52rem">
        <li><strong>Submitted</strong> &mdash; recorded and waiting.</li>
        <li><strong>Under review</strong> &mdash; a person is deciding.</li>
        <li><strong>Approved &mdash; processing</strong> &mdash; approved and being actioned.</li>
        <li><strong>Refund completed</strong> &mdash; credits are back, or the payment provider issued the money.</li>
        <li><strong>Declined</strong> &mdash; with the reason, and a route to ask for a human review.</li>
        <li><strong>Processing failed</strong> &mdash; the provider could not complete it; we follow it up.</li>
      </ul>
      <h3>What happens behind the scenes</h3>
      <ul class="prose-list" style="max-width:52rem">
        <li><strong>Credits for a failed AI request are returned automatically</strong> when our records show the service did not run. Asking again cannot return them twice.</li>
        <li><strong>A completed AI result is not ordinarily refundable</strong> &mdash; but you can still ask for a human review, and your statutory rights are unaffected.</li>
        <li><strong>Anything involving money goes to a person.</strong> Until a payment provider is connected, an approved money refund is recorded as awaiting the provider, and no money has moved.</li>
        <li><strong>Nothing on this page is a second refund process.</strong> It explains the one that exists in the app; the full terms are in the <a href="/legal/refunds/">Refund and Cancellation Policy</a>.</li>
      </ul>`,
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
