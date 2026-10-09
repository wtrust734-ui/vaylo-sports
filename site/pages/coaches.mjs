// ============================================================================
// COACHES — become a coach on Vaylo Sports
// ----------------------------------------------------------------------------
// The page the coach journey starts on: go to the website, click "Create a coach
// account", make an account, pay the one-off fee.
//
// IT IS HIDDEN, ON PURPOSE, AND MUST STAY HIDDEN UNTIL IT IS SWITCHED ON.
//
//   * It is not in NAV or FOOTER, so nothing on the site links to it.
//   * It renders with `noindex`, and scripts/gen-website.cjs leaves a noindex page
//     out of sitemap.xml (listing a page in a sitemap that tells crawlers not to
//     index it is a contradiction, and the sitemap is the stronger signal).
//   * COACH_MARKETPLACE_OPEN is false, so the page leads with the truth: coach
//     accounts are not open yet. Flipping it to true is the last step of
//     activation — see docs/COACH-MARKETPLACE.md, which lists it with the other
//     switches so it cannot be forgotten and a live-looking page cannot go out
//     with a "not open" banner still on it.
//
// Why the page exists at all while hidden: the app's coach studio links here, and
// a link that 404s is worse than a page nobody can find. It also means the words a
// coach will read have been written and reviewed before the money is switched on,
// rather than in the same afternoon as it.
//
// The numbers on this page are the product's, not marketing's. The commission is
// the same 20% the app charges and the database enforces, the example is the
// specified one (£5 plan, £6 paid, £1 platform), and the payout sentence says
// nothing has been transferred yet — because nothing has.
// ============================================================================

import { section } from "../parts.mjs";

/** Flip to true only as part of activation. See docs/COACH-MARKETPLACE.md §6. */
export const COACH_MARKETPLACE_OPEN = false;

const moneyExample = `The example we designed this around, and the one the app
actually computes:

<strong>A coach prices a one-week plan at £5.</strong> The buyer is charged £6. The coach is
paid £5 — exactly the price they set, not a percentage of it — and £1 is Vaylo's.
The £1 is <em>added on top</em> of the coach's price rather than taken out of it, and the
reason is the only one that matters: a coach who asks for £5 and is paid £4 has
been paid a number they never chose.`;

export const coaches = {
  path: "/coaches/",
  noindex: true,
  title: "Coach on Vaylo Sports",
  description:
    "Become a Vaylo Sports coach: set your own prices, publish your plans, and deliver them to athletes inside the app. One-off fee, and you are paid the price you set.",
  body: `
  <section class="hero hero-compact">
    <div class="shell hero-grid">
      <div>
        <p class="eyebrow">For coaches</p>
        <h1>You set the price. You keep the price.</h1>
        <p class="lead" style="margin-top:1.25rem">
          Vaylo Sports is a training log that athletes actually use, across running,
          cycling, football, rugby, tennis, the gym and more. Coaching here is not a
          content marketplace — it is a place to sell the plan you would write for
          somebody anyway, and to be paid what you decided it is worth.
        </p>
        <div class="btn-row">
          <a class="btn btn-primary" href="/contact/">Ask us when it opens</a>
          <a class="btn btn-secondary" href="#money">How the money works</a>
        </div>
      </div>

      <div class="sponsor-panel">
        ${
          COACH_MARKETPLACE_OPEN
            ? ""
            : `<div class="warn" style="margin:0 0 1rem">
          <p><strong>Coach accounts are not open yet.</strong> The marketplace is built
          and switched off while the company details and the payment account are
          finished. Nothing here can take a payment today — if you try to sign up,
          you will be told so rather than charged. Email us and we will tell you
          when it opens.</p>
        </div>`
        }
        <p class="pill">One-off fee &middot; you set the prices &middot; delivered in the app</p>
        <ul class="prose-list" style="margin-top:1rem">
          <li><strong>You are paid what you ask for.</strong> The platform fee is added on top.</li>
          <li><strong>No subscription.</strong> The coach fee is paid once.</li>
          <li><strong>Plans, not upsells.</strong> One purchase, one plan, no renewal.</li>
          <li><strong>Delivered in the app</strong>, to your buyer and nobody else.</li>
        </ul>
      </div>
    </div>
  </section>

${section({
  eyebrow: "What you get",
  heading: "A shop, and the athlete to sell to",
  intro: `<p>Everything a coach needs is in the app, and the only part that is on the
    website is the account itself — because a business signup is not something
    anybody should be typing on a phone.</p>`,
  body: `      <div class="grid grid-3">
        <div class="card">
          <h3 style="margin-top:0">Your own price, per plan</h3>
          <p>Price a plan however you like, in the currency you charge in, and change
          it whenever you want. Nothing is auto-priced for you and nothing is
          discounted behind your back.</p>
        </div>
        <div class="card">
          <h3 style="margin-top:0">You decide who can buy</h3>
          <p>A plan is published by you and taken off sale by you. Nothing is
          exclusive, nothing locks a buyer in, and no plan renews by itself.</p>
        </div>
        <div class="card">
          <h3 style="margin-top:0">Delivery inside the app</h3>
          <p>You write the plan in the coach studio and it goes to that buyer's app,
          attached to the order they paid for. No files by email, no chasing.</p>
        </div>
      </div>`,
})}

${section({
  className: "section-alt",
  id: "money",
  eyebrow: "How the money works",
  heading: "The fee is added on top, never taken out",
  intro: `<p>This is the part coaches ask about first, so it is on the page rather
    than in a document. There is one percentage, it is the same one the app shows
    before you publish, and it is enforced by the database rather than by a
    spreadsheet.</p>`,
  body: `      <div class="grid grid-2">
        <div class="card">
          <h3 style="margin-top:0">The worked example</h3>
          <p>${moneyExample.replace(/\n/g, "\n          ")}</p>
        </div>
        <div class="card">
          <h3 style="margin-top:0">What we are straight about</h3>
          <ul class="prose-list">
            <li><strong>Payouts are not connected yet.</strong> Every sale is recorded
            and owed to you, and nothing is transferred automatically today. That
            balance is what will be paid when payouts are switched on, and if that
            is no good for you today, ask us before you pay the fee.</li>
            <li><strong>Tax is your responsibility.</strong> Earning money as a coach
            may create tax and record-keeping obligations where you live. We cannot
            advise you on them.</li>
            <li><strong>Refunds are real.</strong> If a buyer is refunded, the
            earning does not stand — the ledger records that too.</li>
          </ul>
        </div>
      </div>`,
})}

${section({
  eyebrow: "The journey",
  heading: "Four steps, and two of them are on this website",
  body: `      <ol class="prose-list">
        <li><strong>Create a Vaylo Sports account</strong> — the coach account hangs
        off it, and it is what your buyers' purchases are recorded against.</li>
        <li><strong>Pay the one-off coach fee by card.</strong> Payment is taken by
        Stripe on this website. It is not a subscription and it does not renew.</li>
        <li><strong>Set your prices in the coach studio</strong>, in the app. You see
        exactly what the buyer will pay and what you will receive before you
        publish.</li>
        <li><strong>Deliver in the app.</strong> When somebody buys, you write the
        plan and send it to them, and the money you are owed is recorded against
        your account at the same moment.</li>
      </ol>
      <div class="btn-row">
        <a class="btn btn-primary" href="/contact/">Ask us when it opens</a>
        <a class="btn btn-secondary" href="/legal/">Legal documents</a>
        <a class="btn btn-secondary" href="/contact/">Ask a question first</a>
      </div>
      <p style="margin-top:1.5rem;font-size:0.92rem">
        Coach accounts are created on this website, and the fee is taken here by card.
        A plan bought from a coach inside the Android app is paid for through Google
        Play, which is what the store's rules require for a purchase made in the app.
      </p>`,
})}`,
};

export default coaches;
