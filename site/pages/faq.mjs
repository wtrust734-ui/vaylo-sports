// ============================================================================
// FAQ
// ----------------------------------------------------------------------------
// The rest of the site is documents. This page is answers: the questions a
// person actually has before they decide whether to bother, in the words they
// would ask them. "Does this work with my Garmin" is not answered by a
// wearable-data privacy notice, however honest that notice is — so it is
// answered here, in one sentence, with the notice linked underneath.
//
// Every answer is a fact already stated somewhere else on this site or in a
// published document. Nothing here is new information, and nothing here is a
// claim that the legal documents do not already make. That is the rule: this
// page may rephrase, it may not add.
//
// ----------------------------------------------------------------------------
// The structured data is generated FROM the visible list rather than written
// beside it. A FAQPage that says something the page does not say is a manual
// action waiting to happen, and hand-maintaining two copies of sixteen answers
// is how the two disagree. `a` is deliberately plain text with no markup in it:
// it is the JSON-LD answer verbatim, and any markup in it would be emitted as
// raw HTML inside the structured data. Links live in `more`, rendered under the
// answer where a reader can see them.
// ============================================================================

import { FEATURES } from "../data/site.mjs";
import { section, esc } from "../parts.mjs";

const liveCount = FEATURES.filter((f) => f.status === "live").reduce(
  (n, g) => n + g.items.length,
  0
);
const liveAreas = FEATURES.filter((f) => f.status === "live").length;

/**
 * One entry per question.
 *
 *   q    the question, as a person would ask it
 *   a    the answer, in plain text — this is what the JSON-LD publishes
 *   more optional { href, label } shown under the answer
 */
const GROUPS = [
  {
    eyebrow: "Getting it",
    heading: "Availability",
    items: [
      {
        q: "Is Vaylo Sports a running app?",
        a: "No. It was built around a training log rather than around one sport. Load, recovery, readiness and the limiter logic are calculated from effort and duration, which a rugby player, a 10k runner, a swimmer and a climber all have. You pick your sport, or more than one, and the app changes its terminology and event context rather than its maths.",
        more: { href: "/features/", label: "See the full sport list" },
      },
      {
        q: "Can I install it now?",
        a: "Not from a store. Vaylo Sports is Android-only and has not been published to Google Play yet, so there is no listing to install from and we will not put a dead link on this site. Joining the waiting list is how you will hear when it opens. If you already have a build installed, everything on this website applies to your account.",
        more: { href: "/waitlist/", label: "Join the waiting list" },
      },
      {
        q: "When is the iPhone version coming?",
        a: "There is no iOS build and no date for one. We would rather say that than put a plausible timeline on this page. The app stores your training server-side, so if an iPhone version is built, your account and history come with it rather than starting again.",
      },
      {
        q: "Does it work with my Garmin, Apple Watch, Fitbit, WHOOP or Strava?",
        a: "No. Wearable and health sync is deliberately switched off, and no data moves. The integration needs a signed developer agreement with each provider before it can exchange a token, and those are not in place. The feature is listed on the features page rather than hidden, and the app tells you so if you open it.",
        more: { href: "/legal/wearable-health-privacy/", label: "Wearable & health data notice" },
      },
      {
        q: "What does it cost?",
        a: "Buying is not switched on yet. Credits and coins exist in the app and are not purchasable today, and no payment provider is connected, so nothing can be charged. When buying is enabled, the prices and the limits on what buying gives you are published on this site rather than only in a store listing.",
        more: { href: "/legal/purchases/", label: "Credits, subscriptions & virtual currency" },
      },
    ],
  },
  {
    eyebrow: "Your data",
    heading: "Privacy and deletion",
    items: [
      {
        q: "Do you sell my data?",
        a: "No. There is no advertising SDK, no analytics SDK and no advertising identifier in the app, so there is nothing collecting your training to sell. Sponsored placements exist on the commercial side of the product, they are always labelled, they are never shown to anyone under 18, and a brand is reported anonymous counts rather than your name, location or training data.",
        more: { href: "/legal/advertising/", label: "Advertising & tracking disclosure" },
      },
      {
        q: "Is my training visible to other people?",
        a: "Only if you choose to share it. Sharing is per activity and yours to withdraw, and the default is private. A profile belonging to someone under 18 cannot be made public at all, and blocking another athlete is available on any profile and is not disclosed to them.",
        more: { href: "/privacy/", label: "Privacy & data centre" },
      },
      {
        q: "How do I delete my account and everything in it?",
        a: "In the app: Profile, then Delete account permanently. It asks you to confirm it is you, asks you to type DELETE MY ACCOUNT, and then deletes. It is immediate, it is free, you do not have to give a reason, and the app verifies the wipe by counting rows in every table that can hold your data instead of just claiming success.",
        more: { href: "/delete-account/", label: "The full deletion route" },
      },
      {
        q: "Can I get a copy of everything you hold about me?",
        a: "Yes, from inside the app, without emailing anyone. Profile, then the Legal & Safety centre, then Download your data. It produces a JSON file of your profile, training, health, social and purchase records on your own device in seconds. If the export is ever incomplete the app says which parts were missing rather than handing you a partial file quietly.",
        more: { href: "/legal/data-rights/", label: "Your data rights" },
      },
      {
        q: "Do the AI features use my data to train a model?",
        a: "Your text or video is sent to a provider, either OpenAI or Google, to generate the reply you asked for. What is sent, what is never sent, and what we cannot yet promise about that is set out in full in the AI data use notice. Training data is not something we use your sessions for.",
        more: { href: "/legal/ai-data-use/", label: "AI data use & processing" },
      },
    ],
  },
  {
    eyebrow: "The app",
    heading: "What it does, and what it will not do",
    items: [
      {
        q: "What actually works today?",
        a: `Everything described as working today does, and it is a specific number rather than a slogan: ${liveCount} features across ${liveAreas} areas, covering logging, metrics, the Limiter Test, injury scaffolding, nutrition, the Learning Hub, event packs and the community side. The features page labels every area with its real state, including the ones that are not switched on.`,
        more: { href: "/features/", label: "Everything, with its status" },
      },
      {
        q: "Are the AI features working?",
        a: "Not yet. They are built into the app and appear in its navigation, but the server capability that runs them is not enabled, so the app tells you that when you open one instead of showing a broken result. That includes the coach chat, generated training weeks, the weekly review, video form analysis and generated nutrition plans.",
        more: { href: "/legal/ai-disclaimer/", label: "How the AI features work" },
      },
      {
        q: "Will it tell me if I am injured?",
        a: "No, and it will not try. Injury Management is a structure for organising a rehabilitation programme a professional has already given you. It does not diagnose, it does not assess you, and it carries a permanent on-screen notice telling you to see a physiotherapist or a doctor for sharp, persistent or worsening pain.",
        more: { href: "/legal/injury-guidance/", label: "Injury & return-to-training" },
      },
      {
        q: "Is the injury-risk number a prediction?",
        a: "No. It is arithmetic on what you logged, with the inputs stated, and it describes a pattern in your own history rather than forecasting an event. The same applies to the VPR rating and the development trajectory: they describe what happened, and where a sentence in the app was written by a language model, the app tells you that separately.",
        more: { href: "/legal/health-safety/", label: "What the numbers mean" },
      },
      {
        q: "Does it replace a coach?",
        a: "No, and it is not designed to. It has no idea what happened in your session today, it cannot see you move, and it cannot have a conversation with you about what you want from the season. It is a tool for organising and understanding your own training. Where it has nothing useful to say, the honest thing for it to do is say nothing.",
        more: { href: "/about/", label: "What Vaylo is, and is not" },
      },
    ],
  },
  {
    eyebrow: "Younger athletes",
    heading: "Under-18s",
    items: [
      {
        q: "Can my 14-year-old use it?",
        a: "Yes, from 13. The app is not directed at children under 13 and does not knowingly collect their data. For anyone aged 13 to 17 a set of features is switched off at the database rather than the interface: no advertising, no calorie or weight features, no public profile, no sponsor reporting and no promotional nudges. Training volume is capped by age band.",
        more: { href: "/legal/child-safety/", label: "Child & young athlete safety" },
      },
      {
        q: "How do you know how old someone is?",
        a: "Only from the date of birth they enter. There is no identity document check and no age assurance service behind it, so the protections are enforced on what the account declares. We say that plainly rather than implying a gate that does not exist.",
        more: { href: "/legal/child-safety/", label: "What is enforced, and how" },
      },
      {
        q: "Can a parent delete a child's account?",
        a: "Yes. A parent or guardian can ask for a child's account to be deleted at any time, without giving a reason, and it is done. The request goes through the same contact route as any other deletion request and is read by a person.",
        more: { href: "/contact/", label: "Contact us" },
      },
    ],
  },
  {
    eyebrow: "Problems",
    heading: "Help, safety and complaints",
    items: [
      {
        q: "How do I report content or a user?",
        a: "There is a Report control on every post and every profile. Blocking is on the profile too, it is immediate, and the blocked athlete is not told. Reports about a child at risk are treated differently from everything else on the list and go to a person first.",
        more: { href: "/legal/report-content/", label: "Report content or a user" },
      },
      {
        q: "I found a security flaw. Where do I send it?",
        a: "To the contact address, with what you found and how to reproduce it. The security and vulnerability reporting notice explains the scope, what we will do, and the safe-harbour position for someone reporting in good faith rather than exploiting it.",
        more: { href: "/legal/security-disclosure/", label: "Security & vulnerability reporting" },
      },
      {
        q: "Something went wrong and I want to complain.",
        a: "The complaints procedure sets out how to raise it, how to ask for it to be reviewed, and how to take it to a regulator if you are still not satisfied. You do not have to use the support form to start that process, and asking for a review does not require you to explain why you are unhappy twice.",
        more: { href: "/legal/complaints/", label: "Complaints procedure" },
      },
      {
        q: "Where do I ask something that is not on this page?",
        a: "The support centre covers using the app, account problems and purchases. Anything else reaches a person through the contact page, and the answer is not generated by a machine. Both routes are read by the same people.",
        more: { href: "/support/", label: "Support centre" },
      },
    ],
  },
];

/** Every question and answer, in order, as the FAQPage node publishes them. */
const ALL = GROUPS.flatMap((group) => group.items);

function block(group) {
  return `      <h2 id="${esc(group.heading.toLowerCase().replace(/[^a-z0-9]+/g, "-"))}">${esc(
    group.heading
  )}</h2>
      <div class="grid grid-2">
${group.items
  .map(
    (item) => `        <div class="card">
          <h3 style="margin-top:0">${esc(item.q)}</h3>
          <p>${esc(item.a)}</p>
${
  item.more
    ? `          <p style="margin-bottom:0"><a href="${item.more.href}">${esc(
        item.more.label
      )}</a></p>\n`
    : ""
}        </div>`
  )
  .join("\n")}
      </div>`;
}

const body = GROUPS.map(block).join("\n\n");

export const faq = {
  path: "/faq/",
  title: "Questions and answers",
  description:
    "Straight answers about Vaylo Sports: whether it works with your watch, what it costs, how to delete everything, what the AI features do with your data, and what the app will not do.",
  updated: "2026-10-08",
  jsonLd: [
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: ALL.map((item) => ({
        "@type": "Question",
        name: item.q,
        acceptedAnswer: { "@type": "Answer", text: item.a },
      })),
    },
  ],
  body: `
    <div class="shell">
      <div style="padding-top:2.5rem">
        <p class="eyebrow">Questions</p>
        <h1>Straight answers, including the unhelpful ones</h1>
        <p class="lead" style="margin-top:1rem">
          The rest of this site is documents. This page is the questions people
          actually have before they decide whether to bother — asked the way they
          ask them, answered in the space of a paragraph.
        </p>
        <p class="lead" style="margin-top:1rem;max-width:64ch">
          Every answer here is a fact stated somewhere else on this site or in a
          published document, and each one links to where it comes from. Nothing
          on this page is new information, and nothing here is a claim the legal
          documents do not already make.
        </p>
      </div>

      <div class="toc">
        <strong>On this page</strong>
        <ol>
${GROUPS.map(
  (group) =>
    `          <li><a href="#${esc(
      group.heading.toLowerCase().replace(/[^a-z0-9]+/g, "-")
    )}">${esc(group.heading)}</a></li>`
).join("\n")}
        </ol>
      </div>

${body}
    </div>

${section({
  className: "section-alt",
  eyebrow: "Still stuck",
  heading: "If your question is not here",
  intro: `<p>A person reads every message. Nothing on this site is answered by a
    generated reply.</p>`,
  body: `      <div class="btn-row">
        <a class="btn btn-primary" href="/support/">Support centre</a>
        <a class="btn btn-secondary" href="/contact/">Contact</a>
        <a class="btn btn-secondary" href="/legal/">All legal documents</a>
        <a class="btn btn-secondary" href="/whats-new/">What has changed</a>
      </div>`,
})}`,
};
export default faq;
