# UI: the touch-target floor and how to check the app

## The floor

`src/index.css` ends with one rule:

```css
:where(button, [role="button"], [role="tab"], [role="radio"], [role="menuitem"],
       [role="switch"], select, textarea,
       input:not([type="checkbox"]):not([type="radio"]):not([type="range"])) {
  min-height: 44px;
}
```

Android's own guidance is 48dp; 44px is the smallest control a thumb hits
reliably, and it is what the audit measures. `:where()` contributes no
specificity, so it is a **floor and not a style** — any `min-h-*` utility on a
component still wins, and `min-h-0` opts a control out where a compact row
genuinely needs it.

Why a rule rather than per-component sizes: when this was added, the app had 88
controls under 44px on Event Packs alone, 16 on Avatar and 8 on Leaderboard, all
of them bespoke `<button className="px-3 py-2 text-xs">` elements that no shared
component would ever have fixed. The five OAuth buttons on the sign-in screen
were already fine because they used the `Button` primitive; everything hand-rolled
was not.

Deliberate exclusions: bare `<a href>` (a link inside a sentence is a sentence,
not a control — links that act as buttons carry their own sizing, e.g.
`NotFound.tsx`), and checkboxes, radios and range inputs, where a 44px box is a
worse control.

## Running the audit

```bash
npm run ui:audit          # build, screenshot all 46 routes, write a gallery
npm run ui:check          # the same measurements, non-zero exit on a defect
node scripts/ui-audit.mjs metrics avatar    # only these routes
```

Output lands in `.freebuff/ui-audit/`: one PNG per route, `report.json`, and
`gallery.html` (every screenshot inlined, so the whole app can be reviewed by
scrolling one page — open it in the Preview tab, or any browser).

It drives the system Chrome over the DevTools Protocol using Node's built-in
WebSocket, so there is no playwright or puppeteer dependency. It serves `dist/`
from inside its own process rather than starting a dev server: a dev server
launched from a tool call dies with the call, which is why the first version of
this harness photographed an error page.

It signs in with a throwaway account (`ui.review.20260928@example.com`) against
the hosted project, because every route but `/auth` is behind a session. Sign up
a fresh one with the same naming pattern if that account is ever removed, and
skip onboarding by clicking **Skip setup →**, or every route photographs the
onboarding wizard instead of itself.

## What it fails on

| Defect | Why it is a defect |
| --- | --- |
| A control under 44px tall, or under 44px wide with no text | Unreachable with a thumb |
| `document.scrollWidth > innerWidth` | The page scrolls sideways |
| A line that is just `undefined` / `NaN` / `null`, or `x: undefined` | A value failed to render |
| A word repeated inside one line | Almost always a botched two-tone heading — the sign-in screen shipped "Vaylo Sports Sports" |
| A console exception or a failed request | Something broke while the screen was loading |

What it deliberately does **not** fail on: an element hanging off the right edge
of a clipping parent (the decorative glows on auth, home and Avatar do this), or
a carousel's off-screen cards. Both are reported as overflow and both are
correct — elements inside an `overflow-x: auto` ancestor are excluded on purpose.

## Defects this found, all fixed

- **88 sub-44px controls** on Event Packs, 16 on Avatar, 8 on Leaderboard, and
  smaller counts on nine other screens — fixed by the floor above.
- **"Vaylo Sports Sports"** as the sign-in heading: the two-tone heading put the
  word in twice (`Auth.tsx`).
- **`MetricsHub` invented a diagnosis.** With no logs it defaulted readiness to
  50 and painted that tile red, and because a load ratio of 0 counts as
  "undertrained", the injury-risk tile read **MODERATE** to an athlete who had
  trained zero times. Both tiles now read `—` in muted type until there is data.
- **`CrossTraining` displayed a fabricated readiness**: "Readiness 65/100" in the
  *For you* header with no recovery logs. The 65 is a ranking default and the
  header now says "No readiness logged" instead.
- **`Identity` showed "Undefined"** in 5xl type as the athlete's archetype
  headline (`VPR` did the same mid-sentence). Both say "not set yet", and the
  VPR line lost a missing space before its progress parenthetical.

## Keeping it honest

`npm run ui:check` is a measurement of the rendered app, not a unit test — jsdom
has no layout engine, so no test in `src/` can see a 30px button.
`src/lib/touchTargets.test.ts` guards the other half: that the rule is still
written down at all, since deleting it breaks nothing a build would notice.
