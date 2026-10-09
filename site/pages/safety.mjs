// ============================================================================
// SAFETY CENTRE
// ----------------------------------------------------------------------------
// The page the Support page, the footer and every legal document point at. It
// is written to be read by a fifteen-year-old as well as by a solicitor: short
// sentences, no hedging, and an honest statement of what the app cannot do.
//
// The reporting section is the operationally important one. Content inside the
// app is reported in-app, because that route reaches a person with context.
// Anything involving a child is routed to the police and the NSPCC as well,
// because a support inbox is not an emergency service and saying otherwise
// would be the single most dangerous claim on this website.
// ============================================================================

import { section, list, supportForm, SUPPORT_CATEGORIES, esc } from "../parts.mjs";

const AREAS = [
  {
    id: "ai",
    title: "AI safety",
    body: `<p>Parts of Vaylo write text using a large language model. A language model
      predicts plausible sentences rather than understanding your body, which means
      it can be fluent, specific and wrong at the same time.</p>
      ${list([
        "<strong>It is confidently wrong, not obviously wrong.</strong> It rarely says &ldquo;I don&rsquo;t know&rdquo;.",
        "<strong>It cannot see you.</strong> It knows what you logged, not how you slept or what happened today.",
        "<strong>It does not know your medical history,</strong> your medication, an injury you never mentioned, or a condition you have not been diagnosed with.",
        "<strong>VPR, training load and recovery are not AI.</strong> They are arithmetic on your own entries, and we would rather you trusted those.",
      ])}
      <p>Nutrition features are blocked for under-18s, Injury Management never
      diagnoses, and the app carries a permanent notice telling you to see a
      professional. <a href="/legal/ai-disclaimer/">Read the full disclaimer</a>.</p>`,
  },
  {
    id: "training",
    title: "Training and coaching safety",
    body: `<p>Vaylo caps suggested training volume by age band, and gives young athletes a
      deload week more often. For a load above a safe threshold, it raises an
      overtraining alert against your own data.</p>
      <div class="warn">
        <p><strong>A cap is not a plan.</strong> It stops the app suggesting an
        unreasonable week. It does not know you are growing, that a growth spurt is
        coming, that you have a condition, or that you play three sports. Use the
        cap as a ceiling, not a target.</p>
      </div>
      ${list([
        "<strong>Stop and see a professional</strong> if you have sharp, worsening or persistent pain, are returning from injury, are pregnant, or take medication that affects what is safe.",
        "<strong>Challenges and packs are not prescriptions.</strong> They describe a structure, not a plan for you.",
        "<strong>Your coach&rsquo;s plan beats our numbers.</strong> If the app disagrees with your coach, follow your coach.",
      ])}
      <p><a href="/legal/health-safety/">Training &amp; health safety notice</a></p>`,
  },
  {
    id: "health",
    title: "Health-related limitations",
    body: `${list([
      "<strong>No diagnosis, ever.</strong> Nothing in the app identifies an injury or a condition.",
      "<strong>No treatment plan.</strong> Injury Management organises a rehab a professional has already prescribed.",
      "<strong>Not medical advice.</strong> If it contradicts what a doctor or physiotherapist has told you, they are right.",
      "<strong>Not for eating disorders.</strong> Calorie and weight features are blocked under 18, and we ask you not to use them if the app&rsquo;s output makes you feel worse.",
    ])}
    <p><strong>If AI output led you to harm yourself or someone else, tell us.</strong> It
    will not be used against you. <a href="/support/">Report it</a>.</p>`,
  },
  {
    id: "young",
    title: "Young athlete safety",
    body: `<p>For athletes under 18, the following are switched off. Each is enforced in the
      database or checked before the feature runs, so a bug in a screen cannot
      expose a young athlete to it.</p>
      <div class="grid grid-2" style="margin-top:1rem">
        <div class="card"><h4>No advertising</h4><p style="font-size:0.92rem">Suppressed entirely, and young athletes are excluded from sponsor reporting.</p></div>
        <div class="card"><h4>No nutrition advice</h4><p style="font-size:0.92rem">Calorie and weight features blocked with an explanation.</p></div>
        <div class="card"><h4>Private by default</h4><p style="font-size:0.92rem">A minor&rsquo;s profile cannot be made public at all.</p></div>
        <div class="card"><h4>Cannot buy</h4><p style="font-size:0.92rem">Credits, packs and subscriptions are not available to under-18 accounts.</p></div>
      </div>
      <p style="margin-top:1rem"><a href="/legal/child-safety/">Full young athlete policy</a></p>`,
  },
  {
    id: "child",
    title: "Child safety",
    body: `<p>Vaylo is not directed at children under 13 and we do not knowingly collect
      personal data from them. We apply the UK Children&rsquo;s Code and age-appropriate
      design principles to the version aimed at 13&ndash;17 year olds: data
      minimisation, privacy by default, no behavioural advertising, no
      profiling.</p>
      <div class="warn">
        <p><strong>If a child is in immediate danger, contact the police</strong> or the
        <strong>NSPCC Child Protection Helpline on 0808 8000 111</strong>. Do not wait
        for us, and do not treat a support form as a route to urgent help.</p>
      </div>
      ${list([
        "Content sexualising a child is removed immediately, and reported to the authorities where the law permits or requires it.",
        "An adult contacting a young athlete is treated as harassment: content removed, account actioned.",
        "A parent or guardian can ask us to delete a child&rsquo;s account at any time, with no reason required, and we do it.",
      ])}
      <p><a href="/legal/child-safety/">Read the full policy, including what we have not finalised</a></p>`,
  },
  {
    id: "community",
    title: "Community safety",
    body: `<p>The feed, communities, challenges and leaderboards are the parts of Vaylo
      other people can see. The rules are short:</p>
      ${list([
        "No bullying, harassment or threats — including pile-ons.",
        "No racist, sexist, homophobic or transphobic content.",
        "No sexual content, and nothing sexualising a child.",
        "No encouraging self-harm, disordered eating or dangerous training.",
        "No posting someone else&rsquo;s information without their consent.",
        "No impersonating Vaylo, our staff, a coach or another athlete.",
        "No unsolicited selling in the community.",
      ])}
      <p>Profiles are <strong>private by default</strong>, and you control what leaves your
      account. <a href="/legal/community-guidelines/">Full community guidelines</a></p>`,
  },
];

function areaBlocks() {
  return AREAS.map(
    (area) => `
      <section class="section" id="${area.id}" style="padding-top:2rem">
        <div class="shell">
          <h2 style="margin-top:0">${esc(area.title)}</h2>
          ${area.body}
        </div>
      </section>`
  ).join("\n");
}

const reporting = section({
  id: "reporting",
  eyebrow: "Reporting",
  heading: "Report something, or block someone",
  intro: `<p><strong>Content inside the app:</strong> use the <em>Report</em> control on any
    shared activity or profile. It reaches a person with the context attached,
    which is faster and more useful than any form on this page.</p>
    <p><strong>Blocking:</strong> available from any profile. Blocking removes their
    shared activity from your feed in both directions and stops them sending you
    friend requests. <strong>They are not told they were blocked.</strong> Blocking
    does not remove their content &mdash; report it as well if you want it gone.</p>
    <p><strong>Something else, or you cannot get into the app:</strong> use the form below.</p>`,
  body: `
    <div class="grid grid-2" style="align-items:start">
      <div class="card">
${supportForm({
  id: "safety",
  categories: SUPPORT_CATEGORIES,
  heading: "Report a safety concern",
  intro: `<p>Every message is read by a person. Pick the category that fits closest;
          if it is a child safety concern, choose that one and read the notice
          below the form.</p>`,
  submitLabel: "Send report",
  accountRefHint: "The email on the account, if the concern is about a specific athlete or account.",
})}
      </div>
      <div>
        <div class="warn">
          <p><strong>If a child is at risk, do not rely on this form.</strong></p>
          <ul class="prose-list" style="margin-top:0.5rem">
            <li>Immediate danger &mdash; <strong>call the police</strong>.</li>
            <li>UK Child Protection Helpline (NSPCC) &mdash; <strong>0808 8000 111</strong>.</li>
            <li>A young person who needs to talk &mdash; <strong>Childline, 0800 1111</strong>.</li>
          </ul>
          <p style="margin-bottom:0">Send the form as well so we can act on the account,
          but do not wait for our reply before getting help.</p>
        </div>

        <div class="card">
          <h3 style="margin-top:0">What happens after you report</h3>
          ${list([
            "A person reviews it. Reports are not triaged by an automated filter.",
            "Only you can see that you reported. The athlete does not.",
            "Reporting twice does not stack &mdash; the app tells you it is already reported.",
            "Enforcement is proportionate: remove content, warn, suspend, or close the account.",
          ])}
          <p style="margin-bottom:0">We have not published a response-time target,
          because we have not committed to one. If you wait a long time, that is a
          fair complaint. <a href="/legal/community-guidelines/">See the enforcement steps</a>.</p>
        </div>
      </div>
    </div>`,
});

export const safety = {
  path: "/safety/",
  title: "Safety Centre",
  description:
    "AI limits, training safety, health limitations, young athlete and child safety, community rules, and how to report harmful content or block an athlete.",
  body: `
    <div class="shell">
      <div style="padding-top:2.5rem">
        <p class="eyebrow">Safety Centre</p>
        <h1>What Vaylo can do, what it cannot, and how to tell us when it goes wrong</h1>
        <p class="lead" style="margin-top:1rem">
          Everything on this page is also inside the app, under
          <strong>Profile &rarr; Legal &amp; Safety Centre</strong>. Nothing here is a
          substitute for a doctor, a physiotherapist, a coach or a parent.
        </p>
      </div>

      <nav aria-label="On this page" class="table-wrap" style="margin-top:1.5rem">
        <ul class="prose-list">
${AREAS.map((a) => `          <li><a href="#${a.id}">${esc(a.title)}</a></li>`).join("\n")}
          <li><a href="#reporting">Report something, or block someone</a></li>
        </ul>
      </nav>
    </div>
${areaBlocks()}
${reporting}
${section({
  className: "section-alt",
  eyebrow: "More",
  heading: "The documents behind this page",
  body: `      <div class="btn-row">
        <a class="btn btn-secondary" href="/legal/ai-disclaimer/">AI &amp; coaching disclaimer</a>
        <a class="btn btn-secondary" href="/legal/health-safety/">Training &amp; health safety</a>
        <a class="btn btn-secondary" href="/legal/child-safety/">Child &amp; young athlete safety</a>
        <a class="btn btn-secondary" href="/legal/community-guidelines/">Community guidelines</a>
      </div>`,
})}`,
};
export default safety;
