// ============================================================================
// ACCESSIBILITY
// ----------------------------------------------------------------------------
// An accessibility statement, written the way this site writes everything else:
// what is actually true, and then the gaps, rather than a conformance badge.
//
// The two lists below are the page. "What this site does" contains only things
// that are true of the generated output and can be checked in it — and two of
// them are enforced by the build rather than remembered, which is worth saying
// because it is the difference between a promise and a mechanism.
//
// "What we have not done" is the more important half. The failure mode for a
// page like this is to imply an audit that never happened, and a reader with a
// screen reader is the one person who will discover that it did not.
//
// Note for whoever edits this next: do not add a conformance level here. Not
// because it would be hard to write, but because no independent review has
// tested it, and an untested claim on a page about accessibility is the exact
// thing this page refuses to do.
// ============================================================================

import { section, list } from "../parts.mjs";

export const accessibility = {
  path: "/accessibility/",
  title: "Accessibility",
  description:
    "What the Vaylo Sports website does for keyboard, screen reader, reduced-motion and low-vision users, what has not been checked yet, and how to report a barrier.",
  updated: "2026-10-08",
  body: `
    <div class="shell">
      <div style="padding-top:2.5rem">
        <p class="eyebrow">Accessibility</p>
        <h1>What this site does, and what has not been checked</h1>
        <p class="lead" style="margin-top:1rem">
          This statement covers the website you are reading. It says what is
          built in, and then it says plainly what has not been tested, because
          the second list is the one that is usually left out.
        </p>
      </div>

      <div class="note">
        <p style="margin-bottom:0"><strong>No conformance level is claimed on this
        page.</strong> No independent review of this site has been carried out.
        Putting &ldquo;WCAG 2.2 AA&rdquo; here without one would be a claim you
        have no way to check, and the person most likely to catch it would be the
        one who needs it to be true.</p>
      </div>
    </div>

${section({
  eyebrow: "Built in",
  heading: "What this site does",
  intro: `<p>Each of these is a property of the pages as generated, not an
    intention. The last two are enforced when the site is built.</p>`,
  body: `      ${list([
    "<strong>A skip link is the first focusable element on every page.</strong> It moves off the canvas rather than being hidden with opacity, so it can never be an accidental click target for a mouse user and it still takes focus.",
    "<strong>The page structure is real landmarks</strong> &mdash; header, navigation, main and footer &mdash; so a screen reader can jump between regions, with exactly one top-level heading per page.",
    "<strong>The current page is marked in the markup, not only in colour</strong>, with <code>aria-current</code>, so it is announced rather than merely implied.",
    "<strong>Every focusable control has a visible focus ring,</strong> and the stylesheet never removes or zeroes an outline.",
    "<strong>The mobile menu uses the <code>hidden</code> attribute,</strong> so it leaves the tab order when it is closed instead of trapping a keyboard user inside something they cannot see. Its button reports its state with <code>aria-expanded</code>.",
    "<strong>Motion is optional.</strong> Every animation and transition on the site is switched off when the device asks for reduced motion, including the one whose starting state is invisible.",
    "<strong>Both a light and a dark theme,</strong> following the system setting, with the colour scheme declared so form controls, scrollbars and the browser's own interface follow the page rather than staying light behind it.",
    "<strong>Tap targets.</strong> Navigation items are at least 44&nbsp;pixels tall and buttons and inputs at least 48&nbsp;pixels, which is what stops a link being missed on a phone.",
    "<strong>Forms have real labels,</strong> hints wired up with <code>aria-describedby</code>, invalid fields marked for assistive technology, and errors announced in a live region rather than only shown in red. The anti-spam trap field is hidden from the accessibility tree, not just visually, so nobody is asked about a field that does not exist for them.",
    "<strong>Tables use real header cells</strong> and scroll inside their own container, so a wide table does not make the whole page scroll sideways on a phone.",
    "<strong>Text is real text.</strong> The only images on the site are the brand mark and the social card, and the mark is marked decorative wherever the wordmark beside it already carries the name.",
    "<strong>Two of these are enforced by the build.</strong> The site fails to generate if the stylesheet removes or hides the focus outline, and it fails if any component is emitted with no styling rule at all &mdash; which is the mechanism, rather than a promise, behind the first and the last items above.",
  ])}`,
})}

${section({
  className: "section-alt",
  eyebrow: "Honestly",
  heading: "What we have not done",
  intro: `<p>These are gaps, not caveats, and they are the reason no
    conformance level appears at the top of this page.</p>`,
  body: `      ${list([
    "<strong>No independent accessibility audit has been carried out.</strong> Nothing here has been reviewed by a specialist, and no third party has tested the site with assistive technology.",
    "<strong>No full screen-reader pass across every page.</strong> The markup is written to be read correctly and the structure is enforced by the build, but that is not the same as having listened to all 40-odd pages with every major screen reader, and we are not going to describe the site as accessible without qualification until that has happened.",
    "<strong>The Android app is a different surface.</strong> Its accessibility depends on the platform's own features and on the app's own markup, and none of that is reviewed by this statement. Do not read this page as describing the app.",
    "<strong>Automated checks are not a substitute for a person.</strong> The build checks described above catch a missing style rule or a removed focus ring. They cannot tell whether the result is actually usable.",
  ])}`,
})}

${section({
  eyebrow: "Tell us",
  heading: "If something here does not work for you",
  intro: `<p>A barrier you hit is a defect, whether or not it appears on a list
    like the one above, and it is treated as one.</p>`,
  body: `      <p>Write to us through the contact page and describe what you were trying
      to do and what happened, including the page and the browser or assistive
      technology if you know it. If a barrier stopped you doing something on this
      site, say so in those words &mdash; it goes to a person, and it is not a
      support ticket about your account.</p>
      <p>If the response is not good enough, the complaints procedure sets out how
      to ask for it to be reviewed and how to take it further if you are still not
      satisfied.</p>
      <div class="btn-row">
        <a class="btn btn-primary" href="/contact/">Contact us</a>
        <a class="btn btn-secondary" href="/legal/complaints/">Complaints procedure</a>
        <a class="btn btn-secondary" href="/faq/">Questions &amp; answers</a>
      </div>`,
})}`,
};
export default accessibility;
