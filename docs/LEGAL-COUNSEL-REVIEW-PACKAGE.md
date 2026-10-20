# Legal Counsel Review Package & Play Console Requirements Checklist

**Prepared 20 October 2026 (Prompt 08). Purpose: everything counsel needs to review, and everything the Play Console submission needs, in one file. No legal decisions were made here — open items are marked QUESTIONS FOR COUNSEL with a risk note.**

Also related and referenced throughout:
- [LEGAL-PLACEHOLDERS-RETENTION-CHECKLIST.md](LEGAL-PLACEHOLDERS-RETENTION-CHECKLIST.md) — operator particulars & retention decisions (Prompts 03/04)
- [LEGAL-MISSING-FACTS.md](LEGAL-MISSING-FACTS.md) — the fact register this package consolidates
- [internal-compliance/33-processor-register.md](internal-compliance/33-processor-register.md) — vendor register
- [PAYMENT-SANDBOX-TEST-PLAN.md](PAYMENT-SANDBOX-TEST-PLAN.md) — payment readiness (out of counsel scope, referenced)

---

## 1. Legal document inventory (all 27 published documents)

All documents are token-resolved and published (privacy v1.7, data-rights v1.3, child-safety v1.4 were completed in Prompts 03–04). `legal/operator.json` contains real values (`Vaylo Sports`, `vaylosportssupport@gmail.com`) and no `REPLACE_ME` placeholders remain — a failing build would refuse to publish if they were.

| Document | Version | Status for counsel |
|---|---|---|
| terms | 1.6 | **Review:** governing-law clause names "the country in which Vaylo Sports is established" — reads evasive while particulars are unpublished (see Q-1) |
| privacy | 1.7 | **Review:** retention windows and purge cite; AI-retention deliberately unclaimed |
| child-safety | 1.4 | **Review:** prior "not yet finalised" items completed except named lead, age assurance, ICO annual report |
| cookies | 1.1 | Self-contained (no third-party cookies). Low |
| ai-disclaimer | 1.2 | **Review:** with the AI-provider DPA questions (§5) |
| health-safety | 1.2 | Reviewed; consistent with age caps |
| community-guidelines | 1.0 | Consistent with moderation code (tested) |
| competition-terms | 1.1 | Review lightly |
| purchases | 1.5 | **Review:** closed-testing "Free" labels; refund posture for under-18 purchases |
| refunds | 1.3 | **Review:** under-18 unconditional refund promise is a policy choice counsel should confirm |
| account-deletion | 1.1 | Consistent with cloud deletion implementation (Prompt 02) |
| data-rights | 1.3 | Honest gap: ICO number not published (still accurate — see Q-4) |
| report-safety-concern | 1.0 | Route doc; depends on monitored inbox (Q-7) |
| report-content | 1.0 | Route doc; same dependency |
| security-disclosure | 1.0 | Low |
| complaints | 1.0 | SLA is "aims" (5 working days ack / 20 substantive) — counsel to confirm (Q-6) |
| ai-training-advice | 1.1 | With AI review |
| video-analysis-disclaimer | 1.1 | Low |
| injury-guidance | 1.1 | Low |
| nutrition-disclaimer | 1.1 | Age-restricted feature (18+), consistent |
| mental-wellbeing | 1.1 | **Review:** crisis-route copy and the deliberate absence of published response numbers |
| wearable-health-privacy | 1.0 | ** inaccurate-risk:** no provider named anywhere yet (see Q-9) |
| ai-data-use | 1.1 | **Review:** deliberately refuses to claim no-training — confirms with provider DPA (Q-10) |
| advertising | 1.2 | Sponsored content 18+; aggregate-only reporting — consistent with database rules |
| intellectual-property | 1.0 | Low |
| waitlist-terms | 1.2 | Low |
| contact | 1.1 | Low |

## 2. Counsel review package — per issue

### 2.1 MDF-003 — Operator particulars (blocking)
- **Current text:** `operator.json` = `Vaylo Sports` + `vaylosportssupport@gmail.com`; privacy/data-rights honestly disclose the ICO number and registered address are not yet published.
- **Recommended approach:** obtain registered company name+number, registered office, country of establishment, ICO registration; update `operator.json` once and regenerate (one build step republishes all 27 documents).
- **QUESTIONS FOR COUNSEL:** (1) Is a consumer-facing Gmail an acceptable contact for the controller, or should we provision a company-domain mailbox first? (2) Does country of establishment change any published statement already made (governing law, regulator, transfer regime)? (3) Is a DPO (internal or outsourced) required at launch scale?
- **Risk if unanswered:** HIGH — naming a controller is baseline consumer-contract and ICO registration substance; Play review also cross-checks the privacy-policy contact.

### 2.2 MDF-004 — Retention windows (decided, needs ratification)
- **Published:** server logs 30 days rolling; unsaved form analyses + AI usage records 30 days via the daily `delete_expired_video_analyses` purge; purchase records ≤6 years; support correspondence 24 months post-closure; child-safety case notes 24 months with safeguarding/legal exceptions.
- **Internal register tension to resolve:** `internal-compliance/30-data-retention.md` *proposes* 3 years for `content_reports`, 3 years for ordinary support requests, **indefinite** for child-safety support requests, and 90 days for `ip_hash`. The published policy says 24 months. One of the two needs to win — publishing wider than internal practice is the risk.
- **QUESTIONS FOR COUNSEL:** (1) Is `indefinite` retention for child-safety correspondence defensible as a safeguarding override, and should the published policy say so explicitly? (2) Confirm 24 months correspondence is lawful/best practice (or lengthen the internal register). (3) Does the six-year purchase-record window match the actual tax/accounting duty in the establishment country?
- **Risk if unanswered:** MEDIUM — an enforcement mismatch between published numbers and actual operator practice is precisely what regulators sample for.

### 2.3 MDF-005 — Child safety (mostly completed; three open)
- **Completed and published (v1.4):** same-day read, 5-working-day acknowledgement / 20-day substantive SLA, evidence-first takedown, IWF/999/NSPCC routes, 24-month case-note retention, guardian-link arrangement retained.
- **Open (decisions, not drafting):** named child protection lead; age assurance (self-declared DOB stands); ICO annual reporting threshold assessment.
- **New facts counsel should know:** the age-cap triggers exist and are DB-enforced, but **0 of 11 current accounts have a date of birth**, so the caps cannot fire without the athlete entering it (internal-compliance doc 39, CS-5). Nothing prompts for one today.
- **QUESTIONS FOR COUNSEL:** (1) Should we prompt/require DOB at signup to make the enforced controls real, given the Children's Code exposure? (2) Is the self-declared-DOB posture defensible for an 18-to-30-targeted app, or does counsel want age estimation? (3) Designating a safeguarding lead: internal, outsourced, or not-now?
- **Risk if unanswered:** HIGH for (1) — the entire under-18 control stack is dormant without the DOB field.

### 2.4 Complaint/response SLA
- **Current:** "aims" to acknowledge within five working days and respond substantively within twenty; child-safety has the firmer same-day/5-day commitment.
- **QUESTIONS FOR COUNSEL:** who owns complaints (role, not name needs deciding); whether an independent ombudsman should be offered; whether "aims" is acceptable or should become binding commitment.
- **Risk:** LOW-MEDIUM.

### 2.5 Wearables
- **Current:** published notice describes categories accurately but names no provider; no wearable connection is live yet.
- **QUESTIONS FOR COUNSEL:** name providers once chosen; confirm the current notice's delete-on-disconnect claim stays true for every provider added; contractual basis for reading provider data (OAuth scope + user consent is the intended basis).
- **Risk:** LOW now, HIGH if features ship under the generic notice.

### 2.6 AI provider (not deployed yet)
- **Current:** functions return per-key failures with no provider configured; published policy correctly refuses to claim no-training or zero-retention.
- **QUESTIONS FOR COUNSEL:** which provider; their training-use return for API traffic; retention; residency; whether a provider DPA covers health-adjacent data (training, heart-rate, sleep); whether an under-18 block on every AI feature should be policy.
- **Risk:** MEDIUM until any AI feature is enabled with real data.

### 2.7 Governing law / terms
- **Current:** governed by "the laws of the country in which Vaylo Sports is established" — honest but evasive until particulars exist.
- **QUESTION FOR COUNSEL:** replace with the establishment country once 2.1 resolves; confirm consumer-out of court rights and unfair-terms screening for the published Terms.
- **Risk:** MEDIUM.

## 3. Play Console submission checklist

### 3.1 URLs (Play reviews by URL)
- [ ] Privacy policy URL serving `text/html` at `/legal/privacy/` (Netlify-hosted; the edge/Storage `text/plain` defect was fixed in build 1.2.7 lineage — re-verify live before submission)
- [ ] Data-deletion URL (account-deletion document) reachable and describing the in-app deletion flow
- [ ] Both URLs visible in Play Console → App content

### 3.2 Data safety form (map from actual collection, not defaults)

| Category | Collected? | Notes from the repo |
|---|---|---|
| Personal info (name, email, user IDs) | Yes | profiles; OAuth identities (Google/Discord/Facebook/passkey) |
| Health & fitness | Yes | Health Connect 6 read permissions + wearable sync; declared `health` category + Play **Health Connect declaration** required before review |
| Financial info (purchase history) | Yes | user_purchases, transaction references only — no card data anywhere |
| Messages/social | Yes | friends/messages exist (friend-only, store-enforced) |
| Photos/videos | Yes | calorie scan, form/video analysis via processors |
| App activity / crash logs | First-party only | `app_error_reports` via own function — **no third-party analytics/crash SDK installed** (state "no SDK" rather than checking one) |
| Location | **No** | GPS tracking removed; no location permission in manifest |
| Advertising ID | **No** | no ad identifier; sponsor reporting is aggregate-only and 18+ |

For each "collected" row: purposes = core function, AI processing (processors), personalisation; links to policy sections; confirm deletion ("in-app account deletion + purge") and retention statements match the published numbers.

### 3.3 Permissions justification (from the manifest)

| Permission | Justification to state |
|---|---|
| 6 × `android.permission.health.READ_*` | Core product: workouts/distance/calories/heart-rate/steps/sleep; runtime consent via Health Connect sheet; read-only (build script fails release on any write permission); Play Health Connect declaration must list all six |
| `INTERNET` | All network (Supabase, edge functions, OAuth browsers) |
| `POST_NOTIFICATIONS` | Requested at runtime only when a notification category is turned on (never at first launch — policy-friendly) |
| Health Connect `<queries>` + rationale alias + `ViewPermissionUsageActivity` | Required declarations; keep privacy-policy link live (Android 14 usage entry) |

### 3.4 Other console items
- [ ] Target audience/age rating: content rating questionnaire ("Sports" app, no user-generated-chat-with-strangers by default beyond friend messaging — answer the friend-messaging question honestly; UGC exists via feed profiles — check "user-created content" obligations)
- [ ] Children's/young-audience policy brief: app is 18–30 targeted but 13+ allowed (under-18 controls enforced in DB) — decide the audience declaration to match
- [ ] AI-generated content declaration: AI features produce coaching text/images/video analysis — Play's AI-content section may apply to major features; data safety for AI input/output is covered in 3.2
- [ ] Payments: IAP declaration — **do not enable** until the sandbox test plan passes (payments currently inert end-to-end)
- [ ] Data deletion:完整的 in-app deletion exists (implemented, tested at SQL level); ensure the console entry points to it, not a support-only route
- [ ] App signing: upload key rotation documented (Play App Signing on; incident runbook §6)

## 4. Vendor DPA / processor review (from processor register P1–P8)

| Vendor | Role | What to review with counsel | Status/unknowns |
|---|---|---|---|
| Supabase (P1) | Hosts everything (Postgres, Auth, functions, storage) | Terms + DPA coverage, region/data residency, subprocessor list + change-notification mechanism | **No contract reviewed. Residency unknown — first transfer assessment depends on it** |
| OpenAI (P3) | Intended AI provider (text) | DPA, API-terms training-use exclusion, retention, residency; health-adjacent data coverage | Not deployed; nothing to review contractually yet |
| Google (Gemini API / Play Billing) | Image/video analysis + payments | Gemini API data-use terms (esp. video), Play Billing terms, reported data-safety alignment | Deployed only as Play distribution so far |
| Stripe (P6) | Website card payments for coach/marketplace | Stripe DPA; verify refs-only storage (already true) |.Active for coach marketplace |
| Wearable providers (P5) | Data source, athlete-initiated | Each provider's terms + OAuth scopes once named | No provider chosen/named |
| Email delivery (P7) | **Not configured** | Choose, configure, verify delivery to the monitored inbox | Blocking: safety/security/complaints routes publish email addresses |
| Analytics/crash (P8) | Deliberately absent | None — keep absent or update the policy first if ever added | None installed (verified) |
| Coaches/marketplace counterparties | Contracting users | Terms cover orders/earnings; payout email collected but **payouts not wired** | Advisory only |

## 5. Questions for counsel (consolidated)

1. Controller particulars & establishment country (Q-1..Q-3 under 2.1) — **blocking**.
2. Is the published 24-month correspondence retention acceptable, and how do we resolve the internal 3-year/indefinite register proposals (2.2)?
3. Should child-safety case records be explicitly carved out as indefinite/safeguarding-retained in the published policy (2.2/2.3)?
4. ICO registration: number, timing, and whether the "not yet inserted" disclosure stays acceptable until then (data-rights v1.3) — **risk HIGH** if left past launch.
5. Should DOB be prompted/required at signup so the DB-enforced under-18 controls actually fire (2.3)?
6. Age assurance posture: self-declared DOB — defensible or add estimation (2.3)?
7. Named child protection lead: who, trained or not, by when (2.3)?
8. Complaints ownership and whether SLA "aims" (5d/20d) should be binding (2.4).
9. Wearables: name providers and confirm delete-on-disconnect stays true per added provider (2.5).
10. AI provider DPA before enabling any AI feature: training-use, retention, residency, health-adjacent coverage (2.6).
11. Governing-law clause update once particulars exist (2.7).
12. Refund posture: unconditional under-18 refund (published) — confirm as policy (refunds v1.3).
13. Mental-wellbeing crisis copy: confirm deliberate absence of published response numbers is the right stance (mental-wellbeing v1.1).
14. Whether the operator-as-accountable-owner interim stance for child safety (child-safety v1.4 §8) is acceptable to counsel or should be escalated to a named lead before launch.

## 6. Submission-blocking summary (what must be green before filing)

1. All five final-conversation blocking facts (operator particulars; email provider configured and verified; retention ratification; SLA confirmation; DOB/age posture) — sections 2.1–2.3.
2. Live privacy-policy and data-deletion URLs serving `text/html` (3.1).
3. Health Connect Play declaration covering all six read permissions (3.3).
4. Sandbox payment readiness (separate document) — payments stay off otherwise.
