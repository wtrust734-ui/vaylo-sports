# 29 — Children's Code / Age-Appropriate Design Assessment

**Drafted 2026-10-02. Internal — but a publication candidate. Owner: unassigned.**

> The UK Children's Code expects the data protection impact assessment for a service likely
> to be accessed by children to be **published in full before the service is so accessed**.
> This document is deliberately not published yet, for two reasons: it is incomplete, and
> publishing an incomplete assessment as the required one would misrepresent the position.
> Both are stated below rather than glossed.

## 1. Is the service likely to be accessed by children?

**Yes, by design.** The Terms set a floor of 13 and the product is built for 13–17 year olds
in places: training volume is capped by age, nutrition and calorie features are switched off
for under-18s, and purchases are unavailable to them. The audience is not incidental.

That triggers the Code's "likely to be accessed" threshold, so this assessment is required.

## 2. The fifteen standards, against what is actually implemented

Each row states the standard, what the app does, and whether the implementation is real or
aspirational. "Enforced in code/database" means there is a check that cannot be bypassed by
a client bug — the distinction the Code actually cares about.

### Appropriate application
- **1.1 The service is likely to be accessed by children or used to access content
  appropriate to them.** Met. The age floor is in the Terms; content switches are enforced
  in code, not just hidden.
- **1.2 Considered during design and delivery, evidenced in the DPIA.** Partly. Document 28
  exists; there is no record of design-phase consideration for the feature set.
- **1.3 Risks identified and mitigated, residual risks explained.** Partly — document 39
  lists them; several mitigations do not exist yet (see §4).

### A better experience for users
- **2.1 Users are told they are interacting with a service aimed at or involving children.**
  **Not met.** No age or audience prompt exists in-app.
- **2.2 Advertising is age-appropriate and excludes under-18s.** Met in part: sponsors are
  database-constrained to 18+, so a placement cannot be configured to reach a young athlete.
  **No advertising is served at all in the current build**, which trivially satisfies it.
- **2.3 Users are challenged less than adults, and to an extent the service is age
  appropriate.** Not met. A signed-in user can delete their account, export their data, or
  file a report without any age-related friction.
- **2.4 Users are protected from harmful features, e.g. autoplay, infinite scroll,
  notifications or rewards loops.** **Not met.** Streaks and coin rewards exist with no
  age variant, and `mental-wellbeing.html` itself flags that streak mechanics can go wrong.

### Support for parents and carers
- **3.1–3.4 Clear routes for a parent to review, consent to and control a child's account.**
  **Not met.** There is no parental account, no consent flow and no age gate.

### Transparency
- **4.1–4.3 Plain language, prominent policies, no dark patterns, and a single clear
  statement of who the user is.** Met, with a caveat. The 26 documents are plain-language and
  linked from a footer and an in-app library. The PromoPopup countdown that suppressed
  "No thanks" was removed on 2026-10-02. **Caveat:** the legal pages are currently served as
  `text/plain` by the edge gateway, so the transparency promise is not actually delivered to
  a reader.

### Preventing harm from users to each other
- **5.1 Risks from other users identified and mitigated.** **Not met in full.** Report and
  block exist and are enforced in the database; reporting was live only from 2026-10-02 and
  there is **no staffed moderation function**. Document 38 says so.
- **5.2 Interference with the service, e.g. spam, is prevented.** Partly. Rate limits and
  closed enums exist server-side.

### Privacy
- **6.1 The minimum data for the service to work, and no more.** Partly. Unused Health
  Connect permissions were removed; `privacy_settings` is minimal. But 104 public tables exist
  and no retention schedule has ever been enforced (document 30).
- **6.2 Users are told what data is used for.** Met.
- **6.3 Users have age-appropriate control over their data.** **Not met.** The privacy screen
  is the adult screen, and — importantly — **there is no account-level profile visibility
  setting at all.** `group_visibility` is group-scoped only.
- **6.4 Geolocation is used carefully.** Met. Wearable GPS is opt-in, per-provider and
  deletable.

### Fair and meaningful use
- **7.1 Rankings and leaderboards are fair and use only necessary data.** Partly. Fairness
  checking is described in `competition-terms.html` but there is no automatic detection of
  the manipulation it claims to catch. Leaderboards are opt-in and can be left at any time.

### Meeting users' needs
- **8.1 Children aren't asked to provide data they don't have.** Met in spirit. Age band
  rather than exact date is used for most caps.

## 3. Proportionality conclusion

The service is likely to be accessed by children. The DPIA exists and the most severe
mitigations — no advertising, no nutrition for minors, no purchases, private by default,
block filtering server-side — are real and enforced in the database rather than only in the
interface.

**The assessment does not conclude that the service meets the Code.** It concludes that a
substantial subset of standards is not met (notably 2.1, 2.3, 2.4, 3.1–3.4, 5.1 and 6.3),
that the legal pages are currently unreadable in production, and that there is no parental
control layer at all.

## 4. What cannot be concluded

1. **Whether any residual risk is acceptable.** That is a judgement for the operator, and it
   has not been made or recorded.
2. **Whether the under-18 protections apply to real users.** They do not: **0 of 11** live
   accounts have a date of birth, so the database trigger that enforces the privacy default
   for minors cannot fire for anyone. See document 35.
3. **Whether this is the required assessment.** It is a draft produced by an agent from the
   code and the live schema. It has not been reviewed by a person, and it is incomplete.

## 5. Publication decision — deliberately unmade

The Code expects publication. It is not published because:

- it is incomplete, and an incomplete published assessment is worse than a late one;
- standards 2.1–2.4 and 3.1–3.4 require product decisions (an age gate, parental accounts),
  not just documentation;
- publishing it now would put a list of unmet standards in front of regulators and users
  while the corresponding fixes are still queued.

**Once the age gate, parental controls and static hosting exist, this document should be
completed, reviewed by a person, and published.** That is the intended end state, and it is
recorded here so the delay is a recorded decision rather than an omission.