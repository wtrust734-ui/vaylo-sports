// ============================================================================
// WAITING LIST
// ----------------------------------------------------------------------------
// Vaylo Sports is not on the Play Store yet, so someone who wants it has had
// nowhere to say so. This is that place.
//
// The copy rule on this page is the same one the rest of the site follows: say
// what actually happens, not what would be reassuring. In particular —
//
//   * mail is real now, and there is a date: the Android release opens on
//     1 January 2027. The page says both, because a held-back date and an
//     announced one are different promises, and the page must never be quieter
//     than the emails it describes. What it still must not do is imply a queue,
//     a position, or an entitlement — there are none;
//   * there is no queue, so there is no position to give anybody and none is
//     shown;
//   * removal is real and self-service, through a link that is unique to one
//     subscriber. That is deliberately not a form anyone can type an address
//     into: such a form would be an oracle for who is on the list, which is the
//     property the old copy protected and which is kept here.
//
// It also states plainly that this is not on the Play Store yet — it opens on
// 1 January 2027 — since the whole reason for the page is that it is not there
// today.
// ============================================================================

import { section, list, waitlistForm } from "../parts.mjs";

export const waitlist = {
  path: "/waitlist/",
  title: "Waiting list",
  description:
    "Vaylo Sports opens on the Google Play Store on 1 January 2027. Join the waiting list for the launch-day link.",
  body: `
    <div class="shell">
      <div style="padding-top:2.5rem">
        <p class="eyebrow">Waiting list</p>
        <h1>Join the waiting list</h1>
        <p class="lead" style="margin-top:1rem">
          Vaylo Sports is not on the Google Play Store yet. It opens on
          1 January 2027, and there is no listing to link to until then. Join the
          waiting list and we will email you when that happens: a confirmation
          now, a short run of updates as the date approaches, and the link on
          launch day. That is the whole of what the address is used for.
        </p>
        <p class="lead" style="margin-top:0.75rem;font-size:0.95rem">
          Joining costs nothing and reserves nothing, and the
          <a href="/legal/waitlist-terms/">waiting list terms</a> say exactly what
          it does and does not mean &mdash; in one page, in plain words.
        </p>
      </div>
    </div>

${section({
  id: "join",
  eyebrow: "Join",
  heading: "One field, and what we do with it",
  intro: `<p>We store the address you give here and the time you gave it, and we
    use it for one thing: telling you about the Android release. The
    confirmation goes out as soon as you join, and it names the date we are
    working to &mdash; 1 January 2027 &mdash; rather than implying one is close.</p>`,
  body: `    <div class="grid grid-2" style="align-items:start">
      <div class="card">
${waitlistForm({ id: "waitlist" })}
      </div>
      <div>
        <div class="card">
          <h3 style="margin-top:0">What happens to your address</h3>
          ${list([
            "It is stored securely in our own database.",
            "It is used for one thing: a confirmation when you join, a short run of updates before launch, and the message with the link when the Android release opens.",
            "It is not sold, rented, or shared with advertisers. There is no advertising on this site.",
            "It is not added to any other list, because there are no other lists.",
            "Every email carries a link that removes you from the list immediately.",
            "The <a href=\"/legal/waitlist-terms/\">waiting list terms</a> set this out in full, including how to have it deleted.",
          ])}
          <p style="margin-bottom:0">Joining twice does not create two entries,
          and we will not email you to ask whether you meant to.</p>
        </div>

        <div class="card" style="margin-top:1rem">
          <h3 style="margin-top:0">Changed your mind?</h3>
          <p>Use the link at the foot of any email we send and you are removed
          immediately &mdash; there is nothing to confirm and no reason to give.
          You can also ask us through the <a href="/contact/">contact page</a>
          or the <a href="/support/">support form</a>, which carries the same
          <a href="/legal/data-rights/">30-day commitment</a> as every other
          data request &mdash; in practice it is immediate.</p>
          <p style="margin-bottom:0">That link is unique to you, and there is no
          page where an address can be typed in to remove somebody. That is
          deliberate: a form that acted on any address entered would let anyone
          check whether a given person is on this list, and let anyone remove
          them. A per-person link does neither.</p>
        </div>
      </div>
    </div>`,
})}

${section({
  className: "section-alt",
  id: "what-else",
  eyebrow: "Meanwhile",
  heading: "You do not have to wait",
  body: `      <p>Most of Vaylo does not need the Play Store. The app runs in your
      browser against the same backend, so you can look around, or check whether
      it is worth waiting for.</p>
      <div class="btn-row">
        <a class="btn btn-secondary" href="/features/">See what is in it</a>
        <a class="btn btn-secondary" href="/support/">Get support</a>
      </div>`,
})}`,
};
export default waitlist;