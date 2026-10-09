# Internal legal & compliance documents

**Status: internal. Not published, not in the website footer, not served to users.**

These are working documents for Vaylo Sports. They were drafted on 2026-10-02.

## Why they are here rather than on the website

A breach-response procedure, an information-security policy and a processor register
describe internal posture. Publishing them tells an attacker what our detection and
response process looks like, and publishing a processor register that is only
partly complete is worse than not publishing one. They belong on an access-controlled
internal surface, not on a public static site next to the privacy policy.

**One exception, deliberately not taken yet:** `29-childrens-code-assessment.md`. If the
service is likely to be accessed by children, the UK Children's Code expects the data
protection impact assessment to be **published in full**. That assessment is therefore a
candidate for publication rather than staying internal. It is drafted as an internal
document because publishing it is a decision with consequences, and because the
assessment is incomplete — see its "what this assessment cannot yet conclude" section.
Publishing an incomplete assessment and calling it the required one would be worse than
the delay.

## What every document here does

Each one separates three things, because conflating them is how compliance documents
become fiction:

- **Verified** — checked against the live database, the deployed edge functions or the
  code in this repository, with the date it was checked.
- **Not yet done** — a real gap, named plainly rather than softened.
- **Cannot be completed here** — needs a decision or a fact only the operator has.

Nothing in this directory is a legal conclusion, a compliance certificate, or evidence
that any obligation has been met. None of it removes any right a user has.

## The index

| # | Document | Covers |
|---|---|---|
| 28 | [Data Protection Impact Assessment](28-dpia.md) | Processing, risks, safeguards for high-risk processing |
| 29 | [Children's Code / Age-Appropriate Design Assessment](29-childrens-code-assessment.md) | Likely access by children, proportionality, the 15 standards |
| 30 | [Data Retention Policy](30-data-retention.md) | How long each category of data is kept, and why |
| 31 | [Data Breach Response Policy](31-data-breach-response.md) | Detection, triage, notification, evidence |
| 32 | [Data Subject Rights Procedure](32-data-subject-rights.md) | How each right is actually exercised |
| 33 | [Third-Party Data Processor Register](33-processor-register.md) | Every sub-processor and what it is trusted with |
| 34 | [AI Data Processing & Risk Assessment](34-ai-data-processing.md) | What AI features send, and the risk of that |
| 35 | [Age Assurance / Age Verification Policy](35-age-assurance.md) | How age is established, and what it is not |
| 36 | [Information Security Policy](36-information-security.md) | Access control, secrets, the controls actually in place |
| 37 | [Data Protection / GDPR Compliance Record](37-gdpr-compliance-record.md) | Article-by-article position and known gaps |
| 38 | [User Content Moderation & Safety Procedure](38-content-moderation.md) | Reporting, blocking, enforcement, appeals |
| 39 | [Child Safety Risk Assessment](39-child-safety-risk-assessment.md) | Risks to under-18s specifically, and mitigations |
| 40 | [AI Safety & Risk Management Procedure](40-ai-safety-risk-management.md) | Failure modes of generated output, and mitigations |

## The three findings that cut across all of them

1. **The operator's legal identity is not published.** `legal/operator.json` carries
   only `operatorName` and `contactEmail`. There is no registered company name, number
   or address, no ICO registration number, no Data Protection Officer and no UK/EEA
   representative. The Terms and the Privacy Policy both disclose this rather than hide
   it, which is the correct handling, but it is an open gap across documents 29, 33 and 37.

2. **The published documents are served as plain text.** The Supabase edge gateway
   rewrites `Content-Type: text/html` to `text/plain` on every response, and adds
   `nosniff`. Every legal page a user or a Play reviewer opens is therefore unreadable
   raw HTML. This is recorded as L4 in [docs/MOBILE-APK-AUDIT.md](../../MOBILE-APK-AUDIT.md).
   It is a publishing problem, not a drafting one, and it is fixed by hosting
   `website/` statically rather than by rewriting anything here.

3. **Date of birth is unverified and mostly absent.** Of 11 production accounts, **0**
   have a date of birth recorded. The under-18 protections in the database are real but
   cannot activate for any existing account, because there is nothing to activate on.
   See document 35.

## Maintenance

These documents describe the system as it was on **2026-10-02**. Several rest on queries
run against the live database that day. If the schema, the edge function set or the
published documents change, the "verified" sections need re-checking — they are not
self-updating and should not be trusted as current after that date.