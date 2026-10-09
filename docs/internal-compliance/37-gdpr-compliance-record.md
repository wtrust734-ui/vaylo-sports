# 37 — Data Protection / GDPR Compliance Record

**Drafted 2026-10-02. Internal. Owner: unassigned.**

> **This is not a legal opinion and not a compliance certificate.** It records what the code
> and database do against each requirement, marks what is missing, and states where a
> determination requires a fact about the operator that has not been supplied.

## 1. Applicability — and the gap at the centre of it

The published Terms say the contract is governed by "the laws of the country in which
%%OPERATOR_NAME%% is established". `legal/operator.json` contains **only** `operatorName` and
`contactEmail`.

There is therefore **no registered company name, no company number, no registered address, no
ICO registration number, and no named Data Protection Officer**, and no UK or EEA representative
is appointed. The published documents disclose each of these rather than conceal them, which is
correct handling and is better than silence. But the consequence is real:

**Almost every jurisdictional question below is unanswerable.** Whether a particular obligation
applies, which regulator has jurisdiction, which transfer mechanism is needed, and whether a
representative is required all depend on where the controller is established.

## 2. Article-by-article position

| Requirement | Position | Evidence or gap |
|---|---|---|
| Art. 5(1)(a) lawfulness, fairness, transparency | **Partial** | Lawful basis recorded (document 28 §3). Transparency is undermined by legal pages being served as `text/plain` — L4 in the audit |
| Art. 5(1)(b) purpose limitation | **Met** | Purposes are stated and features are gated by entitlement |
| Art. 5(1)(c) data minimisation | **Met, and actively worked** | Unused Health Connect permissions removed; injury/mental/clips private by default; 104 tables but none gratuitously populated |
| Art. 5(1)(d) accuracy | **Met** | Athlete owns and corrects their own rows |
| Art. 5(1)(e) storage limitation | **NOT MET** | No retention enforcement at all (document 30) |
| Art. 5(1)(f) integrity and confidentiality | **Partial** | 189 RLS policies; but no monitoring, no alerting, no security owner (document 36) |
| Art. 5(2) accountability | **Partial** | This directory is part of it. No named owner and no sign-off anywhere |
| Art. 6 lawful basis | **Met** | Contract for the service; consent for wearables and AI; consent columns deployed |
| Art. 7 consent conditions | **Partial** | Consent can be given and (for wearables) withdrawn; no general withdrawal mechanism |
| Art. 9 special category condition | **Partial** | Consent recorded in `health_consent_at`; **NULL for every existing account** |
| Art. 12–14 transparency | **Partial** | Plain-language documents exist and are complete; delivery is broken by L4 |
| Art. 13(1)(c) recipients | **Partial** | Categories described publicly; no sub-processor register published, and one is incomplete internally (document 33) |
| Art. 15 right of access | **BROKEN** | `export-my-data` is not deployed; returns 404, while the policy and the in-app tile promise it (document 32 §2) |
| Art. 16 rectification | **Met** | Direct writes by the athlete |
| Art. 17 erasure | **Met, with conflicts** | `delete-account` deployed; but no exception logic prevents a safety report being cascade-deleted with the reporter's account (document 32 §3) |
| Art. 18 restriction | **NOT MET** | No mechanism |
| Art. 20 portability | **BROKEN** | Same undeployed function |
| Art. 21 objection | **NOT MET** | No mechanism |
| Art. 22 automated decision-making | **Met by absence** | No profiling, no access decisions. Must be preserved deliberately |
| Art. 25 data protection by design | **Strong** | The database enforces what the UI could forget: report rate limits, block filtering, minor privacy defaults, closed enums, immutable moderation status |
| Art. 30 records of processing | **Partial** | This directory is a partial RoPA. No formal register exists |
| Art. 32 security of processing | **Partial** | Good data model, absent operational layer (document 36) |
| Art. 33–34 breach notification | **NOT READY** | No owner, no detection, no contact list; never rehearsed (document 31) |
| Art. 35 DPIA | **Met** | Document 28 exists, unsigned |
| Art. 37 DPO | **NOT DONE** | No DPO appointed; whether one is required depends on §1 |
| Art. 44+ transfers | **UNKNOWN** | No transfer assessment recorded; hosting region unknown (document 33) |
| Art. 27 representative | **NOT DONE** | Disclosed in the Privacy Policy; not appointed |

## 3. The summary position

**Data protection by design and by default: genuinely strong.** The application's privacy
properties live in the database, not in the interface, and several of them are things I could
not get wrong from the client even if I tried — report rate limiting, idempotent reporting,
immutable moderation status, server-side block filtering, and a trigger that overrides a minor's
privacy settings.

**Operational accountability: weak.** Four rights are unimplemented or broken (access,
portability, restriction, objection), retention is unenforced, breach response is untested, and
no one is accountable for any of it.

## 4. Where the operator's disclosure does real damage

Not the disclosure itself — the disclosure is honest. The damage is that **a published policy
which admits it has not appointed a DPO or a representative is telling a regulator exactly which
controls are missing**, on a service aimed at children. That is the correct thing to publish and
a poor position to be in.

Two paths, and they should be recorded as a choice:

1. Appoint a DPO and a representative, publish the identity, and close the gaps.
2. Record a reasoned decision not to, with the reasoning, and publish that.

Doing neither is what is happening now.

## 5. Cannot be completed here

- Applicability, jurisdiction, regulator, transfer mechanism, representative obligation, DPO
  obligation, and the response deadline for a rights request. **All** require the operator's
  establishment.
- Whether any of the "partial" positions would be assessed differently in a non-UK jurisdiction.
- Whether the current insurance responds.