// ============================================================================
// ABOUT
// ----------------------------------------------------------------------------
// The brief for this page is the hardest constraint in the whole build: "do not
// invent legal-company information; use clearly marked placeholders if
// information is genuinely missing."
//
// So this page says what Vaylo is, why it exists, how it treats sport, and who
// it is for — and then has an explicit "what we have not published yet" section
// with visibly marked placeholders, rather than a plausible company name, a
// fabricated founding date, or a team of people who do not exist.
// ============================================================================

import { section, list, esc } from "../parts.mjs";
import { SPORTS } from "../data/site.mjs";

/**
 * Company particulars.
 *
 * Every value here is null because none of them is known. The page renders them
 * as visible placeholders. The generator fails if a null placeholder ever starts
 * rendering as a real-looking value, which is the failure mode this whole page
 * exists to prevent.
 */
export const COMPANY = {
  legalName: null,
  companyNumber: null,
  registeredAddress: null,
  icoNumber: null,
  founded: null,
  headcount: null,
  dpo: null,
};

function placeholder(label, value) {
  if (value) {
    return `<div class="card">
      <h3 style="margin-top:0;font-size:1rem">${esc(label)}</h3>
      <p style="margin-bottom:0">${esc(value)}</p>
    </div>`;
  }
  return `<div class="card">
    <h3 style="margin-top:0;font-size:1rem">${esc(label)}</h3>
    <p style="margin-bottom:0">
      <span class="pill">Not yet published</span>
    </p>
    <p style="font-size:0.9rem;margin:0.5rem 0 0">
      We have not published this, because publishing a plausible-looking value
      that turns out to be wrong is worse than admitting it is missing.
    </p>
  </div>`;
}

export const about = {
  path: "/about/",
  title: "About Vaylo Sports",
  description:
    "What Vaylo Sports is, why it was built, why it works across every sport, who it is designed for, and which company details are not yet published.",
  body: `
    <div class="shell">
      <div style="padding-top:2.5rem">
        <p class="eyebrow">About</p>
        <h1>What Vaylo Sports is, and what it is not</h1>
      </div>

      <p class="lead" style="margin-top:1rem;max-width:64ch">
        Vaylo Sports is a training log with analysis attached. You record what you
        train; the app works it back to you. That is the whole idea, and it is
        deliberately narrower than what most apps in this category promise.
      </p>
    </div>

${section({
  eyebrow: "Purpose",
  heading: "Why it exists",
  body: `      <p>Most training apps collect what you do and then show you a streak. Vaylo was
      built around the opposite question: <em>given what you actually logged, what
      does that actually say?</em></p>
      <p>That produces a handful of tools that are more useful than a streak &mdash;
      a readiness number next to last night&rsquo;s sleep, an acute load that flags a
      three-week ramp, a Limiter Test that tells you which single thing is most
      likely holding you back instead of telling you to do everything.</p>
      <p>It also produces a responsibility. A number that looks like an insight will
      be believed, so the app has to say clearly where a number comes from, and
      has to stop rather than advise when the honest answer is &ldquo;ask someone who
      can see you&rdquo;.</p>`,
})}

${section({
  className: "section-alt",
  eyebrow: "Approach",
  heading: "Why it works across every sport",
  body: `      <p>The core of Vaylo is sport-agnostic on purpose. Load, recovery, readiness and
      the limiter logic are built from effort and duration &mdash; things a rugby
      player, a 10k runner, a swimmer and a climber all have in common. The sport
      picker changes terminology and event context; it does not change the maths.</p>
      <p>The app offers this list, and it is a closed list on purpose:</p>
      <ul class="tag-list">
${SPORTS.map((s) => `        <li>${esc(s)}</li>`).join("\n")}
      </ul>
      <p>Most athletes train more than one thing. Cross-training is where Vaylo earns
      its keep: two sports competing for the same recovery capacity, or a second
      sport quietly fixing or quietly breaking a first.</p>`,
})}

${section({
  eyebrow: "Audience",
  heading: "Who it is designed for",
  body: `      <div class="grid grid-2">
        <div class="card">
          <h3 style="margin-top:0">It suits you if&hellip;</h3>
          ${list([
            "You train several times a week and want the log to do something rather than just hold it.",
            "You are working towards an event and want a structure to follow.",
            "You are returning from a break and want to see where you actually are.",
            "You train in more than one sport and want to see the interaction.",
            "You are 13 to 17 and want a tool that does not try to sell you anything.",
          ])}
        </div>
        <div class="card">
          <h3 style="margin-top:0">It is not for you if&hellip;</h3>
          ${list([
            "You want a doctor, a diagnosis or a treatment. It is not one, and will not pretend.",
            "You want a coach who knows you. It has no idea what happened today.",
            "You are looking for something to replace clinical advice after an injury.",
            "You are under 13. This app is not directed at children under 13.",
          ])}
        </div>
      </div>`,
})}

${section({
  className: "section-alt",
  eyebrow: "Honesty",
  heading: "What Vaylo will not claim",
  body: `      ${list([
        "<strong>Vaylo does not prevent injury.</strong> It has an injury-risk flag, which is arithmetic on your own data, not a medical assessment.",
        "<strong>Vaylo does not guarantee performance.</strong> Nothing here promises you will get faster, stronger or healthier.",
        "<strong>Vaylo has no medical approval of any kind.</strong> No regulator, medical body or standards organisation has reviewed or endorsed it, and there is no clinical validation behind any number in the app.",
        "<strong>Vaylo holds no certification or accreditation.</strong> No sport body, governing organisation or standards body has endorsed it or reviewed this app.",
        "<strong>Vaylo does not sell your data</strong> and does not share it for advertising.",
      ])}`,
})}

${section({
  eyebrow: "Company information",
  heading: "Who runs Vaylo Sports",
  intro: `<p>We would rather show you a gap than fill it with a guess. These are the
    particulars we have not yet published.</p>`,
  body: `      <div class="grid grid-2">
${[
  ["Registered legal entity", COMPANY.legalName],
  ["Company registration number", COMPANY.companyNumber],
  ["Registered postal address", COMPANY.registeredAddress],
  ["ICO registration number", COMPANY.icoNumber],
  ["Data protection officer", COMPANY.dpo],
  ["Year founded", COMPANY.founded],
  ["Team size", COMPANY.headcount],
  ["Professional indemnity insurance", null],
]
  .map(([label, value]) => `        ${placeholder(label, value)}`)
  .join("\n")}
      </div>
      <div class="warn">
        <p><strong>Why these are blank.</strong> The Privacy Policy, Terms of Service
        and Contact pages each need the registered entity and address to identify
        the data controller and the service address for legal documents. Those
        details have not been supplied to us, and inventing them would create a
        privacy policy naming a company that does not exist &mdash; which is a
        compliance failure, not a cosmetic one.</p>
        <p style="margin-bottom:0">Until they are supplied, use
        <a href="/legal/contact/">the contact page</a>. It works.</p>
      </div>`,
})}

${section({
  className: "section-alt",
  eyebrow: "Read more",
  heading: "The full picture",
  body: `      <div class="btn-row">
        <a class="btn btn-primary" href="/features/">What is in the app</a>
        <a class="btn btn-secondary" href="/safety/">Safety Centre</a>
        <a class="btn btn-secondary" href="/legal/">Legal Centre</a>
        <a class="btn btn-secondary" href="/contact/">Contact us</a>
      </div>`,
})}`,
};
export default about;
