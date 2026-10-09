# 28 — Data Protection Impact Assessment

**Drafted 2026-10-02. Internal. Owner: unassigned. Review due: before any new high-risk processing.**

> This is a working assessment, not a certified DPIA, and not legal advice. It does not
> establish that any obligation has been met. Where it says a gap exists, the gap is real.

## 1. Scope

Vaylo Sports: a training log for athletes aged 13 and over, delivered as an Android app
(offline-capable, native WebView) backed by Supabase (Postgres, Auth, Edge Functions) and a
static marketing/legal website.

In scope: athlete training logs, derived health metrics, injury and mental check-ins,
nutrition data, wearable imports, social features (feed, communities, challenges, leaderboards),
purchases, and the AI features.

Out of scope: the marketing website (no accounts, no analytics, no cookies beyond what is
disclosed), and employment processing (there is none).

## 2. Processing, and why it is high-risk

Under GDPR Article 35 a DPIA is required where processing is "likely to result in a high
risk to the rights and freedoms of natural persons". Three of the categories here meet the
Article 9 test for special category data:

| Processing | Special category? | Why it is high risk |
|---|---|---|
| Training load, recovery, readiness | **Yes** — health data | Inferred from lifestyle, enables inferences about physical condition |
| Injury logs | **Yes** — health data | Explicit health data, freely given by a possibly minor |
| Mental check-ins (mood, sleep, stress) | **Yes** — health data | Freely given disclosures with no clinical safeguard |
| Nutrition plans | **Yes** — health data | Dietary data; blocked entirely for under-18s, which is itself a risk decision |
| Wearable imports (heart rate, sleep, GPS) | **Yes** — health data | Continuous passive collection from a third party device |
| Social features | No | Ordinary social data, but see the child-safety risk in document 39 |
| AI features | Indirectly | Derived health data passed to a third-party model provider |

**Volume and sensitivity, verified 2026-10-02 against the live database:** 104 public
tables, 27 `auth` tables, 189 RLS policies, 12 linked auth identities, **11 accounts
total**. The user base is currently small, but sensitivity does not scale down with volume,
and the design must hold at scale.

## 3. Lawful basis

The app relies on **contract** (UK GDPR Art. 6(1)(b)) for providing the service the athlete
signed up for, and on **consent** (Art. 6(1)(a)) for optional processing such as wearable
connections and AI features.

The consent columns now exist: `profiles.terms_accepted_at`, `profiles.terms_version` and
`profiles.health_consent_at`, added by migration `20261001120000` and deployed 2026-10-02.
**Verified deployed.** `health_consent_at` is `NULL` for every existing account, which the
Privacy Policy treats as "not yet recorded — the app must prompt, not assume".

**Not yet done:** there is no consent *withdrawal* mechanism recorded in the schema beyond
disconnecting the wearable, and no record of which policy version an athlete accepted beyond
a free-text `terms_version` string.

## 4. Necessity and proportionality

Data minimisation is genuinely applied in places: the app declares only `INTERNET`
permission; six unused Health Connect permissions were removed on 2026-10-02; injuries,
mental check-ins and video clips are private by default and excluded from public profiles;
and a young athlete is excluded from sponsor reporting entirely.

**Proportionality concerns that remain open:**

- Mental check-ins are collected with **no escalation path**. Nothing watches them, and
  nothing happens if an athlete writes that they are unsafe. This is disclosed publicly in
  `mental-wellbeing.html`, which is the honest handling, but it is a known risk with no
  mitigation. See document 39.
- Date of birth gates every under-18 protection and is **unverified**. See document 35.
- `is_child_safety` on the support inbox is not derived by the database, so a crafted
  request could demote a child-safety report out of the urgent queue. Recorded as an open
  finding in [docs/MOBILE-APK-AUDIT.md](../../MOBILE-APK-AUDIT.md).

## 5. Risks and mitigations

| # | Risk | Likelihood | Impact | Mitigation | Verified? |
|---|---|---|---|---|---|
| R1 | A breach exposes training/health data | Medium | High | RLS on all public tables; `authenticated` cannot read `support_requests`; 189 policies; no `anon` access to the sensitive tables | Yes |
| R2 | A reporter is identified from `content_reports` | Low | High | RLS allows a reporter to read only their own rows; `anon` revoked; no client update/delete grant so status cannot be self-set | Yes, by test |
| R3 | Feed leaks blocked athletes' rows to the device | Low | Medium | `feed_visible_activities` view with `security_invoker`, so rows are excluded server-side in both block directions | Yes |
| R4 | Under-18 protections do not activate | **High** | High | None available. 0 of 11 accounts have a date of birth, so the trigger cannot fire. Needs an age-collection prompt | No — open |
| R5 | A child-safety support request is de-prioritised | Low | High | `is_child_safety` defaults false and is not derived; the edge function that would derive it is not deployed | No — open |
| R6 | AI training data reaches a third-party model provider | Low | High | Features are not enabled in production, so nothing is sent; and they fail closed | Yes, currently |
| R7 | Model provider retains or trains on prompts | Unknown | High | **Cannot be answered.** No provider is deployed, and no contractual or configuration review has been done. Stated as unverifiable in `ai-data-use.html` | No — open |
| R8 | Published policies are unreachable in a readable form | **Certain** | Medium | The edge gateway rewrites `text/html` to `text/plain`; 26 legal documents are affected. Fix is static hosting | No — open |
| R9 | A support inbox is read by the wrong person | Low | High | `support_requests` denies `select`/`insert`/`update`/`delete` to `anon` and `authenticated`; only `service_role` writes | Yes |

## 6. Consultation and sign-off

- **Data subject consultation:** not carried out. No user research informed this document.
- **DPO consultation:** not possible — no DPO is appointed (see document 37).
- **Information security consultation:** informal only; there is no named security owner.
- **Sign-off:** none. This document has no approver and should not be treated as signed off.

## 7. What this assessment cannot yet conclude

1. Whether the processing is lawful in every jurisdiction a user might be in. The operator's
   legal identity is not published, so even the applicable jurisdiction is unstated.
2. Whether R7 is mitigated. It cannot be answered while no provider is deployed, and it must
   be re-answered before any AI feature is enabled for anyone.
3. Whether the breach-notification readiness in document 31 is adequate — it is a plan on
   paper with no tested path.
4. Whether the under-18 position holds at scale. It currently does not hold at all (R4).

## 8. Actions arising

| Action | Blocks what | Owner |
|---|---|---|
| Prompt for and store date of birth | R4, document 35 | unassigned |
| Derive `is_child_safety` in the database | R5 | unassigned |
| Complete the AI provider review before enabling AI | R6, R7, document 34 | unassigned |
| Publish the website statically | R8, Play listing | unassigned |
| Appoint a DPO or record a decision not to | document 37 | operator |
| Re-check this assessment after the above | — | unassigned |