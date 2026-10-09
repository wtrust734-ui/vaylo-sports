# Legal obligations audit — the app and the website

**Date:** 7 October 2026 · **Scope:** legal only. No product features.

**I am not a lawyer and this is not legal advice.** It is an inventory of what the
product publishes, what it shows the user, what is missing, and what only you (or a
solicitor) can close. It replaces the recommendations in
[docs/LEGAL-AUDIT-2026-10.md](LEGAL-AUDIT-2026-10.md) that this pass has now done,
and it is meant to be read alongside
[docs/FEATURE-LEGAL-PROCESS.md](FEATURE-LEGAL-PROCESS.md), which is the rule for
keeping it true as features change.

---

## 1. The one-line answer

The **documents** were already unusually complete — 27 published policies, generated
from one source, guarded by tests. What was genuinely missing was not pages. It was:

1. **a cookie notice**, because the website had none while the policy claimed that
   was a deliberate decision;
2. **a cookie policy that was true**, because it described a cookie the shipped app
   never sets and one cookie it does not use as if it were in use;
3. **a privacy notice at the point the website collects an email address**;
4. **a consent record that identifies the terms text accepted** — it named version
   1.0 while the published Terms were at 1.2;
5. **the standard contract terms the Terms were missing** — separability, the whole
   agreement, no waiver, events outside our control, transfer;
6. **a re-acceptance prompt**, because the Terms promised one and nothing delivered
   it: a version stamp proved what somebody accepted once and then never moved.

All six are fixed in this pass (§3). Everything left is either an **operator fact**
only you can supply (§5) or a **professional review** (§6). Those are the real
remaining risks, and none of them is code.

---

## 2. What exists, and is genuinely strong

| Obligation | Where | State |
|---|---|---|
| Published policies | `legal/*.html` (27), `legal/pages.json` | ✅ one source, published to the website and embedded in the app |
| Legal & Safety Centre in-app | `src/pages/Legal.tsx` → `/legal` | ✅ every document, every right, every safety control |
| Document viewer inside the app | `src/pages/LegalDocument.tsx` → `/legal/:slug` | ✅ renders bundled HTML, no network, no external browser |
| Terms + Privacy acceptance at sign-up | `src/pages/Auth.tsx` checkbox gate | ✅ checkbox gates account creation; 13+ stated |
| Acceptance recorded | `profiles.terms_accepted_at`, `terms_version`, `health_consent_at` (`src/lib/consent.ts`) | ✅ written on sign-up, guest sign-in and first health entry |
| Health data consent | `src/lib/consent.ts`, `legal/health-safety.html` | ✅ recorded once, never overwritten |
| Account deletion (in-app, instant) | `/settings/delete-account`, `supabase/functions/delete-account` | ✅ verifies afterwards and reports what survived |
| Account deletion (web, for people without the app) | `/delete-account/` + `legal/account-deletion.html` | ✅ a request with identity verification, described as exactly that |
| Data portability (UK GDPR Art 20) | "Download your data" in `/legal`, `supabase/functions/export-my-data` | ✅ reports a partial export rather than claiming completeness |
| Reporting and blocking | `content_reports` + `ReportMenu`, `legal/report-content.html` | ✅ Play UGC requirement |
| Age handling | 13+ gate, DB-enforced 18+ ad gate, minor training caps | ✅ `legal/child-safety.html` |
| Advertising disclosure | `legal/advertising.html` | ✅ no ad SDK, no analytics SDK, no advertising identifier |
| AI disclosure | `legal/ai-disclaimer.html` + `src/config/disclaimers.ts` shown on the AI surfaces | ✅ "generated, can be wrong, not medical advice" |
| Training / health / nutrition / injury / mental-health notices | `legal/*` + `DISCLAIMERS` rendered in Train, Coach, Form, Nutrition, Injury, Challenges | ✅ |
| Liability cap and exclusions | `legal/terms.html` §14 | ✅ limited, with statutory consumer rights preserved |
| Subscription and refund terms | `legal/purchases.html`, `legal/refunds.html`, `Market` purchase surfaces | ✅ auto-renewal, cancellation route, Google Play as merchant |
| Complaints, security disclosure, IP/copyright, competition terms | `legal/complaints.html`, `legal/security-disclosure.html`, `legal/intellectual-property.html`, `legal/competition-terms.html` | ✅ |
| Website Legal Centre | `website/legal/` (27 documents, canonical URLs) | ✅ |
| Health Connect rationale (Play requirement) | `public/health-rationale.html`, opened by `MainActivity.RATIONALE_PAGE` | ✅ shown before the Android permission request |
| Cookie notice | `website/` footer notice — **added in this pass** | ✅ §3.1 |

Nothing above needs to be written from scratch.

---

## 3. Changed in this pass

### 3.1 A cookie notice, with an Accept action

`site/layout.mjs` renders the notice on every page; `site/assets/site.js`
(`initCookieNotice`) reveals it only when the device has not acknowledged it, and
`site/theme.css` styles it.

Three deliberate properties, all of which matter legally:

- **It is a notice, not a consent gate.** Nothing on the site waits for the button.
  Everything Vaylo sets is strictly necessary or a local preference, and pretending
  otherwise — an "accept all" on a site with no non-essential cookies — would be
  theatre, and worse than none.
- **Accept writes one entry in the browser's own storage**, on the reader's device.
  Nothing is sent to us, so we cannot count it or tie it to anybody. Section 5 of the
  Cookie Policy says this.
- **With scripts blocked it is never shown**, because a notice whose Accept button
  cannot do anything is worse than no notice. With *storage* blocked it is shown
  every visit, because forgetting a choice is not the same as making one.

If a genuinely non-essential cookie is ever added — analytics, an embedded video, a
pixel — it needs a real opt-in, off by default, changeable afterwards. The policy now
says so in advance.

### 3.2 The Cookie Policy is now true (`legal/cookies.html`, v1.1)

It previously said the complete list of cookies was one entry, `sidebar:state`, and
that there was deliberately no banner. Both statements were wrong:

- `sidebar:state` is written only by `src/components/ui/sidebar.tsx`, and **nothing
  imports that component**, so the shipped app and the website never set it. It is
  now disclosed as *the one cookie the code can write, not set today*, with the
  reason, because a policy that lists only what happens to be running is one you
  cannot rely on.
- The website sets **no cookie at all**, which the policy now states plainly, along
  with what is stored in local storage, the two storage entries that were missing
  from the list (offline cache/queued entries, and the notice acknowledgement), and
  what Accept actually does.

A test pins the fact this depends on (`legalContentConsistency.test.ts`): the
document still names `sidebar:state`, so removing it from the code without removing
it from the policy fails the build.

### 3.3 Privacy notice where the website collects an address

`site/parts.mjs` now puts a short Article 13 note under every website form —
what the address is used for, that it is not a mailing list, that it is not shared,
and how to have it deleted — with a link to the Privacy & Data Centre. The waiting
list note is specific to the waiting list and links the waiting list terms. The
privacy request form points at the data-rights document instead of at the page the
reader is already on.

This matters because it is the one place a visitor's data is collected without an
account, so "it is in the policy somewhere" is not good enough.

### 3.4 The recorded terms version now matches the published Terms

`src/lib/consent.ts` said `TERMS_VERSION = "1.0"` while `legal/terms.html` had been
at **1.2** since 4 October. `profiles.terms_version` is the only evidence of *which*
text an athlete agreed to, and every record on file named a version that no longer
existed — which is the same as recording nothing. A test now reads the version line
out of `legal/terms.html` and fails if the constant drifts from it again.

### 3.5 The Terms gained the standard contract terms they were missing

`legal/terms.html` is now **version 1.3** (effective 7 October 2026) with a new
section 16 covering **separability**, the **whole agreement**, **no waiver**,
**events outside our control**, and **transfer** — the five clauses an earlier audit
found zero occurrences of across the whole document set. Section 14 already carried
the liability cap and the exclusion of indirect loss, so this pass adds the cheap,
standard mechanics rather than rewriting anything a solicitor should own. The
separability clause is written to survive the specific risk in section 14: if a
limit is ever held unfair against a consumer, that limit falls away and the rest of
the terms stand.

### 3.6 The app now actually asks before a change applies

`legal/terms.html` §17 promised that a material change would be shown in the app and
that the athlete would be asked to accept it. Nothing did that: `terms_version` was
written once at sign-up and never moved, so bumping the document changed what an
athlete was bound by without telling them.

`src/components/legal/TermsChangeNotice.tsx` closes it. It appears whenever the
athlete's own recorded `terms_version` differs from the published one — including
`null`, which is every account created before the columns existed — says what changed
and which version they accepted, and offers **Accept**, **Read the Terms**, or
**delete your account**. Three properties are deliberate and tested:

- **It is not a gate.** It sits above the tab bar and blocks no route; the Terms' own wording is that continuing to use the app means accepting the current version,
and what was missing was telling the athlete, not walling off their own training data.
- **It cannot be dismissed without accepting.** A banner people learn to swipe away
stops protecting anybody.
- **It only disappears when the record exists.** Accepting calls
  `recordTermsAcceptance()`, which was changed to **report whether the row was
  written** rather than swallowing the answer; on a failed write the prompt stays,
  with the reason, and the profile is not re-read. An athlete believing they accepted
  something we cannot evidence is the exact failure this component exists to prevent.

Covered by `src/lib/termsReacceptance.test.ts` (wiring, ordering, no dismiss path) and
`src/components/legal/TermsChangeNotice.test.tsx` (rendered: behind, current, unknown,
null, failed write, and both routes out).

---

## 4. What is shown to the user, and where

The question "do I show this, or just publish it?" — every row below is a
**disclosure the user actually sees**, not a page they could find if they looked.

| When | What they see | Link to the document | State |
|---|---|---|---|
| Creating an account | Unticked checkbox: 13+, Terms, Privacy, "including how my health and fitness data is handled" | Terms, Privacy | ✅ |
| First health entry / Health Connect | Health consent recorded; Android permission rationale page | Privacy, Health notice | ✅ |
| Before buying credits or a plan | Price, interval, "renews automatically … until cancelled" / "nothing renews" per product | Purchases, Refunds | ✅ |
| Any AI surface | "AI output is an estimate, not a measurement"; "not a medical or coaching replacement" | AI disclaimer | ✅ |
| Training, injury, nutrition, form analysis | "Stop if something hurts", "not medical advice", under-18 limits | Health safety, Nutrition, Injury | ✅ |
| Feed, communities, profiles | Report control and block, with reasons | Community guidelines | ✅ |
| Legal & Safety Centre | Age band in use, and what it changes for you | Child safety | ✅ |
| Deleting an account | Confirmation, what is removed, what survives, cancel-subscription warning | Account deletion | ✅ |
| **First visit to the website** | **Cookie notice: no tracking cookies, link to the policy, Accept** | **Cookie policy** | ✅ new |
| **Submitting any website form** | **What the address is used for, how to have it removed** | **Privacy & Data Centre** | ✅ new |
| App open, after a material Terms change | **A prompt: which version you accepted, what changed, Accept / Read / delete your account** | Terms §17 | ✅ new |

---

## 5. What is still missing — and only you can close it

These are not code. Each one is a real gap today, in rough priority order.

> **5.1 The operator's legal identity is blank.** `legal/operator.json` holds a name
> and a Gmail address, and nothing else. Every policy identifies the controller as
> `%%OPERATOR_NAME%%`. UK GDPR Article 13 requires the *identity and contact details
> of the controller*, and a business-to-consumer service should name its registered
> entity, company number and postal address. This is the single biggest remaining
> item. Add them to `legal/operator.json` (the tests forbid inventing them, which is
> why they are blank), then re-run `node scripts/gen-legal-pages.cjs && npm run
> site:build`.

> **5.2 ICO registration.** Decide whether you must register with the Information
> Commissioner's Office as a data controller (most UK businesses processing personal
> data do, with a small exemption) and publish the registration number. The About
> page and the policies currently say it is not published yet.

> **5.3 Whether a DPO or EU/UK representative is needed.** For a UK operator with no
> EU establishment, an Article 27 representative is only required for certain
> processing — but "we did not think about it" is not a defensible position.
> A written decision not to appoint is enough; record it.

> **5.4 The server-log retention period.** Every retention section currently says "a
> short rolling window" instead of a number. Pick one and publish it. "Undecided" is
> honest but it is not a retention policy.

> **5.5 Moderation staffing and response times.** Reports are read by a person
> (the documents say so). Nothing states who, or how quickly, and the Content
> Guidelines promise that reports are actioned. Those are promises running ahead of
> the process.

> **5.6 Professional indemnity insurance.** A health-adjacent product with injury
> guidance and AI advice. An insurer's view of the liability wording is itself a
> review worth having before any paid acquisition.

> **5.7 Google Play Console items** (each is an operator task, not a document):
> - the **privacy policy URL** and the **account-deletion URL** — both already live
>   under `website/legal/`;
> - the **Data safety** form, from the real schema (account, training, health,
>   photos/video, purchases);
> - **target audience 13+** and the content rating questionnaire;
> - the **Health Connect** declaration and the rationale page that already explains
>   each permission;
> - **EU trader status** (DSA): name, address and contact details for the operator,
>   which is §5.1 again.

All three surfaces now carry the same documents: the website, the web clone and the
APK were each rebuilt and their bundles inspected (§9), so nothing above is a
"we fixed the file but shipped the old one" gap.

---

## 6. For a solicitor, specifically

Short, and cheap to answer — these are the questions worth paying for:

1. **Liability wording** in `legal/terms.html` §14, tested against the Consumer
   Rights Act 2015 and the unfair-terms rules (a badly drafted cap is worse than
   none, because it can taint the surrounding clauses).
2. **The 14-day cancellation right** for digital content under the Consumer
   Contracts (Information, Cancellation and Additional Payments) Regulations 2013 —
   whether the current wording in `legal/purchases.html` and `legal/refunds.html`
   switches it off correctly once digital content has begun.
3. **Lawful basis for health data** (Art 9 explicit consent vs legitimate
   interests), the consent wording shown at sign-up, and whether withdrawal must be
   made as easy as giving it.
4. **Virtual currency enforceability** — that credits are licensed, not property,
   and non-refundable except where the law requires.
5. **Competition and promotion terms** against the challenges and leaderboards
   actually running (`legal/competition-terms.html`).
6. **Sponsorship and ad labelling** against ASA/CAP guidance, and the claim in
   `legal/advertising.html` §8.3 that a brand cannot influence what an athlete is
   told.
7. **The website's cookie position** — not because anything needs consent (nothing
   does), but because it is the kind of conclusion worth having confirmed in writing.

---

## 7. How to change any of this without breaking it

The rules are in [docs/FEATURE-LEGAL-PROCESS.md](FEATURE-LEGAL-PROCESS.md). The short
version, because it is easy to get wrong:

```
legal/<slug>.html        ← author here, never in website/ or pages.generated.ts
legal/pages.json         ← only when ADDING a document
legal/operator.json      ← the one place the operator name and email live

node scripts/gen-legal-pages.cjs    # regenerate the in-app embedding
npm run site:build                  # regenerate website/ (43 files, 38 URLs)
```

Website-only changes live in `site/`: `layout.mjs` (the shell and the cookie
notice), `parts.mjs` (forms and the privacy note), `theme.css` (styles),
`assets/site.js` (the notice behaviour), `pages/*.mjs` (page copy),
`data/site.mjs` (nav, footer, the document index).

Then run:

```bash
npx vitest run src/lib/website.test.ts src/lib/websiteStyleCoverage.test.ts \
  src/lib/legalPages.test.ts src/lib/legalContentConsistency.test.ts \
  src/lib/legalHostLayout.test.ts src/lib/legalInApp.test.ts
```

Two things worth knowing before editing anything here:

- **Every class the templates emit must have a rule in `site/theme.css`**, or
  `websiteStyleCoverage.test.ts` fails. That test exists because the site once
  rendered white-on-white in Times New Roman while every other test passed.
- **The cookie policy must keep naming `sidebar:state`** while that component
  exists in the codebase. If you delete `src/components/ui/sidebar.tsx`, delete the
  section from `legal/cookies.html` in the same change.

The web clone (`VayloSports-WebApp.zip`) embeds these documents too, so any change
to `legal/` needs `npm run build:clone` to keep it in step — see
[docs/WEB-CLONE.md](WEB-CLONE.md).

---

## 8. What I would do next, in order

Everything that could be done without you has been done, so this list is entirely
yours — and it is short, because the code side is closed.

1. Fill in `legal/operator.json` with the registered entity, number and address
   (§5.1) — 15 minutes, and it closes the largest real gap.
2. Decide the ICO registration and the DPO / representative questions and record the
   answers (§5.2, §5.3).
3. Pick a server-log retention period and publish it (§5.4).
4. Decide who reads reports and how quickly, and put that in the Content Guidelines
   (§5.5).
5. Take §6 to a solicitor — one consultation, not an open-ended project.
6. Complete the Play Console declarations (§5.7).

---

## 9. What this pass verified, and how

The point of listing this is that "the document says X" and "the product does X"
were checked separately, and both were checked on the artifacts that ship:

| Check | Result |
|---|---|
| Full test suite | 84 files / 1528 tests pass |
| `npm run typecheck` | clean |
| Website regenerated | 43 files, 38 URLs, links and class coverage validated by the generator and its tests |
| Cookie notice in a real browser | reveals on first visit; **Accept** hides it and stores only the acknowledgement; it survives navigation and reload; clearing site data brings it back; `document.cookie` is **empty**; no console output |
| Notice layout | one 81px row at 1280px; 163px with a full-width 52px Accept button at 400px; no horizontal overflow |
| Website form notices | render on the support, waiting-list and privacy pages, with links that resolve |
| Web clone | rebuilt, 183 entries, zero backslash names, serves and **boots**: the dashboard renders in demo mode, every asset the page references returns 200 |
| APK | rebuilt, `unzip -t` clean, `apksigner verify` exit 0, and the bundle inside it contains Terms 1.3, the new section 16, Cookie Policy 1.1, and the re-acceptance prompt |
| Terms re-acceptance | 8 wiring tests and 8 rendered tests, including the failed-write case |

Two things this pass did **not** verify, stated so they are not mistaken for done:
the prompt rendered inside the installed Android app on a device (the bundle contains
it and the component is covered by rendered tests, but no emulator was run), and the
operator details, which are deliberately absent rather than invented.
