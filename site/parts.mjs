// ============================================================================
// SITE PARTS — reusable blocks shared across pages
// ----------------------------------------------------------------------------
// Small enough to read in one go. Anything used twice lives here so the
// homepage and the Legal Centre cannot drift apart on, say, what a report
// control does.
// ============================================================================

import { SITE } from "./data/site.mjs";

export const esc = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Section with an optional eyebrow, heading and intro. */
export function section({ id, eyebrow, heading, intro, body, className = "" }) {
  return `
  <section class="section${className ? " " + className : ""}"${id ? ` id="${id}"` : ""}>
    <div class="shell">
${
  heading
    ? `      <div class="section-head">
${eyebrow ? `        <p class="eyebrow">${esc(eyebrow)}</p>\n` : ""}        <h2>${esc(heading)}</h2>
${intro ? `\n        <p class="lead">${intro}</p>` : ""}
      </div>\n`
    : ""
}${body}
    </div>
  </section>`;
}

/** A plain <ul class="prose-list"> from an array of strings or HTML strings. */
export function list(items) {
  return `<ul class="prose-list">\n${items
    .map((item) => `  <li>${item}</li>`)
    .join("\n")}\n</ul>`;
}

/**
 * The Play Store call to action.
 *
 * With no listing there is no URL, and inventing one would produce a link to
 * somebody else's app or a 404. So the component says plainly that it is not
 * published yet and points to the features and support pages instead.
 */
export function storeCta() {
  if (SITE.playStoreUrl) {
    return `<a class="btn btn-primary" href="${esc(SITE.playStoreUrl)}" rel="noopener">
      Get Vaylo Sports on Google Play
    </a>`;
  }

  return `<div class="card" style="max-width: 34rem">
  <h3 style="margin-top:0">Not on the Play Store yet</h3>
  <p style="font-size:0.95rem">
    Vaylo Sports has not been published to Google Play. There is no listing to
    link to, and we are not going to put a dead button here. If you already
    have it installed, everything in this website applies to your account.
  </p>
  <p style="font-size:0.95rem;margin-bottom:0">
    <a href="/features/">See what is in the app</a> &middot;
    <a href="/support/">Get support</a>
  </p>
</div>`;
}

/**
 * A working form.
 *
 * It posts to the real edge function via /assets/config.js. When that endpoint
 * is not configured, site.js disables the form at load and explains why, so a
 * visitor never fills in something that was never going to be received.
 */
export function supportForm({
  id,
  categories,
  heading,
  intro,
  submitLabel = "Send",
  showSubject = true,
  showAccountRef = true,
  accountRefHint = "",
  privacyNote = DEFAULT_FORM_PRIVACY_NOTE,
}) {
  const options = categories
    .map(
      (c) =>
        `          <option value="${esc(c.value)}"${c.childSafety ? ' data-child-safety="true"' : ""}>${esc(c.label)}</option>`
    )
    .join("\n");

  return `
      <h3 style="margin-top:0">${esc(heading)}</h3>
      <p>${intro}</p>

      <form data-vaylo-form novalidate>
        <div class="field">
          <label for="${id}-category">What is this about? <span class="required" aria-hidden="true">*</span></label>
          <select id="${id}-category" name="category" required aria-describedby="${id}-category-hint">
${options}
          </select>
          <span class="hint" id="${id}-category-hint">Choosing the right one gets your message to a person faster.</span>
          <span class="field-error" id="${id}-category-error"></span>
        </div>

        <div class="field">
          <label for="${id}-email">Your email address <span class="required" aria-hidden="true">*</span></label>
          <input type="email" id="${id}-email" name="email" required autocomplete="email"
                 placeholder="you@example.com" aria-describedby="${id}-email-hint" />
          <span class="hint" id="${id}-email-hint">We need this to reply to you. It is not added to any marketing list, because we have no marketing list.</span>
          <span class="field-error" id="${id}-email-error"></span>
        </div>

${
  showAccountRef
    ? `        <div class="field">
          <label for="${id}-account">Your Vaylo account email <span class="hint" style="display:inline">(optional)</span></label>
          <input type="text" id="${id}-account" name="account_ref" autocomplete="off" />
          <span class="hint"${accountRefHint ? ` id="${id}-account-hint"` : ""}>${
            accountRefHint || "If your request is about a specific account, this helps us find it."
          }</span>
          <span class="field-error" id="${id}-account-error"></span>
        </div>
`
    : ""
}
        <div class="field">
          <label for="${id}-name">Your name <span class="hint" style="display:inline">(optional)</span></label>
          <input type="text" id="${id}-name" name="display_name" autocomplete="name" />
          <span class="field-error" id="${id}-name-error"></span>
        </div>
${
  showSubject
    ? `        <div class="field">
          <label for="${id}-subject">Subject <span class="hint" style="display:inline">(optional)</span></label>
          <input type="text" id="${id}-subject" name="subject" />
          <span class="field-error" id="${id}-subject-error"></span>
        </div>
`
    : ""
}
        <div class="field">
          <label for="${id}-body">Message <span class="required" aria-hidden="true">*</span></label>
          <textarea id="${id}-body" name="body" data-body required aria-describedby="${id}-body-hint"></textarea>
          <span class="hint" id="${id}-body-hint">What happened, what you expected, and anything you have already tried.</span>
          <span class="field-error" id="${id}-body-error"></span>
        </div>

        <!-- Honeypot. Hidden from sight and from the accessibility tree, so a
             person is never asked about it and a screen reader never announces
             it. A bot that fills every input gives itself away. -->
        <div class="hp" aria-hidden="true">
          <label for="${id}-hp-company">Company website</label>
          <input type="text" id="${id}-hp-company" name="company_website" tabindex="-1" autocomplete="off" />
        </div>

        <button type="submit" class="btn btn-primary">${esc(submitLabel)}</button>

        <p class="form-privacy">${privacyNote}</p>

        <div class="form-status" data-status role="status" aria-live="polite"></div>
      </form>`;
}

/**
 * What happens to a message, said where the message is written.
 *
 * UK GDPR Article 13 wants the reader told what their data is for at the point
 * it is collected, not only in a policy they have to go and find. This is that
 * sentence, in the form, next to the button — and it is here rather than in each
 * page's copy so a form added later cannot be the one that forgets it.
 *
 * It promises three things that are true of every form on this site: the
 * message is used to answer it, it is not a mailing list, and it can be erased
 * on request. Nothing here commits the operator to a reply time, because the
 * documents that do that are the ones a reader is being pointed at.
 */
export const DEFAULT_FORM_PRIVACY_NOTE =
  'What you send is used to answer you and for nothing else. It is not added to a ' +
  'mailing list and it is not sold or shared. You can ask us to delete it at any ' +
  'time &mdash; see the <a href="/privacy/">Privacy &amp; Data Centre</a>.';

/**
 * The waiting-list form.
 *
 * Separate from supportForm because it is a different promise: one field, no
 * category, no message body, and a different endpoint. Reusing supportForm here
 * would have put "what is this about?" and a 10-character minimum on a page
 * whose entire job is to ask for one thing.
 *
 * data-vaylo-form="waitlist" is what site.js branches on to pick the endpoint
 * and the success wording — see initForms().
 */
export function waitlistForm({ id = "waitlist", submitLabel = "Join the waiting list" }) {
  return `
      <h3 style="margin-top:0">Join the waiting list</h3>
      <p>One field. We will use the address for one thing: telling you when the
      Android release opens.</p>

      <form data-vaylo-form="waitlist" novalidate>
        <div class="field">
          <label for="${id}-email">Your email address <span class="required" aria-hidden="true">*</span></label>
          <input type="email" id="${id}-email" name="email" required autocomplete="email"
                 placeholder="you@example.com" aria-describedby="${id}-email-hint" />
          <span class="hint" id="${id}-email-hint">Nothing else is required, and we will not add you to a marketing list.</span>
          <span class="field-error" id="${id}-email-error"></span>
        </div>

        <div class="field">
          <label for="${id}-name">Your name <span class="hint" style="display:inline">(optional)</span></label>
          <input type="text" id="${id}-name" name="display_name" autocomplete="name" />
          <span class="field-error" id="${id}-name-error"></span>
        </div>

        <input type="hidden" name="source" value="web" />

        <!-- Honeypot. Identical in intent to the one on the support form and for
             the same reason: hidden from sight and from the accessibility tree,
             so a person is never asked about it and a bot that fills every
             input gives itself away. -->
        <div class="hp" aria-hidden="true">
          <label for="${id}-hp-company">Company website</label>
          <input type="text" id="${id}-hp-company" name="company_website" tabindex="-1" autocomplete="off" />
        </div>

        <button type="submit" class="btn btn-primary">${esc(submitLabel)}</button>

        <!-- Article 13 at the point of collection. This form asks for one
             thing, so the note says what that one thing is for and nothing
             more: it is not a mailing list, and no marketing email follows. -->
        <p class="form-privacy">
          Your address is used for one thing: telling you when the Android release
          opens. It is not a mailing list, it is not shared with anyone, and you can
          have it removed at any time &mdash; see the
          <a href="/legal/waitlist-terms/">waiting list terms</a> and the
          <a href="/privacy/">Privacy &amp; Data Centre</a>.
        </p>

        <div class="form-status" data-status role="status" aria-live="polite"></div>
      </form>`;
}

/** Contact categories, shared by the Support page and the Contact page. */
export const SUPPORT_CATEGORIES = [
  { value: "general", label: "General support — how do I use the app?" },
  { value: "account", label: "Account problem — sign-in, locked out, wrong account" },
  { value: "privacy", label: "Privacy or data request — access, correction, deletion" },
  { value: "deletion", label: "Delete my account or my data" },
  { value: "safety", label: "Safety concern — unsafe content, or a feature affected my training" },
  {
    value: "child_safety",
    label: "CHILD SAFETY — a child is at risk, or a child account exists",
    childSafety: true,
  },
  { value: "purchase", label: "Purchase or payment problem" },
  { value: "bug", label: "Something is broken" },
  { value: "copyright", label: "Copyright, trademark or other IP complaint" },
];