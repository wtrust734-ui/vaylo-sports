# Legal pages audit — 7 October 2026

**Read this first: I am not a lawyer, and nothing here is legal advice.** No
engineer or AI can promise you will not be sued. What this document does is
(a) show you what is already in place, (b) fix the *structural* gaps that are
objectively wrong — a missing acceptance, a document that contradicts the
product, a disclosure that was not published, and (c) hand you a short,
prioritised list of things that only a qualified professional can sign off.

The one thing you should take away: the *machinery* here is stronger than in
most shipped apps, and the remaining risk is almost entirely in **boilerplate
that does not exist yet** plus **two company facts that are still blank**.

---

## 1. What already exists (and is genuinely good)

| Thing | State | Evidence |
|---|---|---|
| Documents published | **27**, all with a version line and a contact route | `legal/*.html`; `grep` shows 27/27 have both |
| One source of truth | `legal/pages.json` drives the site, the app and the edge function | `scripts/gen-website.cjs`, `scripts/gen-legal-pages.cjs` |
| Site and app cannot drift | Both are generated from `legal/`, and a test fails if the committed copies differ | `src/lib/legalContentConsistency.test.ts`, `src/lib/legalPages.test.ts` |
| Links cannot rot | Every cross-link is rewritten to a real path, and a test rejects a bare relative link that would 404 | `src/lib/website.test.ts` "routes a document's internal cross-links" |
| No invented company facts | The About page renders visible "Not yet published" placeholders and a test forbids a fabricated registration number, address, ICO number, phone number or Play listing | `src/lib/website.test.ts` "no invented information" |
| Age rules published | 27/27 documents reference the age boundary; the under-18 restrictions are enforced in the database, not the UI | `SPONSORSHIP.md`, `legal/child-safety.html` |
| No ad/analytics SDK | Stated in the advertising disclosure and zero-tracker rule | `legal/advertising.html` §3 |

That last row matters more than it looks: most "we don't track you" claims are
false the moment an SDK is added. Here the claim is backed by the app having no
advertising SDK at all, which is the kind of statement that survives scrutiny.

## 2. What this pass changed

1. **Brand and sponsorship enquiry terms now exist** — `legal/advertising.html`
   §8. Previously the sponsorship system described in `SPONSORSHIP.md` had no
   brand-facing terms at all, and the new `/sponsors/` questionnaire would have
   collected a company's details with nothing published about why or for how
   long. §8 covers what is collected, that an enquiry is not a contract, the
   brand's obligations, and the data-rights route.
2. **A promise about AI and brand money** — §8.3 states that a brand may not buy
   influence over what an athlete is told, that the "AI preference" capability is
   **not implemented**, and that nothing about a brand influences an athlete's
   guidance today. You approved this wording. It is the single most important
   clause added, because it is the claim most likely to be tested by a future
   sales conversation.
3. **Version bumped** to 1.1 / 7 October 2026, and the questionnaire records the
   accepted version with a timestamp. An acceptance against a version that no
   longer exists is recorded as such rather than silently upgraded.
4. **The embedded app copy was regenerated** (`node scripts/gen-legal-pages.cjs`)
   so the in-app legal library and the website still say the same thing.

## 3. Gaps found, in priority order

### 3a. Needs a lawyer — these are the ones that actually reduce your risk

1. **No cap on liability, and no exclusion of indirect loss.** Only 4 of 27
   documents mention liability at all. `terms.html` is the natural home. A
   liability cap is the single highest-value clause you are missing, and it must
   be drafted to survive UK/EU consumer law — a badly drafted cap is worse than
   none, because it can look like an unfair term and taint the rest.
2. **No indemnity, no force-majeure clause, no severability clause, and no
   entire-agreement clause.** `grep` finds **zero** occurrences of all four
   across the whole set. These are standard English-contract boilerplate; their
   absence is not fatal, but they are cheap to add and each covers a real
   scenario.
3. **Governing law / jurisdiction is stated in only 4 documents.** Acceptable if
   `terms.html` states it once and the satellites defer to it — but have a lawyer
   confirm that the deferral is explicit enough for each document a consumer
   might read alone (the cookies page, the refunds page and the safety pages are
   the ones people actually land on from search).
4. **No professional-indemnity insurance in place.** The About page already
   admits this rather than inventing a policy. For a health-adjacent product with
   injury-risk features, an insurer's view of your wording is itself a review you
   want before launch.
5. **Competition / promotion law.** `competition-terms.html` exists and
   challenges, leaderboards and referrals run in the app. Prize promotions have
   specific rules (and per-country variation) that a template cannot cover.

### 3b. Company facts still blank — you must supply these

The About page renders these as explicit "Not yet published" placeholders, and
the Privacy Policy, Terms and Contact pages all need them to identify the data
controller and the service address:

| Fact | Needed by |
|---|---|
| Registered legal entity name | Privacy Policy (controller), Terms, About |
| Company registration number | Terms, About |
| Registered postal address | Privacy Policy, Terms, About, Complaints |
| ICO registration number | Privacy Policy (UK GDPR), About |
| Data protection officer or contact | Privacy Policy, Data Rights |

Supplying these is a content job, not a code job: put them in
`legal/operator.json` and the generators substitute them everywhere. Until they
exist, a privacy policy that does not name a controller is a real compliance
gap, not a cosmetic one.

### 3c. Fixed structurally in this pass, worth knowing

- **Terms acceptance on the website.** Before today, acceptance was recorded only
  in the app. The waitlist and support forms still record none. The sponsor
  questionnaire is now the first website form that requires an explicit tick and
  records the accepted version and time. If you want the same for the waiting
  list, that is a small follow-up — see §4.

## 4. Recommended next actions

| # | Action | Effort | Who |
|---|---|---|---|
| 1 | Fill in the five company facts in `legal/operator.json` | 15 min | You |
| 2 | Ask a solicitor for a liability cap + boilerplate review of `terms.html` | — | A lawyer |
| 3 | Add terms acceptance to the waiting-list form | 1 h | Engineering |
| 4 | Review the competition terms against the challenges actually running | — | A lawyer |
| 5 | Decide whether to keep the Netlify copy live (it is stale and contradicts the launch date) | 10 min | You |
| 6 | Add a cookies-consent decision point if any non-essential cookie ever appears | — | Engineering + lawyer |

## 5. How to keep this true

The reason this set has stayed consistent is that it is **generated and guarded**,
not remembered. See `docs/FEATURE-LEGAL-PROCESS.md` for the rule to follow every
time a feature is added, and the tests that enforce it.
