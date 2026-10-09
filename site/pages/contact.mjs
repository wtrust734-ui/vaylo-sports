// ============================================================================
// CONTACT — the one email address that exists
// ----------------------------------------------------------------------------
// This page states plainly what a person can reach us on, lists the routes
// that do not exist so they are not invented, and gives the single address a
// person can always write to. Every inbound email lands in the same inbox and
// the same `support_requests` queue, whether it arrives as a mailto: link or
// as a message in the form below.
// ============================================================================

import { section, list, esc } from "../parts.mjs";

export const contact = {
  path: "/contact/",
  title: "Contact",
  description:
    "Contact Vaylo Sports: the one email address that exists, the routes that are not available, and what to do when something is urgent.",
  body: `
    <div class="shell">
      <div style="padding-top:2.5rem">
        <p class="eyebrow">Contact</p>
        <h1>Contact Vaylo Sports</h1>
      </div>

      <div class="card" style="margin-top:1.5rem;max-width:40rem">
        <h2 style="margin-top:0;font-size:1.1rem">Email</h2>
        <p style="margin-bottom:0.5rem">
          <a href="mailto:vaylosportssupport@gmail.com" style="font-weight:700;font-size:1.05rem">vaylosportssupport@gmail.com</a>
        </p>
        <p>One inbox handles everything &mdash; support, privacy requests, refunds,
        complaints, copyright notices and child safety reports. A person reads it.</p>
      </div>

      <div class="card" style="margin-top:1.5rem;max-width:40rem">
        <h2 style="margin-top:0;font-size:1.1rem">The form</h2>
        <p>
          The form on the <a href="/support/">Support Centre</a> posts straight to the
          same inbox and the same queue. It cannot reply to the sender &mdash; it only
          reaches the address written on it, so use the email above when you need a
          conversation rather than a record.
        </p>
      </div>

      <div class="warn" style="max-width:52rem">
        <p><strong>There is no phone number, no live chat and no postal address.</strong>
        We have not listed them because we have not set them up. If someone gives you
        a Vaylo Sports phone number, it is not us.</p>
        <p style="margin-bottom:0"><strong>The registered legal entity and its address
        are not published here</strong> because they are not supplied yet. The same
        information is in the legal documents, which are the source of truth.</p>
        <p style="margin-bottom:0"><strong>The operator inbox is not a place to buy
        something.</strong> If you have already paid and have a problem, start with the
        <a href="/legal/refunds/">refunds page</a> and the form on this site.</p>
      </div>

      ${section({
  id: "what-we-do-not-have",
  eyebrow: "What this site deliberately does not offer",
  heading: "No phone, no chat, no social",
  body: `      <ul class="prose-list">
        <li><strong>No phone number.</strong> We do not have one, and publishing a
        number we do not have would be a lie the first call to it would prove.</li>
        <li><strong>No live chat.</strong> There is no team on shift who can answer
        a window, and we would rather say that than leave a window empty.</li>
        <li><strong>No social channels.</strong> We do not run accounts to talk to
        people one to one, and we will not add one for that purpose.</li>
        <li><strong>No postal address.</strong> There is no business address to
        publish, and the legal documents do not claim one.</li>
        <li><strong>No newsletter.</strong> We do not mail people and never will,
        unless they join the waiting list.</li>
        <li><strong>No support ticket system beyond this form.</strong> The form
        creates a record and emails the operator. It is not a portal that tells
        you how long a request will take.</li>
      </ul>`,
})}

    </div>
  `,
};
export default contact;
