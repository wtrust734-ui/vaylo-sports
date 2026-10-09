# 38 — User Content Moderation & Safety Procedure

**Drafted 2026-10-02. Internal. Owner: unassigned.**

## 1. Status at a glance

The **machinery** is real and, as of 2026-10-02, deployed. The **people** are not there.

| Component | Status |
|---|---|
| Report pipeline (`content_reports` + `report_content()`) | Deployed and verified 2026-10-02. Was 404 until migration `20261001120000` was applied |
| In-app Report control (feed, public profile) | Wired; previously always errored |
| Blocking, server-side, both directions | Deployed; `feed_visible_activities` with `security_invoker` |
| Support inbox (`support_requests`) | Table deployed; **the edge function that writes to it is not deployed** |
| Report history visible to the reporter | Wired, reads `content_reports` |
| **Staffed moderation** | **Does not exist** |
| **Response-time commitment** | **None published, none staffed** |
| **Appeals handling** | Published as a process; no owner |

## 2. What the pipeline does, verified

Tested against production on 2026-10-02, inside rolled-back transactions:

- Filing a report returns a row; a duplicate call returns the existing row and the count
  stays at 1.
- An invalid reason is refused (`Please choose a reason.`).
- The **11th** report in an hour is refused.
- The reporter sees their own report; a different `auth.uid()` sees 0 rows — **the reporter is
  not exposed to the person reported.**
- `anon` cannot read `content_reports` at all.
- `authenticated` has `select, insert` and **no** `update` or `delete`, so a client cannot set a
  report's status or delete it to hide it.

Those are genuinely good properties. Validation, rate limiting, identity and idempotency are all
decided server-side in one place, which is the correct design.

## 3. The gap that matters

**Nothing is watching the queue.**

There is no moderation team, no contractor, no shift, and no automated triage. Reports are
written to a table and read by nobody. The published `report-content.html` says a report is
"read" by a person — which is true of the process, and currently untrue of the practice.

The published child-safety page compounds this honestly and bleakly:

> "We do not currently have a staffed moderation team working around the clock, so if a report
> arrives outside UK working hours it may not be read until the next working day."

That sentence is accurate. It also means a report arriving **inside** working hours may equally
go unread, because there is no working-hours rota either.

**This is the most serious operational gap in the project.** The reporting machinery was built
carefully, deployed on 2026-10-02, and connected to a queue with no reader. Shipping the
mechanism without the staffing gives the *appearance* of a moderation capability that does not
yet operate. That is worse for a child-safety posture than not having the button at all, because
a reporter now believes a report has been seen.

## 4. The intended process

1. A report arrives in `content_reports` (in-app) or `support_requests` (email/web).
2. Triage by risk: child-safety and adult-contact reports first, regardless of queue age.
3. Where a child may be at risk, **limit the account first** and investigate afterwards. Limiting
   is reversible; a disclosure is not.
4. Review the content and the account history.
5. Decide: no action, warning, limit, content removal, or suspension.
6. Inform the reported person of the decision and the reason.
7. Feed the outcome back into the product.

**Not done:** none of this is assigned to anyone, and no triage priority has been encoded.

## 5. Decisions that are already made, and are good

- **A reporter cannot see the outcome.** Accepted trade-off, documented: it protects the reporter
  but leaves them uncertain. The alternative exposes them.
- **A reporter cannot delete their report.** Correct. Otherwise the queue can be sanitised by the
  person reporting.
- **The reported person is told what happened.** Correct, and it is what makes the appeals
  process meaningful.
- **Reasons are a closed enum.** An unlabelled report cannot be actioned.
- **Ten reports an hour.** Above any genuine use, far below a flood.
- **Blocking filters server-side.** Rows are not sent to the device at all, which is the only
  version of blocking that is private.

## 6. Missing decisions and work

| # | Gap | Priority |
|---|---|---|
| M1 | **No one reads the queue** | **Critical** |
| M2 | `support-request` edge function not deployed, so the published web forms submit nowhere | **Critical** — a child-safety form that reports success while going nowhere is serious harm, not a cosmetic bug |
| M3 | `is_child_safety` is not derived in the database, so a child-safety request can be filed with the urgent flag off | High |
| M4 | No triage priority; queue order is arrival order | High |
| M5 | No moderation log or decision history separate from the report | Medium |
| M6 | No proactive scanning; nothing catches abuse that is never reported | Medium |
| M7 | Appeals have no owner and no timeframe | Medium |
| M8 | No rate limit or review of report volume for signs of a coordinated campaign | Medium |

## 7. The web forms problem, specifically

`support_requests` exists as a table and the website has forms for support, privacy requests,
safety reports, purchase problems and deletion. The `support-request` edge function is **not
deployed**, so those forms submit nowhere.

The migration's own comment says: "A form that submits nowhere is worse than no form, because it
tells a person their report was received when it was not — and for a child-safety report that is
a serious harm."

**That reasoning applies right now.** Either deploy the function or remove the forms from the
website until it is deployed. Leaving them live is the one option the project has already
identified as unacceptable.

## 8. Cannot be completed here

- Any staffing decision, rota, or response-time commitment.
- Whether the moderation approach satisfies a specific platform's user-generated-content
  policy, which depends on the platform and its current published requirements.
- Whether the current approach is proportionate for the number of users a young athlete could
  plausibly reach at scale.