# Incident runbook — Vaylo Sports

If you are reading this during an incident: **skip to the section you need**, act,
take notes as you go. Everything in square brackets is owner-owned detail to fill
in — none of it is invented here.

Operator today: the values in `legal/operator.json` (email
`vaylosportssupport@gmail.com`). **When an incident involves personal data, both the
US and the EU sections apply simultaneously** — the app is not HIPAA-covered, is not
a U.S. public-benefit health provider, and serves EU users; run both tracks in
parallel with one owner of the case.

---

## 0. Declare, don't decide alone

| Step | Who | Notes |
|---|---|---|
| 1. Classify | on-call [owner] | `SEV1` user data exposed/lost/deleted, service fully down, or credentials/keys compromised. `SEV2` partial feature loss, moderation backlog. `SEV3` cosmetic. |
| 2. Write one running note | incident owner | Timestamped log file (one per incident) from the first minute: what you saw, what you did, what you don't know yet. |
| 3. Tell the operator at once | anyone | Even suspected. Late escalation is the failure mode every incident postmortem names. |

---

## 1. Data breach on user content / health-adjacent data

This app processes health-adjacent personal data (workouts, weight, readiness, HRV,
nutrition logs, form photos) with accounts from EEA/UK/WA/CA possible at any time,
while not being HIPAA-covered and not (currently) obliged to keep a DPO — so the
same event runs two notification clocks in parallel.

### U.S. — FTC Health Breach Notification Rule (applies to non-HIPAA health apps)

Trigger: **unauthorized acquisition/disclosure/exposure of consumer health
information** — including via an unsecured DB, a lost API key leading to data
exfiltration, or a vendor breach. The rule's reach covers an app intimating health
data regardless of business size.

- **60 days** to notify each affected user; **60 days** from discovery to notify the
  FTC (FTC Health Breach Notification Rule). Under 500 affected people may be
  reported within annually-filed logs rather than immediately, but treat the
  60-day/FTC-clock rule as the default ceiling and consult counsel in the same week.
- Notification must be plain-language, describe what happened, what data, steps to
  take, what the app is doing, and who to contact.
- Keep the evidence: log excerpts, the affected-user list, the vector, your
  notification drafts and send timestamps.

### EU/UK — GDPR Articles 33/34

- **72 hours** from becoming aware to notify the ICO (UK) / the lead DPA (EEA
  authority) for reportable breaches, unless unlikely to result in risk to people:
  document the reasoning either way, dated.
- Notify affected people "without undue delay" where the risk is high (Art 34).
- The records go into the compliance register (doc 32): timeline, scope, vector,
  measures taken.

### What to do first, regardless of jurisdiction (the containment list)

1. **Rotate the credentials that could have been used** — Supabase service keys,
   `OPENAI_API_KEY`, `GOOGLE_API`, `GMAIL_APP_PASSWORD`, `STRIPE_*`,
   `SUPABASE_ACCESS_TOKEN` (rotate in Credential Manager),  Netlify token. Do this
   BEFORE forensics if the key may still be in use; forensic detail survives key
   rotation, a continuing intrusion does not.
2. **Preserve, then purge**: snapshot the affected tables/logs (the CLI's
   `supabase db dump` when Docker is available, else via the Management API query
   endpoint) before deleting anything.
3. Revoke active auth sessions if account takeover is suspected: Supabase Dashboard →
   Auth → sign out all sessions, then rotate the anon/publishable key if needed.
4. Decide jointly with counsel whether the event triggers either clock above.

### Supabase-specific

- Supabase operational status and any platform-side breach: status.supabase.com;
  their DPA/incident-notification obligations come via your account agreement.
- Database-level: audit `supabase_migrations` (has history), `pg_audit`-style logs are
  not enabled by default — for this project the workable post-mortem sources are
  function logs (Supabase dashboard → functions → logs), auth.users last-signin
  columns, and `credit_transactions` for economy anomalies.

---

## 2. Secrets and credentials: rotation playbook (no incident needed)

| Credential | Where it lives | Rotate |
|---|---|---|
| Upload keystore (`upload-keystore.jks`) | android/, passwords in `keystore.properties` (git-ignored) | Annually + on any person change; Play Console can reset if lost |
| `SUPABASE_ACCESS_TOKEN` | Windows Credential Manager (`Supabase CLI:supabase`) | dashboard → new token, update locally, revoke old |
| `OPENAI_API_KEY`, `GOOGLE_API`/`GOOGLE_VIDEO_API` | Supabase function secrets | `supabase secrets set` new → deploy → revoke old on the provider |
| `GMAIL_USER` / `GMAIL_APP_PASSWORD` | Supabase secrets + `.env` (local) | Google Account → app passwords |
| `STRIPE_*` | Supabase secrets | Stripe dashboard |
| `SUPPORT_IP_SALT` / `WAITLIST_IP_SALT` | Supabase secrets | resets the IP-hash tables' meaning — fine (rate-limits are per-deployment by design) |
| FCM `FCM_PRIVATE_KEY` | Supabase secrets | Google Cloud → IAM → service account keys |

---

## 3. AI provider key exceeds budget / is disabled mid-month

Symptom: `ai:health` shows 4xx/502 from OpenAI or Gemini, features accept credits but
fail to answer. **The app's honest-failure contract matters here**: a user-based flow
that consumed credits and produced nothing must refund — `credits_grant` with reason
'provider-failure' is the sanctioned route; exercise it per affected user pattern
(query `credit_transactions` around the outage window, refund net of successes).

## 4. Content-queue / child-safety escalation

A `content_reports` row marked `child_safety`, or any report alleging
minor-pictures/self-harm/serious threats, is:
1. Read immediately (same day) by the operator inbox route (the report is also
   escalated by the moderation escalation path wired 2026-10-15);
2. Actioned per the child-safety page judgment: preserve evidence, report to the
   relevant national hotline/law-enforcement where the content meets the thresholds,
   do NOT delete in a way that destroys evidence without preserving it first.
3. Logged in doc 39's incident section.

## 5. Production outage (app fully unusable)

- Declare and post honestly: the user-facing status text (even "we're down") goes on
  the Netlify site; in-app offline banner already handles connection loss.
- Root-cause quickly: expiry? DNS? Supabase regional outage (status.supabase.com +
  check health first); Netlify site outage is independent from app outage which uses
  Supabase directly.
- Record the timeline regardless of cause.

## 6. Upload key lost / compromised (Play)

1. You cannot sign new releases. Do NOT ship/debug-sign onto the closed track.
2. Play Console → Settings → App signing → **Request key reset**. Google holds the
   remote app-signing key (Play App Signing is on), so users are unaffected; only
   this repo needs the new upload key registered.
3. Then rotate `keystore.properties` locally and re-run the build script.

## 7. Personal-data request incident (GDPR Art 15/17/20 complaint or regulator inquiry)

- Find the case in `support_requests`/`content_reports`, respond inside the SLA
  published in `legal/complaints.html` (5 working days acknowledge / 20 substantive).
- The tooling exists in-app (`export-my-data`, `delete-account`); if it failed for a
  user, run the export manually with the service role and mail it — a failed
  self-service flow is still an SLA miss, not a refusal.

## 8. Postmortem template (every SEV1/2)

What happened · when discovered (exact UTC) · who acted · user impact (numbers)
· data impact (what tables, which users, count) · containment/recovery steps with
timestamps · clocks obligation triggered (US 60d / EU-72h / neither + why) · what
will change · when. Filed as `docs/incidents/<date>-<slug>.md` and linked from
doc 32.
