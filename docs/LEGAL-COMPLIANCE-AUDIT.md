# Vaylo Sports — Legal, Privacy, Safety & Platform-Compliance Audit

**Date:** 1 October 2026
**Scope:** the actual shipped application — web app + Capacitor Android shell + Supabase backend.
**Method:** source inspection only. Every finding below was read out of the code, the migrations, the
edge functions and the published legal documents. Where something could not be determined from the
repository it is listed as **NEEDS INFORMATION** and has not been guessed at.

**This is a technical compliance assessment, not legal advice.** Several items need a qualified UK
solicitor; they are collected in §6.

---

## 1. What Vaylo Sports actually does

Verified from source, not assumed.

| Area | What exists | Evidence |
|---|---|---|
| **Accounts** | Email + password, Google, Discord, Facebook OAuth, passkeys. `profiles` auto-created on signup. | `src/pages/Auth.tsx`, `handle_new_user()` |
| **Profile data** | `full_name`, `date_of_birth`, `height_cm`, `weight_kg`, `sport`, `experience_level`, `goals[]`, country, currency, water goal | `profiles` table |
| **Training data** | workouts, `performance_metrics`, `vpr_snapshots`, `recovery_logs`, personal bests, goals, streaks, daily action logs | migrations |
| **Health data** | Recovery check-ins (sleep, soreness, readiness, mood), injury logging, height/weight/DOB. Health Connect + 8 wearable providers. | `HealthSync.tsx`, `src/lib/health/providers.ts` |
| **AI features** | Coach chat, training-plan generation, weekly review, video form analysis, nutrition plans, tactical plans, meal photo scan, learning recommendations | `supabase/functions/{coach-chat,generate-plan,ai-analyze,ai-service,weekly-review,video-form-analysis}` |
| **UGC** | `shared_activities` — free-text `note` kind (title ≤140 chars, detail ≤280), read by every authenticated user; `activity_hypes` reactions; friends; communities with posts; leaderboards | `activitySharing.ts`, `Feed.tsx`, `Communities.tsx` |
| **Moderation** | `user_blocks` table + `blocking.ts`, enforcing a friend-request block via trigger. **No reporting. No moderation queue. No admin moderation UI.** | `20260930093736_social_blocking.sql` |
| **Virtual currency** | Credits and Coins, earned and purchasable; Event Packs priced in credits; one-time credit unlocks (Mental Gym 39, Injury 29) | `creditEconomy.ts`, `Market.tsx` |
| **Payments** | `process-purchase` edge function; `STORE_BILLING_ENABLED = false`; `/subscription` toasts "Checkout coming soon" — **no live purchase path** | `src/lib/billing.ts`, `Subscription.tsx` |
| **Advertising** | Sponsored content on 4 placements, DB-gated to 18+, always labelled. **No ad SDK, no analytics SDK, no third-party trackers.** | `use-sponsored.ts`, `20260921090700_sponsored_age_gate.sql` |
| **Legal pages** | privacy, terms, account-deletion — published via the `legal` edge function, self-contained, no third-party resources, drift-guarded by a test | `legal/*.html`, `legalPages.test.ts` |

### What is genuinely strong

Credit where due — these are not cosmetic, and a lot of the P0 work is already done:

- **Age-gated advertising enforced in the database, not the client.** `brand_placements.min_age` has a
  `CHECK (min_age >= 18)`, and `sponsored_placements()` re-derives adult status server-side and
  returns an empty set for minors. A minor's device never even requests sponsored content.
- **Nutrition planning is hard-gated to 18+** in `Nutrition.tsx` with an explicit refusal message.
- **Account deletion is real.** An edge function enumerates every user-identifying column across the
  schema, deletes them, removes storage objects, deletes the auth identity, then **re-verifies and
  reports residual rows** rather than returning a false success. It is also reachable by email for
  people who no longer have the app, as Google Play requires.
- **Self-contained legal pages** with no third-party requests, drift-guarded by a test that
  regenerates and diffs.
- **Terms acceptance is a hard gate on sign-up**, not a link in a footer.
- **Feed privacy is architecturally sound**: private training tables are self-read-only under RLS, so
  publishing is opt-in per activity rather than an exposed friend graph.

---

## 2. Prioritised findings

P0 = must fix before launch. P1 = should fix before launch. P2 = shortly after. P3 = optional.

---

### P0-1 — No way to report abusive or unsafe content

**Risk.** Google Play's User-Generated Content policy requires an in-app mechanism to report content
that "may be viewed or shared by other users", plus a block function, plus a process for reviewing
reports and notifying users of action. Vaylo has UGC and has neither. Separately, OFCOM's Online
Safety Act duties and the ICO Children's Code standard 35 both expect a route to report harmful
content. Shipping without one is a listing rejection risk and a child-safety gap.

**Why it applies.** `shared_activities` accepts free text from any authenticated user, including a
13-year-old, readable by **every** authenticated user (`RLS: using (true)`), plus community posts
and friends. There is no report table, no report UI, and no moderation queue.

**Needs.** Database migration (new table + RLS), edge/DB function, client library, UI in Feed and on
public profiles, and an operational moderation process.

**Implementation.**
1. New `content_reports` table: `reporter_id`, `target_type` (`activity|profile|message|community`),
   `target_id`, `reason` (closed enum), `details`, `status` (`open|reviewed|actioned|dismissed`),
   timestamps. Reporter can see their own reports; **only an admin/moderator role can read the full
   set**. RLS enabled, no anon access.
2. A `report_content(...)` RPC that validates the reason enum, rate-limits per reporter, and records
   the report. Self-report spam blocked.
3. `Report` / `Block` actions on every feed item and public profile, with a reason sheet.
4. An operator must read and action reports within a stated window. **NEEDS INFORMATION: who staffs
   moderation, and what the response-time commitment is.** This cannot be solved in code.

---

### P0-2 — Blocking exists in the database but is not reachable by any athlete

**Risk.** A safety control that exists only as SQL is not a safety control. An athlete being
harassed has no in-app way to remove the harasser from their view, and no way to discover they have
been blocked.

**Why it applies.** `user_blocks` and `blocking.ts` are complete and correctly RLS-scoped, and the
friend-request trigger is airtight — but **no `.tsx` file references them.** Confirmed by grep: the
only hits are the library itself, generated types and a DB test. Blocking also does **not** filter
the feed, the leaderboard or community surfaces, so a blocked athlete's shared activities still
appear.

**Needs.** Client wiring, UI, and a query change.

**Implementation.**
1. `Block` / `Unblock` on the public profile and on feed items authored by others.
2. `fetchBlockedUsers()` is already written — surface it in a Manage blocked list.
3. Filter blocked authors out of `fetchSharedFeed` **server-side** (a DB view or an `.or()` filter),
   not client-side, so the data never reaches the device.
4. Blocked athletes are removed from the leaderboard and community member lists the blocker can see.

---

### P0-3 — Privacy defaults are public, not private

**Risk.** ICO Age Appropriate Design Code, **standard 12 (data minimisation)** and the default-privacy
expectation in **standard 11 (data sharing)**: if a service is likely to be accessed by children, the
default must be the most private setting. Vaylo's Terms set a minimum age of 13 and the app is
designed for ages 13–17, so it is in scope.

**Why it applies.** `privacy text not null default 'public'` and `show_avatar_publicly boolean not
null default true`. A 14-year-old's profile, date of birth, sport and avatar are public by default on
day one. DOB is optional, so a user who skips it gets a *public* profile with no age gate on anything
except ads.

**Needs.** Database migration (defaults + trigger), client copy.

**Implementation.**
1. Change the defaults to `'private'` and `false`.
2. Add a trigger: when a profile's `date_of_birth` indicates the athlete is under 18, force
   `privacy='private'` and `show_avatar_publicly=false`.
3. A visible, non-nagging notice in Onboarding explaining the default and how to change it.
4. Existing adult users are **not** retroactively privatised — a migration that silently hides
   established profiles is a product decision, flagged in §5.

---

### P0-4 — No data portability (Article 20 UK GDPR)

**Risk.** Art. 20 gives individuals the right to receive their personal data in a structured, commonly
used, machine-readable format. Vaylo cannot currently honour it, and cannot evidence honouring it.
This is one of the rights most likely to be tested by a complaint.

**Why it applies.** Roughly 90 tables hold user rows. There is no export path of any kind — the only
occurrence of "export" in the app is unrelated AI helpers.

**Needs.** Edge function, client, UI, policy wording.

**Implementation.** A new `export-my-data` edge function that reuses the **exact** `USER_TABLES`
enumeration already proven in `delete-account/index.ts`, returns JSON built with the service role
after verifying the caller's JWT, and streams it as a download. The app gets a "Download my data"
control that reports exactly what is included rather than claiming completeness it cannot prove.

---

### P0-5 — No consolidated Legal & Safety centre in the app

**Risk.** Every right and safety notice is one tap from nothing. Google Play expects the privacy
policy to be reachable in-app; the Children's Code expects safety information to be prominent and
appropriately pitched. Right now links exist only on the sign-up screen and buried in Profile
settings, and there is no route to reporting, community rules, or AI limitations at all.

**Needs.** New pages, routes, nav entries.

**Implementation.** A `/legal` Legal & Safety Centre and a `/safety` Safety Information page — both
built from facts already true in the codebase, with no invented company details, and with every
unknown marked as unknown rather than filled in.

---

### P0-6 — Sponsored content and credits are shown to minors

**Risk.** Children's Code standard 37 (nudging) and PECR/ASA rules: promotional content must not be
nudged to children. The DB gates *brand placements* to 18+, but the **Market screen** — which sells
credit packs, shows a "double credits" offer, and lists Event Packs priced in credits — is **not**
age-gated. Credits are spendable currency.

**Why it applies.** `Market.tsx` and `Subscription.tsx` render regardless of age. A minor without a
DOB (which is optional) is treated as "unknown", and unknown is only excluded from *sponsored
placements*, not from the shop.

**Needs.** Client gating, copy, policy wording.

**Implementation.** Gate the purchasing and promotional sections of Market to adults; keep the
*informational* parts (what credits cost, what unlocks them) visible to everyone so the economy is
never a mystery. State plainly that a purchase cannot be completed by a minor.

**NEEDS INFORMATION:** whether credits purchased by a minor should be refunded or forfeited, and the
refund policy for virtual currency. See §5 and §6.

---

### P0-7 — BE-37: entitlements can be granted for free by any signed-in caller

*(Carried forward from the security audit — it is also a consumer-law issue, not only a security one.)*

**Risk.** `manage-subscription.activate_legacy_disabled` grants 30 days of an elite subscription plus
credits and entitlements to any authenticated caller. That is a pricing and consumer-rights failure as
much as a security one: it creates paid entitlements without payment, undermines any subscription
offer, and would be indefensible in a consumer dispute.

**Needs.** Backend fix. **Not implemented here** — it is a live production change to a payments
function and is out of scope for this pass. It must be fixed before paid acquisition.

---

### P1-1 — No age/child-safety controls and no visible age state

**Risk.** The athlete cannot see what age-based treatment applies to them, cannot understand why
sponsorship is hidden, and cannot correct a wrong date of birth. Children's Code standard 12 and
Google Play's target-audience expectations both favour clarity here.

**Implementation.** A read-only "Your age and safety settings" panel showing the age band in use, what
it changes, and a link to correct DOB. **No new personal data is collected** — the age band is
derived from a DOB the app already asks for.

---

### P1-2 — AI limitations are not explained in-app

**Risk.** AI output about training, injury and nutrition is presented without in-app explanation of
what it can and cannot do. A user acting on a generated plan for a real injury is the highest-severity
safety scenario in this product. The Injury page has a disclaimer and Nutrition is 18+ gated, but
**Train, FormAnalysis, Coach, Tactics and VideoFormAnalysis have none**.

**Implementation.** A persistent, non-dismissible-once-per-session notice on each AI surface, linking
to a single AI Safety page stating: outputs are generated, can be wrong, are not medical advice, and
must not be used to diagnose or treat an injury. No new data collected.

---

### P1-3 — No community guidelines

**Risk.** UGC exists without stated rules, and the Terms reference "using the app fairly" without
enumerating acceptable behaviour. Play's UGC policy expects clear rules; the Children's Code expects
children to understand what is and is not acceptable online.

**Implementation.** Published Community Guidelines, linked from the report sheet, the feed and the
Terms.

---

### P1-4 — Moderation has no admin surface

**Risk.** Even with P0-1, reports go nowhere. `RequireAdmin` and three Admin pages exist for pricing,
rewards and event packs, but there is no moderation view.

**Implementation.** An admin-only reports list showing open reports, with dismiss / action. **NEEDS
INFORMATION: who the moderator is** and what action is available (remove content, suspend account,
ban). Removal tooling does not currently exist for `shared_activities`.

---

### P1-5 — Terms and Privacy do not describe reporting, portability or the safety surfaces

**Risk.** The policies describe the data model accurately but omit the new controls, so the app and
the policy would disagree.

**Implementation.** Add "Reporting and moderation" to the Terms, and "Your rights" portability/export
plus "Reporting abuse" to the Privacy Policy. Then regenerate `pages.generated.ts` — a test enforces
that the committed file matches `legal/*.html`.

---

### P1-6 — Health data needs an explicit consent record

**Risk.** Recovery check-ins, injury logs, height, weight and DOB are health data. The Privacy Policy
describes them well, and sponsored use is excluded, but there is **no recorded consent event** for
processing health data, and no timestamped record of Terms acceptance beyond the client-side checkbox.

**Why it applies.** The checkbox gates the UI, but nothing is persisted — so Vaylo cannot evidence
when or how an athlete agreed, and a data subject access request or complaint cannot be answered.

**Needs.** Migration + client write.

**Implementation.** Add `terms_accepted_at`, `terms_version` and `health_data_consent_at` to
`profiles`, written at sign-up and in Onboarding. **This records agreement to data the app already
holds — it does not collect any new personal data.**

---

### P2-1 — Free-text UGC has no content safeguards

Free-text notes accept 280 characters with no filtering. A blocklist is not a substitute for human
moderation and is not recommended as the primary control; it is a cheap first filter. Address with
P0-1's reporting plus P1-4's moderation, and consider a link/contact-sharing blocklist.

### P2-2 — PECR position should be documented

No analytics or ad SDKs are present, which is genuinely favourable. However Google/Facebook/Discord
OAuth and Health Connect on the **web** build may set cookies, and `public/health-rationale.html` is
served from the same origin. Confirm and document the PECR position (likely: strictly necessary
exemptions only, no consent banner required) rather than leaving it undetermined.

### P2-3 — IAP and virtual currency disclosures are not complete

Purchases are not live, so this is pre-launch work: Play requires IAP for digital goods (already
architectured via `STORE_BILLING_ENABLED`), and the Consumer Contracts (Information, Cancellation and
Additional Payments) Regulations 2013 require clear pre-contract information and a 14-day cancellation
right that is **switched off** once digital content has begun to be supplied. The Terms must state
how that works. Also disclose virtual currency has no monetary value and is non-refundable except
where the law requires.

### P2-4 — Google Play Data safety form mapping

Needs to be completed from the actual schema — collect `user_id`, `name`, `date_of_birth`,
`height_cm`, `weight_kg`, health/recovery data, photos/videos (form analysis), and purpose
"App functionality / Health". Deletion path is already satisfied.

### P2-5 — Retention periods are vague

"Server logs — a short, rolling window measured in days to weeks" is not a retention period. Either
state actual figures or state that none are set. **NEEDS INFORMATION.**

---

### P3-1 — Age verification

Playing fields and community features are 13+. Self-declared DOB is proportionate for this app; a
third-party age-verification service would collect more personal data than the legal problem
justifies, and the Children's Code discourages collecting more than necessary. Self-declaration plus
the P0-3 defaults is the better trade. Revisit only if community features grow.

### P3-2 — In-app AI feature switch

Let athletes turn off AI features. Note this is *not* a launch flag — AI is woven into Train, Coach,
Nutrition, Tactics and Form, and switching it off would gut the product. A user preference to opt out
of AI processing is a reasonable addition, but the server key is the real fix.

### P3-3 — IP: contributor and creator terms

The Terms cover user content. If the creator marketplace ships, it needs explicit coach IP and
liability terms, and the `creator_profiles` table is currently world-readable including `payout_email`
(BE-09 from the security audit).

---

## 3. Framework-by-framework summary

| Framework | Status | Blocking |
|---|---|---|
| UK GDPR | Arts 12–15 supported via the account-deletion page; **Art. 20 missing** | P0-4 |
| UK GDPR Art 9 | Health data described and ad-use excluded; **no explicit consent record** | P1-6 |
| UK GDPR Art 5(2) | Cannot evidence when an athlete agreed to anything | P1-6 |
| DPA 2018 | Equivalent UK requirements; no separate gap identified | — |
| ICO Children's Code | Age-gated ads ✔; **defaults not private**; no reporting; no age controls; no community rules | P0-1, P0-3, P1-1, P1-3 |
| Consumer Rights Act 2015 | Reasonable care / satisfactory quality / 14-day rejection; Terms cover service changes but not the 14-day digital-content position | P2-3 |
| CC(C)Rs 2013 | Pre-contract info + 14-day cancellation, switched off on digital supply | P2-3 |
| PECR | No trackers present — favourable; web OAuth cookie position undocumented | P2-2 |
| Google Play UGC policy | **Reporting, blocking and moderation all missing** | P0-1, P0-2, P1-4 |
| Google Play Data safety | Deletion ✔; form mapping outstanding | P2-4 |
| Google Play Families | Not targeted; keep target audience 13+ | — |
| AI / training safety | Injury ✔, Nutrition 18+ ✔; **Train, Coach, Form, Tactics, Video unprotected** | P1-2 |
| IP | User content covered; marketplace terms pending | P3-3 |

---

## 4. What was deliberately not done

- **No blanket disclaimers.** The Terms already contain a "not medical advice" section. Adding "we
  accept no responsibility for anything" would be unenforceable under s.3 CRA 2015 and s.65(2)
  CC(C)Rs 2013, and would weaken the Terms that already work.
- **No new personal data collected.** Every control added uses data the app already holds (DOB,
  existing records, an existing consent checkbox). The only new fields are timestamps recording
  agreement.
- **No age-verification vendor.** See P3-1.
- **No profanity filter as a primary control.** See P2-1.

## 5. Product decisions needed from the business

1. Do existing adult profiles get privatised by the P0-3 default change, or only new/minor accounts?
2. What happens to credits a minor already holds, and what is the refund position on virtual currency?
3. Who staffs moderation, and what is the response-time commitment?
4. Who is the named moderator, and what enforcement actions exist?
5. Actual server-log retention period.
6. A post-13 age gate for community features — or accept self-declaration only?

## 6. Requires a qualified UK solicitor

1. Whether the Terms adequately reflect the 14-day cancellation right and its digital-content
   switch-off under CC(C)Rs 2013, and the 14-day rejection right under CRA 2015.
2. Whether virtual currency terms are enforceable and adequately disclosed.
3. The lawful basis and consent wording for health data (Art. 9(2)(a) explicit consent vs Art. 6(1)(f)
   legitimate interests), and whether consent withdrawal must be as easy as giving it.
4. Whether processing a 13–17 age range triggers any additional Children's Code expectations
   beyond those implemented.
5. The OSR / Online Safety Act position if community features are opened up.
6. Review of the sponsorship disclosure wording against ASA/CAP guidance.
7. Whether the operator details in `legal/operator.json` satisfy the requirement to identify the
   data controller.

## 7. Missing operator information — must be supplied, not invented

The repository contains only `operatorName: "Vaylo Sports"` and a Gmail contact. The following are
**required** by the policies already published and are currently absent:

- Registered company name and company number, or the individual's full legal name
- Registered postal address (UK GDPR Art 13(1)(a))
- ICO registration number, or the data-protection registration exemption basis
- Named DPO, if one is required — do **not** appoint one purely to satisfy the box
- Whether a data protection representative is needed
- Insurance details, if any are to be claimed
