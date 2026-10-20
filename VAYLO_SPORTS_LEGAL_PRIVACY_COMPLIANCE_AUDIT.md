# VAYLO SPORTS - LEGAL, PRIVACY, COMPLIANCE & PLATFORM POLICY AUDIT REPORT

**Date:** 2026-10-20  
**Type:** Read-Only Audit (No modifications made)  
**Scope:** Legal documents, privacy, data protection, AI disclosures, age restrictions, monetisation compliance, Play Store requirements  
**Target:** Public launch readiness  
**Audience:** Adults 18-30 (stated), with protections for under-18s implemented

**Note:** This is a technical/compliance assessment, not a substitute for qualified legal advice. Many items require specialist review.

---

## 1. EXECUTIVE SUMMARY

Vaylo Sports has invested significantly in legal documentation and compliance-conscious design. The legal materials are unusually detailed and candid about limitations. However, there are several gaps and areas requiring legal review before public launch.

### Overall Assessment
- **Legal documentation**: GOOD - Comprehensive set of policies (Privacy, Terms, Purchases, Refunds, Child Safety, AI Disclaimer, Account Deletion, etc.). Well-written, transparent about limitations.
- **Age compliance**: MIXED - Stated intent 18-30, but explicitly **not a technical age gate**. DOB-based protections exist and are enforced server-side where critical. Relies on self-reported DOB with honest admission this is not age assurance.
- **Privacy/GDPR**: GOOD foundation - Clear disclosures, data minimization in places, deletion workflow exists, user rights documented. Needs review of lawful bases, retention periods, international transfers, DPA.
- **AI disclosures**: ADEQUATE - Discloses AI usage, providers (OpenAI, Google), what data sent. States limitations. Could be clearer about model training/retention by providers.
- **Monetisation compliance**: MIXED - Detailed purchase/refund terms exist. But payments currently disabled (STORE_BILLING_ENABLED=false). Play Billing implementation exists but not enabled. Needs review of consumer law compliance when enabled.
- **Play Store readiness**: NEEDS WORK - Many technical pieces in place, but Data Safety declarations, target audience, billing disclosures need verification in Play Console.

### Release-Blocking Issues (Preliminary)
1. **Legal entity/contact details** - Privacy policy uses tokens `%%OPERATOR_NAME%%` and `%%CONTACT_EMAIL%%` (must be resolved before publish)
2. **Server log retention** - Explicitly "not decided and not published" in privacy policy (needs decision)
3. **Payment enablement** - Critical bugs in process-purchase must be fixed before enabling real money (per monetisation audit)
4. **Play Billing compliance** - Must be properly configured and verified before Play Store release
5. **Age assurance strategy** - Current approach (no verification) may have implications; need legal review

---

## 2. LEGAL DOCUMENT INVENTORY

All documents found in `/legal/` and referenced in app:

| Document | Location | Status | Notes |
|----------|----------|--------|-------|
| **Privacy Policy** | legal/privacy.html (v1.6, 2026-10-20) | PRESENT | Comprehensive, mentions all providers, AI, health data, age protections, deletion |
| **Terms of Service** | legal/terms.html | PRESENT | Referenced; need full review |
| **Purchases/Credits/Virtual Currency** | legal/purchases.html | PRESENT | Details credits as virtual items, no cash value caveat |
| **Refunds & Cancellation** | legal/refunds.html | PRESENT | Referenced |
| **Child & Young Athlete Safety** | legal/child-safety.html | PRESENT | Detailed age restrictions, honest about limitations |
| **Account Deletion** | legal/account-deletion.html | PRESENT | Explains process |
| **AI Disclaimer** | legal/ai-disclaimer.html | PRESENT | Referenced |
| **AI Data Use** | legal/ai-data-use.html | PRESENT | Referenced |
| **Data Rights** | legal/data-rights.html | REFERENCED | In nav |
| **Cookies** | legal/cookies.html | REFERENCED | In nav |
| **Advertising/Tracking** | legal/advertising.html | REFERENCED | In nav |
| **Health & Safety Notice** | health-safety.html (referenced) | REFERENCED | In nav |
| **Community Guidelines** | community-guidelines.html | REFERENCED | In nav |
| **Contact/Support** | contact.html | REFERENCED | In nav |
| **Intellectual Property** | intellectual-property.html | REFERENCED | In nav |

All accessible via in-app Legal center (Legal.tsx). Links use relative paths to legal/*.html.

---

## 3. AGE, AUDIENCE & TARGETING

**Stated target:** 18-30 year olds, developing through competitive athletes. "Not a medical service."

**Implementation:**
- Privacy policy explicitly states: "It is not a technical age gate: we do not verify anyone's age, we do not check identity documents, and we do not block anyone by age"
- DOB is optional on profile; if provided and under 18, protections enforced server-side
- Age-based restrictions (section 7 of Privacy): no sponsored content, private profile only, no nutrition/diet features, training volume caps, no promotional nudges, guardian linking allowed, purchases refundable
- Enforced in DB/code (trigger mentioned for profile privacy)
- Terms say minimum age 13; don't knowingly collect from under-13
- Child Safety page has detailed protections

**Concerns:**
- **HIGH**: No age verification despite marketing to adults - may conflict with some app store policies or regional requirements
- **MEDIUM**: Relies on self-reported DOB which can be falsified
- **MEDIUM**: Age assurance not implemented; policy candidly admits this
- **LOW**: Inconsistent messaging if not careful

**Recommendation:** Legal review needed on age-gating strategy. Current approach is transparent but may not satisfy all jurisdictions.

---

## 4. PRIVACY & DATA PROTECTION (UK GDPR Focus)

### Data Collected (per Privacy Policy)
- Account: email, password (hashed), sport/level/goals/days, height/weight (optional), name/DOB/country (optional), passkey public key
- Training/activity, content/posts, purchases/balances, coaching data
- Health data via Health Connect or wearables (with consent)
- AI inputs (messages, context, images/videos)
- Technical logs, crash reports (redacted)
- Support correspondence
- Waiting list emails

### Legal Bases (stated)
- Contract performance (core functionality)
- Explicit consent (health data, wearables)
- Legitimate interests (security, abuse prevention)
- Legal obligations (purchases/tax)
- Consent (notifications, waiting list)

### Rights Provided
- Access, correction, deletion (in-app), portability (Profile > Legal & Safety > Download your data), withdraw consent, object/restrict, complain

### Gaps/Concerns
- **HIGH**: Server log retention period "not decided and not published" - must decide and publish
- **HIGH**: Operator details are tokens - must resolve before launch
- **MEDIUM**: AI provider retention not fully controllable; policy admits this honestly
- **MEDIUM**: Support correspondence retention not fixed
- **MEDIUM**: International transfers disclosed but need to verify SCCs/adequacy
- **MEDIUM**: Need to confirm controller/processor roles documented
- **LOW**: DPA needed if using processors

**Recommendation:** Resolve operator details, fix retention periods, conduct lawful basis assessment with legal counsel.

---

## 5. AI DISCLOSURES & SAFETY

**Disclosed:**
- All AI features listed with providers (OpenAI for text/coaching/plans/nutrition, Google Gemini for photos/videos)
- What data sent per feature
- States "not a medical service", AI can err
- Non-medical disclaimers mentioned
- Under-18 restrictions on nutrition AI features

**Concerns:**
- **MEDIUM**: Policy says "we have not set a zero-retention or no-training option on our requests" - transparent but concerning
- **MEDIUM**: Need to ensure AI outputs never presented as medical diagnosis
- **LOW**: Coach disclaimers exist in UI (coach-chat has system prompt saying "coaching aid, not a doctor, physiotherapist or dietitian")

**Assessment:** Disclosures are reasonable and honest. Need to verify no medical claims slip through.

---

## 6. MONETISATION & CONSUMER PROTECTION

**Documents present:** Purchases page, Refunds page

**Key points from policy:**
- Credits/coins are virtual items, no cash value
- "The disclaimer that the \"no cash value\" term may not be legally effective in some jurisdictions" mentioned in findings.md - honest
- Purchases not currently switched on (per findings) - STORE_BILLING_ENABLED=false
- Google Play handles Android payments, Stripe for web coach/marketplace
- Under-18 purchases refundable in full
- Price shown before purchase (when enabled)

**Concerns:**
- **CRITICAL**: Payment bugs in process-purchase (from monetisation audit) must be fixed before enabling
- **HIGH**: Need to ensure pricing matches backend, clear renewal terms if subscriptions enabled
- **MEDIUM**: Consumer law varies by jurisdiction (UK consumer rights, cooling off, etc.)
- **MEDIUM**: Virtual currency regulations evolving

**Assessment:** Good disclosures, but not ready to take payments until bugs fixed.

---

## 7. ACCOUNT DELETION & USER RIGHTS

**Implementation:**
- In-app deletion available (Profile > Delete account)
- Policy says "Deletion is immediate and complete" with verification
- Deletes profile, training, health data, content, messages, purchases, files
- Keeps deletion record (hashed) and support correspondence (separable)
- Data export available (Download your data)

**Assessment:** Well-implemented. Meets GDPR requirements.

---

## 8. THIRD-PARTY SHARING & TRACKING

**Providers:** Supabase, OpenAI, Google (Play/Gemini/Health Connect), Stripe, Gmail, wearable providers

**Tracking:** Privacy policy says "We do not run third-party advertising or cross-app tracking SDKs, and there is no advertising identifier in this app." Claims no cookies/tracking pixels mentioned.

**Assessment:** Appears minimal tracking. Need to verify no hidden SDKs.

---

## 9. GOOGLE PLAY RELEASE READINESS

**Technical pieces:**
- Android project exists (android/ folder)
- Permissions in AndroidManifest.xml
- Billing code scaffolded
- Privacy policy link exists in app
- Account deletion available (required by Google)
- Data safety needs to be declared

**Gaps:**
- **HIGH**: Data Safety section in Play Console must be completed accurately
- **HIGH**: Target audience declaration (18+ or mixed) - needs alignment with policy
- **HIGH**: Privacy policy URL must be publicly accessible with resolved operator details
- **MEDIUM**: Health data usage must be declared
- **MEDIUM**: AI features disclosure
- **MEDIUM**: In-app purchases declaration

**Assessment:** Significant work needed for Play Console declarations.

---

## 10. PRIORITISED REMEDIATION ROADMAP

### CRITICAL (Block Launch)
1. **LEG-001**: Resolve legal entity name and contact email (replace tokens in all legal docs)
2. **LEG-002**: Fix process-purchase payment bugs (from monetisation audit) before enabling payments
3. **LEG-003**: Decide and publish server log retention period
4. **LEG-004**: Complete Play Console Data Safety declarations accurately

### HIGH
5. **LEG-005**: Legal review of age-gating approach and compliance in target markets
6. **LEG-006**: Review DPA terms with Supabase/OpenAI/Google/Stripe
7. **LEG-007**: Verify international transfer safeguards
8. **LEG-008**: Finalize support correspondence retention policy
9. **LEG-009**: Review AI provider terms for training/retention

### MEDIUM
10. **LEG-010**: Ensure all legal links work in production
11. **LEG-011**: Review marketing claims for compliance
12. **LEG-012**: Consider age assurance if required by markets
13. **LEG-013**: Update legal docs when payments enabled

---

## CONCLUSION

Vaylo Sports demonstrates a mature approach to legal compliance with unusually transparent documentation. The age restrictions are thoughtfully implemented even without verification. However, several operational details need resolution (operator info, retention periods) and payment infrastructure has bugs blocking monetization. A qualified legal review is essential before public launch, particularly for data protection, age compliance, and consumer law.

**Audit Status:** COMPLETE  
**Recommendation:** Address critical items before launch; obtain legal counsel for high-priority items.
