# Legal & compliance: what we still need from you

**Compiled 2026-10-02.** Every item below is something I could not determine from the code,
the database or the deployed functions. Nothing here is invented, and nothing has been
guessed at in a published document.

Ordered by how much it blocks. Items 1–3 are blocking.

---

## 1. Operator identity — blocking

`legal/operator.json` currently contains **only** `operatorName` and `contactEmail`. The Terms
and Privacy Policy both publish that the following are missing, which is honest, but it is an
open gap.

| Field | Why it is needed | Where it surfaces |
|---|---|---|
| Registered company name | Naming the controller is a basic requirement in a consumer contract | `legal/terms.html`, `legal/privacy.html` |
| Company registration number | Same | Terms, Privacy |
| Registered address | Same | Terms, Privacy |
| ICO registration number | The Privacy Policy references the ICO and says the number is not yet published | `legal/privacy.html`, `legal/complaints.html` |
| Country of establishment | Determines the governing law, the regulator, and the transfer regime | Terms, Complaints, docs 37 |
| Data Protection Officer | Whether one is required at all depends on scale and establishment | doc 37 |

**Note:** the Terms currently state the contract is governed by "the laws of the country in
which Vaylo Sports is established" — a clause that reads as evasive precisely because that
country is not published.

## 2. Transactional email — blocking for the safety routes

**No email provider is configured.** The complaint procedure, the child-safety route, the
security disclosure route and all account-deletion requests are published as email addresses.

Those routes are only as good as the delivery and monitoring behind them. Until a provider is
configured and delivery to that inbox is verified, a child-safety email may simply not arrive.

**Decision needed:** which provider, and who owns the inbox.

## 3. Deploy or remove the web forms — blocking

The website has child-safety, safety, privacy, purchase and deletion report forms. The
`support-request` edge function is **not deployed**, so those forms submit nowhere and
`support_requests` is empty.

The project's own migration comment states the principle: a form that submits nowhere tells a
person their report was received when it was not, and for a child-safety report that is serious
harm.

**Two valid options — please pick one:**
- **(a)** Deploy the function. Recommended: the table, validation and rate limiting all exist.
- **(b)** Remove the forms from the website until it is deployed.

Leaving them live is the only option already identified as unacceptable.

## 4. Retention periods

Document 30 proposes specific periods. They are **proposals, not decisions**, and they are not
published anywhere.

| Category | Proposed | Your decision |
|---|---|---|
| `content_reports` | 3 years | |
| `support_requests` (ordinary) | 3 years | |
| `support_requests` where child safety | Indefinite | |
| `support_requests.ip_hash` | 90 days | |
| Moderation actions | Account life + 1 year | |

## 5. Complaint and support response times

`complaints.html` publishes **aims** of five working days to acknowledge and twenty to respond
substantively. These are not commitments and should be confirmed or changed before launch.

**Also needed:** who owns complaints, and whether an external ombudsman is wanted (none is
offered currently).

## 6. Wearable / health platform providers

`wearable-health-privacy.html` is published and describes wearable data accurately — but **no
provider is named anywhere**, because none has been chosen.

**Needed:** which platforms are supported. Once known, the published notice should name them,
rather than describing a category that nothing implements.

## 7. AI provider, if AI features are to be enabled

Nothing is sent today because nothing is deployed. Before enabling:

| Question | Why |
|---|---|
| Which provider | No provider has been selected or reviewed |
| Are prompts used for training | The published policy deliberately refuses to claim otherwise, because it cannot be evidenced |
| Prompt and response retention | Unrecorded |
| Data residency | Unrecorded |
| Contractual basis for transferring health data | Unrecorded |

## 8. Site hosting decision

The website is generated and valid but **published nowhere** — no hosting config exists in the
repository. This also blocks the fix for the content-type problem: the edge gateway serves legal
pages as `text/plain`, so the privacy policy and data-deletion URLs that Google Play reviews
are currently unreadable raw HTML.

**Decision needed:** a host. `VITE_LEGAL_BASE_URL` already supports repointing at it with no
code change.

## 9. Product decisions, not legal facts

These need your call rather than information:

| Decision | Current position |
|---|---|
| Do minors keep `allow_friend_requests` and `allow_community_posting` on? | Both default to `true`. Deliberate, because forcing them off would break friending for 13–17s |
| Add an age gate and parental controls? | Not implemented. Required by several Children's Code standards |
| Staff the moderation queue? | Nobody reads reports. This is the largest operational gap |
| Build an account-level profile visibility setting? | Five published statements describe one; only group visibility exists |
| Should AI features be available to under-18s at all? | Undecided |

---

## Corrections to earlier records

Two things stated in earlier notes were wrong and are corrected here:

1. **`profiles.is_private` is not a column.** The migration `20261001120000` does not add it, and
   nothing in `src/` or `supabase/` references it. There is no outstanding grant failing on it.
2. **The migration does add a real account-level control** — but for **group visibility and
   avatar display**, not for whole-profile visibility. The distinction matters because five
   published statements describe the latter.

## Where each item is recorded in detail

| Item | Document |
|---|---|
| Operator identity, GDPR position | [internal-compliance/37-gdpr-compliance-record.md](internal-compliance/37-gdpr-compliance-record.md) |
| Retention | [internal-compliance/30-data-retention.md](internal-compliance/30-data-retention.md) |
| Rights requests | [internal-compliance/32-data-subject-rights.md](internal-compliance/32-data-subject-rights.md) |
| Processors | [internal-compliance/33-processor-register.md](internal-compliance/33-processor-register.md) |
| Age assurance | [internal-compliance/35-age-assurance.md](internal-compliance/35-age-assurance.md) |
| Moderation | [internal-compliance/38-content-moderation.md](internal-compliance/38-content-moderation.md) |
| Child safety | [internal-compliance/39-child-safety-risk-assessment.md](internal-compliance/39-child-safety-risk-assessment.md) |
| AI provider | [internal-compliance/34-ai-data-processing.md](internal-compliance/34-ai-data-processing.md) |
| AI safety | [internal-compliance/40-ai-safety-risk-management.md](internal-compliance/40-ai-safety-risk-management.md) |