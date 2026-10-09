// ============================================================================
// SPONSORS — the brand-facing questionnaire
// ----------------------------------------------------------------------------
// This page is the front door to the sponsorship system described in
// SPONSORSHIP.md. Without it the only way a brand could reach us was by
// emailing a person, which meant the shape of a deal — which placements, which
// sports, which regions — arrived as prose and was re-typed by hand.
//
// Three constraints shape every sentence below, and they are the same three
// that govern the in-app side:
//
//   1. A brand may not be told it can buy something that does not exist. Every
//      option in the questionnaire carries its real status, printed next to it,
//      and read from the same place the operator's notification email reads.
//      "AI preference toward your brand" is on the list because brands ask for
//      it — and it says, in the option itself, that it is not implemented.
//
//   2. Brand money must never reach the advice an athlete reads. The published
//      advertising disclosure already promises that placements are labelled and
//      that no brand sees athlete-level data or training data. That promise is
//      not ours to sell, so this page repeats it before the questionnaire
//      rather than after it.
//
//   3. Nothing here creates a deal. Submitting is an enquiry: no price, no
//      reservation, no contract, and nothing appears in the app until a person
//      has read the disclosure obligations and set it up by hand.
// ============================================================================

import { SPORTS } from "../data/site.mjs";
import { section, esc } from "../parts.mjs";

/**
 * The terms the brand accepts. Must match CURRENT_TERMS_VERSION in
 * supabase/functions/sponsor-enquiry/index.ts — the edge function re-checks the
 * acceptance and records this string with the row, so a version recorded here
 * that the function does not know about would be a false record.
 */
export const TERMS_VERSION = "1.1";

/** Where the enquiry terms live. The questionnaire links here and nowhere else. */
const TERMS_PATH = "/legal/advertising/#enquiries";

/**
 * The questionnaire's interests, with what Vaylo can actually deliver for each.
 *
 * `availability` is the honest answer, and it is shown on the page rather than
 * buried in a legal document. It mirrors DELIVERABILITY in the edge function, so
 * what a brand reads and what the operator is told cannot disagree.
 */
export const INTERESTS = [
  {
    key: "sponsored_challenges",
    label: "Sponsored challenges for your brand",
    detail:
      "A branded challenge alongside ordinary ones, with your name and a sponsored label on the card. Live in the app today.",
    availability: "live",
  },
  {
    key: "sponsored_achievements",
    label: "Personalised achievements tied to your brand",
    detail:
      "A milestone an athlete earns inside your challenge, carrying your name. Live in the app today.",
    availability: "live",
  },
  {
    key: "learning_slot",
    label: "A placement inside the Learning Hub",
    detail:
      "A card beside the lessons. The slot is built and labelled; it is not yet placed on a page, so this cannot start today.",
    availability: "component_ready",
  },
  {
    key: "post_session_slot",
    label: "A placement after a logged session",
    detail:
      "A card where an athlete has just finished training. The slot is built and labelled; not yet placed on a page.",
    availability: "component_ready",
  },
  {
    key: "leaderboard",
    label: "Presence on the leaderboard",
    detail:
      "Your name on a board athletes look at. The surface exists; a sponsored treatment on it does not yet.",
    availability: "component_ready",
  },
  {
    key: "ai_preference",
    label: "AI preference toward your brand",
    detail:
      "Brands ask for this, so it is asked back rather than hidden — but it is not implemented, and it is not something we are able to promise. See the note below before you pick it.",
    availability: "not_implemented",
  },
];

const AVAILABILITY_CLASS = {
  live: "is-live",
  component_ready: "is-soon",
  not_implemented: "is-unavailable",
};

const AVAILABILITY_LABEL = {
  live: "Live today",
  component_ready: "Built, not placed yet",
  not_implemented: "Not implemented",
};

/** One questionnaire choice: a labelled checkbox with its honest status. */
function choice(item) {
  return `        <label class="choice" for="interest-${esc(item.key)}">
          <input type="checkbox" id="interest-${esc(item.key)}" name="interests" value="${esc(item.key)}" />
          <span class="choice-text">
            <span class="choice-title">${esc(item.label)}</span>
            <span class="choice-detail">${esc(item.detail)}</span>
          </span>
          <span class="choice-tag ${AVAILABILITY_CLASS[item.availability]}">${AVAILABILITY_LABEL[item.availability]}</span>
        </label>`;
}

/** One sport chip. Same closed list the app's picker offers. */
function sportChoice(name) {
  const id = `sport-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return `          <label class="chip" for="${id}">
            <input type="checkbox" id="${id}" name="sports" value="${esc(name)}" />
            <span>${esc(name)}</span>
          </label>`;
}

/**
 * The questionnaire.
 *
 * One form, revealed in four steps by site.js when scripting is available. With
 * no JavaScript the fieldsets are all visible and the form still submits — the
 * stepped presentation is an improvement, not a requirement, because a
 * questionnaire a brand cannot fill in on a locked-down browser is a lost lead.
 */
function questionnaire() {
  return `
  <section class="section section-tight" id="enquiry">
    <div class="shell">
      <div class="section-head">
        <p class="eyebrow">The questionnaire</p>
        <h2>Six questions, about a minute</h2>
        <p class="lead">
          It asks what you would actually want, and it tells you which of those
          things exist today. Nothing is charged, nothing is reserved, and
          sending it does not commit you or us to anything.
        </p>
      </div>

      <form class="quiz card" data-vaylo-form="sponsor" novalidate>
        <div class="quiz-progress" aria-hidden="true"><span data-quiz-progress></span></div>

        <fieldset class="quiz-step" data-quiz-step="1" data-active="true">
          <legend class="quiz-legend"><span class="quiz-count">1 of 4</span> Who is asking</legend>

          <div class="field">
            <label for="sp-brand">Brand or company name <span class="required" aria-hidden="true">*</span></label>
            <input type="text" id="sp-brand" name="brand_name" required autocomplete="organization"
                   placeholder="Example Athletic" aria-describedby="sp-brand-hint" />
            <span class="hint" id="sp-brand-hint">The name you want shown to athletes if a deal is agreed.</span>
            <span class="field-error" id="sp-brand-error"></span>
          </div>

          <div class="field">
            <label for="sp-website">Website <span class="hint" style="display:inline">(optional)</span></label>
            <input type="url" id="sp-website" name="website" autocomplete="url" placeholder="https://" />
            <span class="field-error" id="sp-website-error"></span>
          </div>

          <div class="field">
            <label for="sp-name">Your name <span class="hint" style="display:inline">(optional)</span></label>
            <input type="text" id="sp-name" name="contact_name" autocomplete="name" />
            <span class="field-error" id="sp-name-error"></span>
          </div>

          <div class="field">
            <label for="sp-email">Email we should reply to <span class="required" aria-hidden="true">*</span></label>
            <input type="email" id="sp-email" name="contact_email" required autocomplete="email"
                   placeholder="you@example.com" aria-describedby="sp-email-hint" />
            <span class="hint" id="sp-email-hint">One reply, from a person. It is not added to any marketing list, because we have no marketing list.</span>
            <span class="field-error" id="sp-email-error"></span>
          </div>
        </fieldset>

        <fieldset class="quiz-step" data-quiz-step="2">
          <legend class="quiz-legend"><span class="quiz-count">2 of 4</span> What you want</legend>
          <p class="quiz-note">
            Pick as many as you like. The status on the right is what we can do
            today, not what we would like to do.
          </p>
          <div class="choice-grid">
${INTERESTS.map(choice).join("\n")}
          </div>
        </fieldset>

        <fieldset class="quiz-step" data-quiz-step="3">
          <legend class="quiz-legend"><span class="quiz-count">3 of 4</span> Where it should land</legend>

          <p class="quiz-note" id="sp-sports-note">
            Which sports should see it? Leave all of them unticked for every sport
            in the app.
          </p>
          <div class="chip-grid" role="group" aria-labelledby="sp-sports-note">
${SPORTS.map(sportChoice).join("\n")}
          </div>

          <div class="field" style="margin-top:1.5rem">
            <label for="sp-regions">Countries or regions <span class="hint" style="display:inline">(optional)</span></label>
            <input type="text" id="sp-regions" name="regions_text" placeholder="GB, IE, or “anywhere”"
                   aria-describedby="sp-regions-hint" />
            <span class="hint" id="sp-regions-hint">Comma-separated country codes are fine. Blank means everywhere.</span>
            <span class="field-error" id="sp-regions-error"></span>
          </div>

          <div class="field">
            <label for="sp-goals">Anything else <span class="hint" style="display:inline">(optional)</span></label>
            <textarea id="sp-goals" name="goals" rows="4"
                      placeholder="Timing, budget range, what a good outcome looks like for you."></textarea>
            <span class="field-error" id="sp-goals-error"></span>
          </div>
        </fieldset>

        <fieldset class="quiz-step" data-quiz-step="4">
          <legend class="quiz-legend"><span class="quiz-count">4 of 4</span> Before you send</legend>

          <div class="quiz-summary" data-quiz-summary aria-live="polite"></div>

          <label class="consent" for="sp-terms">
            <input type="checkbox" id="sp-terms" name="terms_accepted" value="yes" required />
            <span>
              I have read and accept the
              <a href="${TERMS_PATH}">brand and sponsorship enquiry terms</a>, and I
              understand that this is an enquiry — not an order, a reservation or a
              contract — and that nothing appears in the app until a person has
              agreed it with me.
            </span>
          </label>
          <span class="field-error" id="sp-terms-error"></span>

          <input type="hidden" name="terms_version" value="${TERMS_VERSION}" />

          <!-- Honeypot. Hidden from sight and from the accessibility tree, so a
               person is never asked about it and a bot that fills every input
               gives itself away. -->
          <div class="hp" aria-hidden="true">
            <label for="sp-hp-company">Company website</label>
            <input type="text" id="sp-hp-company" name="company_website" tabindex="-1" autocomplete="off" />
          </div>

          <div class="quiz-actions">
            <button type="button" class="btn btn-secondary" data-quiz-back>Back</button>
            <button type="submit" class="btn btn-primary">Send the enquiry</button>
          </div>

          <div class="form-status" data-status role="status" aria-live="polite"></div>
        </fieldset>
      </form>
    </div>
  </section>`;
}

/** The lines a brand has to read before it fills anything in. */
function limitsSection() {
  return section({
    className: "section-alt",
    eyebrow: "The limits",
    heading: "What sponsorship cannot buy here",
    intro: `<p>These are not negotiating positions. They are published commitments,
      and a deal that needed one of them removed is a deal we would have to turn
      down.</p>`,
    body: `      <div class="grid grid-2">
        <div class="card">
          <h3 style="margin-top:0">You never see an athlete</h3>
          <p>No name, no location, no training data, no health data — not in a
          report, not in a dashboard, not "anonymised" in a way that is
          reversible. What you get is aggregate counts: how many times a card was
          shown, and how many times it was clicked. That is the whole reporting
          surface, and it has no user column to leak.</p>
        </div>
        <div class="card">
          <h3 style="margin-top:0">You never reach an under-18</h3>
          <p>Sponsored content is hidden from anybody without an adult date of
          birth, and that is enforced by the database rather than the interface —
          so it cannot be switched off by a client, an update, or a mistake on a
          screen. Note the honest limitation: age is self-declared, which is true
          of every age gate.</p>
        </div>
        <div class="card">
          <h3 style="margin-top:0">Your money never touches the coaching</h3>
          <p>A placement is a card, labelled <em>Sponsored</em>. It is not advice
          and it cannot become advice. Nothing you buy changes what the app
          calculates, what a plan says, or what an AI feature writes to an
          athlete about their own training — and no amount of budget changes
          that, because the promise is already published.</p>
        </div>
        <div class="card">
          <h3 style="margin-top:0">Every placement is labelled</h3>
          <p>Each card carries a disclosure label, and the label is required
          rather than decorative. If a deal needs the label removed to be worth
          doing, it is not a deal we can do.</p>
        </div>
      </div>`,
  });
}

export const sponsors = {
  path: "/sponsors/",
  title: "Sponsor Vaylo Sports",
  description:
    "Sponsor Vaylo Sports: tell us what you want — branded challenges, achievements, placements or leaderboard presence — and read exactly what sponsorship can and cannot buy. Enquiries are answered by a person.",
  body: `
  <section class="hero hero-compact">
    <div class="shell hero-grid">
      <div>
        <p class="eyebrow">For brands</p>
        <h1>Put your name on what athletes actually do.</h1>
        <p class="lead" style="margin-top:1.25rem">
          Vaylo Sports is a training log — the place an athlete records the work
          and reads back what it means. A sponsorship here sits beside that
          record: a branded challenge, an achievement, a card where it belongs.
        </p>
        <p class="lead" style="margin-top:1rem">
          It is not a data business, and it is not an ad network. Read the four
          limits below first — they are commitments we have already published, so
          they are worth knowing before you spend a minute on the questionnaire.
        </p>
        <div class="btn-row">
          <a class="btn btn-primary" href="#enquiry">Start the questionnaire</a>
          <a class="btn btn-secondary" href="/legal/advertising/">Advertising disclosure</a>
        </div>
      </div>

      <div class="sponsor-panel">
        <p class="pill">Six answers &middot; replies from a person &middot; no charge</p>
        <ul class="prose-list" style="margin-top:1rem">
          <li><strong>No athlete-level data.</strong> Aggregate impressions and clicks only.</li>
          <li><strong>18+ only.</strong> Enforced in the database, not the interface.</li>
          <li><strong>Always labelled.</strong> A sponsored card says it is sponsored.</li>
          <li><strong>No influence on advice.</strong> Not for sale at any price.</li>
        </ul>
      </div>
    </div>
  </section>

${section({
  eyebrow: "What you can buy",
  heading: "Four things exist, two do not yet",
  intro: `<p>We would rather show you the real state of the product than a
    capability list. Sponsored challenges and branded achievements run today.
    Three placement slots are built but not yet placed on a page. The AI slot is
    a data model and nothing more.</p>`,
  body: `      <div class="grid grid-3">
        <div class="card">
          <span class="choice-tag is-live">Live today</span>
          <h3 style="margin-top:0.75rem">Sponsored challenges</h3>
          <p>An ordinary challenge with your name on it, shown with a disclosure
          label, hidden from under-18s automatically.</p>
        </div>
        <div class="card">
          <span class="choice-tag is-live">Live today</span>
          <h3 style="margin-top:0.75rem">Branded achievements</h3>
          <p>A milestone an athlete earns inside your challenge. Earned, not
          bought — which is the only reason it is worth anything.</p>
        </div>
        <div class="card">
          <span class="choice-tag is-soon">Built, not placed</span>
          <h3 style="margin-top:0.75rem">Placement slots</h3>
          <p>Learning Hub, post-session and leaderboard surfaces. The components
          and the labelling exist; putting one on a live page is the work.</p>
        </div>
      </div>`,
})}

${limitsSection()}

${questionnaire()}

${section({
  className: "section-alt",
  eyebrow: "After you send it",
  heading: "What actually happens next",
  body: `      <ol class="prose-list">
        <li>Your answers are stored, and an email goes to a person — not to a
        queue nobody reads.</li>
        <li>You get a reply to the address you gave, from a human, usually with
        questions rather than a price list.</li>
        <li>If it goes further, a deal becomes real by hand: a brand record, a
        placement, a start and end date and a disclosure label. Nothing appears
        in the app before that.</li>
        <li>Reporting afterwards is aggregate counts. You will never receive a
        list of who saw your card.</li>
      </ol>
      <div class="warn">
        <p><strong>On "AI preference toward your brand".</strong> It is on the
        questionnaire because brands ask for it, and it is marked not
        implemented because that is the truth — the database can hold the row,
        and nothing reads it. Even where it exists later, a paid preference
        inside an athlete's coaching is the one thing this product will not sell:
        an athlete must be able to trust that the advice about their own body was
        written for them. If that is the only thing you are looking for, this is
        the wrong product, and we would rather say so now.</p>
      </div>
      <div class="btn-row">
        <a class="btn btn-secondary" href="/legal/">All legal documents</a>
        <a class="btn btn-secondary" href="/legal/advertising/">Advertising &amp; tracking disclosure</a>
        <a class="btn btn-secondary" href="/contact/">Talk to a person directly</a>
      </div>`,
})}`,
};
export default sponsors;
