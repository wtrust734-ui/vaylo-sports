# 31 — Data Breach Response Policy

**Drafted 2026-10-02. Internal. Owner: unassigned. NOT PUBLISHED — deliberately.**

> A public description of how we detect and respond to intrusion is a map of our defences.
> The published `security-disclosure.html` says this in as many words and tells reporters
> what we actually do, which is the honest public position. This internal document holds
> the detail that should not be public.
>
> **This procedure has never been executed. It is a plan on paper, and it should be treated
> as untested until it has been walked through at least once.**

## 1. What counts as a breach here

A breach is not only "hacked". It includes:

- an athlete's training, injury or mental data reaching someone it should not;
- a report in `content_reports` becoming visible to anyone other than its reporter;
- a support request — including a child-safety one — becoming readable;
- an account being taken over, or credentials leaking;
- an AI prompt or a video clip reaching an unintended recipient;
- a former employee's or contractor's access outliving their work on it.

## 2. The sensitive assets, ranked

| Asset | Sensitivity | Why it matters most |
|---|---|---|
| `content_reports` | **Highest** | Identifies who reported a safety or abuse concern. Disclosure can put a reporter at risk. |
| `support_requests` where `is_child_safety` | **Highest** | May contain a child's identifying details and a safeguarding concern. |
| `mental_checkins`, `injury_logs` | **High** | Special category health data, freely given, possibly by a minor. |
| `video_form_analyses` | **High** | Clips of a minor's body and movement. |
| `profiles`, `privacy_settings` | **High** | Identity plus the privacy controls themselves. |
| `shared_activities`, `feed_visible_activities` | Medium | Social exposure; a block bypass defeats a privacy promise. |
| Purchase records | Medium | Financial. |

## 3. Triage

Severity is judged by **what could be exposed to whom**, not by how many rows are involved.

- **Critical** — special category data or a safety report could have reached an
  unauthorised party; or any credential or service-role key exposure; or a live
  young-athlete account compromised. Treat as an incident immediately.
- **High** — personal data reachable by an authenticated athlete but not by them; a
  privilege escalation that is not yet exploited.
- **Medium** — metadata exposure, or a control that failed in a way that did not expose data.
- **Low** — no personal data involved, e.g. a crash or an availability fault.

## 4. Response steps

1. **Contain.** Do not destroy evidence. Prefer reversible containment: disable a function,
   revoke a key, narrow a policy, disable an account. Take a schema and configuration snapshot
   before changing anything.
2. **Establish facts.** What data, whose, how many, who could have seen it, since when, and is
   it still happening.
3. **Assess notification duty.** Whether the 72-hour notification duty applies depends on risk
   to individuals, not on whether a technical control failed. **This assessment cannot be
   made here** — it depends on the operator's establishment and its regulator (document 37).
4. **Notify** affected athletes directly where the risk is high, in plain language, saying
   what happened, what data, and what they should do. A child-safety reporter must be told
   with particular care and must not be identified to anyone.
5. **Notify the regulator** where required, within the applicable window.
6. **Fix, then verify.** Fix the cause, not only the symptom. Re-test the control.
7. **Write it up.** What happened, what was exposed, what was done, what prevents recurrence.

## 5. Known weaknesses in this plan

| # | Weakness | Consequence | Fix |
|---|---|---|---|
| B1 | **No owner.** Nobody is accountable for declaring an incident. | A breach may sit unreported because no one is watching | Name an owner |
| B2 | **No detection.** There is no alerting on `auth.audit_log_entries`, on policy changes, or on the `edge_insights` tables verified to exist. | Detection depends on a user noticing | Alerting on `content_reports` reads and any policy change |
| B3 | **Never rehearsed.** No breach drill has been run. | The plan is untested prose | Run a tabletop exercise |
| B4 | **No contact list.** No registrar, regulator, insurer, counsel or on-call contact is recorded. | Step 4 and 5 cannot start | Record contacts |
| B5 | **No evidence retention policy.** Forensics output has no defined retention. | Evidence could be purged or over-kept | Define it |
| B6 | **Edge function set is not monitored.** 16 functions are deployed; a compromised one has no specific alert. | Compromise of a function could go unnoticed | Per-function alerting |
| B7 | **No deletion cross-check.** The deletion registry is not compared against the live schema. | Orphaned personal data survives account deletion | Automated comparison |

## 6. What exists today that helps

- RLS is enabled across the public schema, with 189 policies, and only 5 policies are
  `anon`-facing. A service-role or policy mistake is therefore the most likely route to a
  breach, not a missing policy.
- `support_requests` denies all four DML verbs to both `anon` and `authenticated`; only
  `service_role` can read the support inbox.
- `content_reports` grants `select, insert` to `authenticated` and deliberately **no update or
  delete**, so a client cannot alter or erase a report.
- Foreign keys cascade from `auth.users`, which limits what survives a deleted account.
- Secrets are read from environment or git-ignored `keystore.properties`, not committed.

## 7. Cannot be completed here

- The notification window, the regulator and the escalation path all depend on facts about the
  operator that are not published (document 37).
- Whether an insurance policy exists, and what it covers, is unknown.