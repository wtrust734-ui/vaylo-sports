# 39 — Child Safety Risk Assessment

**Drafted 2026-10-02. Internal. Owner: unassigned.**

> The design controls for young athletes are unusually well implemented — most are enforced in
> the database, not the interface. The two serious gaps are **operational, not technical**: the
> date of birth that triggers all of them is empty for every user, and nothing reads the safety
> reports the app now accepts.

## 1. Population

Athletes aged 13–17. The Terms set a floor of 13; the product is designed for this group in
places. There is no parental account and no parental consent flow (document 29, standards
3.1–3.4).

## 2. Risks, with what actually mitigates each

### CS-1 — A young athlete is contacted, groomed or pressured by an adult
**Severity: highest. Likelihood: the app's central social risk.**

*Mitigated:* no direct messaging exists between athletes, and there is no facility for an adult
to contact a user at all. That is a real structural reduction, not a setting. Adult-created
content in communities is limited. Blocking filters both directions server-side.

*Not mitigated:* there is no proactive detection of an adult seeking a child; there is no age
check on who may create an account; there is no staff watching reports; and there is no
mechanism that would surface a disclosure of concern to anyone.

*Residual:* **high.** The single most valuable control would be someone reading the safety
report queue, and nobody does (document 38, M1).

### CS-2 — A young athlete's health or body data is exposed
**Severity: high. Likelihood: low.**

*Mitigated:* injury logs, mental check-ins, nutrition plans and video clips are private by
default and excluded from public profiles. No sponsor or brand receives a young athlete's
activity. The support inbox and reports table are closed to client roles.

*Not mitigated:* no monitoring for bulk reads; no alerting on sensitive-table access.

*Residual:* **low to medium.**

### CS-3 — A young athlete is exposed to harmful content
**Severity: high. Likelihood: medium — user-generated content exists.**

*Mitigated:* community guidelines exist with real enforcement language; report and block are
deployed; the guide explicitly covers sexual content, self-harm content and dangerous training.

*Not mitigated:* **no proactive scanning**; no staff reviewing content; a report goes to a queue
nobody reads.

*Residual:* **medium to high**, and entirely dependent on M1.

### CS-4 — A young athlete receives harmful coaching or training advice
**Severity: high. Likelihood: low.**

*Mitigated:* nutrition and calorie features are switched off in code for under-18s; training
volume is capped by age; AI features are not enabled and fail closed; the child-safety page
tells a young athlete that an adult pressuring them to restrict food or train through pain is
not normal coaching.

*Not mitigated:* no coach is vetted; there is no quality standard for creators or coaches;
**a report from a young athlete about an adult's conduct has no reader.**

*Residual:* **medium.**

### CS-5 — A young athlete's privacy defaults are not applied
**Severity: high. Likelihood: currently certain for the existing base.**

*Mitigated:* the minor-privacy trigger works and is tested; new accounts get a private
`privacy_settings` row on signup; all 11 existing accounts were backfilled to private with the
avatar hidden on 2026-10-02.

*Not mitigated:* **0 of 11 accounts have a date of birth.** The trigger cannot fire for anyone,
because there is no age to trigger on. Nothing prompts for one.

*Residual:* **high for any existing user; low for a user who supplies a date of birth.**

### CS-6 — Exploitation by an adult who creates an account posing as a peer
**Severity: high. Likelihood: medium.**

*Mitigated:* the acceptable-use rules prohibit impersonating another athlete and prohibit using
the app to identify or contact a child; impersonation is an enforced category in the report
system.

*Not mitigated:* **no verification of age or identity at all.** The only control is the
self-reported date of birth, which an adult can simply enter accurately — and doing so is not
prohibited, because nothing detects it.

*Residual:* **high.** This is the risk most reduced by an age-assurance decision, and that
decision has not been taken (document 35).

### CS-7 — A young athlete discloses distress and nothing happens
**Severity: very high. Likelihood: low in volume, high in individual impact.**

*Mitigated:* mental check-ins are private; `mental-wellbeing.html` tells an athlete plainly that
**nobody reads them**, and gives real routes to a crisis line, emergency services, a doctor, or
a trusted person. It explicitly declines to publish a number the team cannot answer.

*Not mitigated:* there is no duty-of-care process, no escalation, and no detection.

*Residual:* **medium by design, and honestly disclosed.** The disclosure is the mitigation; the
absence of a safety net is the risk. Whether that trade is acceptable is an operator judgement
that has not been made.

### CS-8 — A web form reports a concern that is never received
**Severity: very high. Likelihood: certain today.**

The website has child-safety, safety and privacy report forms. The `support-request` edge
function that writes to `support_requests` is **not deployed**, so those forms submit nowhere.
`support_requests` is an empty table.

**This is the most concrete unmitigated harm in the project.** A parent or a young athlete
submits a child-safety report through the website, is told it was received, and it is gone. The
project's own migration comment calls this "serious harm, not a cosmetic bug". It should be
deployed or the forms should be removed — today.

*Worse:* `is_child_safety` is not derived in the database, so even once the function is
deployed, a child-safety submission can be filed with the urgent flag off.

## 3. Risk register

| ID | Risk | Severity | Residual after current controls | Mitigation exists? |
|---|---|---|---|---|
| CS-8 | Safety forms submit nowhere | Very high | **Certain** | **No** |
| CS-7 | Distress disclosed, no response | Very high | Medium | Partial — disclosed only |
| CS-1 | Adult contact or grooming | Very high | **High** | Partial — structural, no monitoring |
| CS-6 | Adult posing as a peer | High | **High** | **No** |
| CS-3 | Harmful user-generated content | High | Medium-high | Partial — process without staffing |
| CS-5 | Privacy defaults not applied | High | High for existing users | Partial — trigger exists, input missing |
| CS-4 | Harmful coaching | High | Medium | Partial |
| CS-2 | Health data exposure | High | Low-medium | Yes |

## 4. The three things that would most improve this position

1. **Someone reads the safety report queue.** Every moderation risk above improves
   proportionally. Nothing else comes close.
2. **Deploy or remove the web forms.** CS-8 is certain harm today.
3. **Prompt for and store date of birth.** This is a small piece of work that activates an
   existing, tested control for every new user.

The first is a staffing decision. The second is a deployment. The third is a form field. All
three are small. None has been done.