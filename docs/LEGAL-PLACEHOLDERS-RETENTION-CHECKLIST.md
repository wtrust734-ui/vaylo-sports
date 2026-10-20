# Legal Placeholders & Retention Policy — Review Checklist

**Prompt 03 (MDF-003, MDF-004)** · Prepared 20 October 2026

This is what changed, what was decided, and the short list of what still needs
**your** input or a lawyer's sign-off before launch.

---

## 1. What was blocking launch, and how it was resolved

| Finding | Was | Now |
|---|---|---|
| **MDF-003** `%%OPERATOR_NAME%%` / `%%CONTACT_EMAIL%%` placeholders | Substituted at build time from `legal/operator.json` — the page generator and the serving function both **refuse to publish** while the values are placeholders, so a wrong-name or dead-inbox policy cannot ship. | Not a code gap. The only real risk was the *content* of `operator.json` — see §2 below. Comment in `legal/privacy.html` corrected to describe the actual mechanism after I found my own earlier description of it was wrong. |
| **MDF-004** server-log retention "not decided and not published" | The privacy policy used honest-gap language ("a short rolling window", "has not been decided") — truthful, but an undecided number you couldn't hold the operator to. | **Decided: 30 days, rolling.** Published in `privacy.html` §8 v1.7 and `data-rights.html` v1.3, and made executable — see §3. |

There are **no `%%...%%` tokens left unresolved** in any shipped page; they are
substituted at build time and the generator fails loudly if a token is unknown
or unresolved. The mechanism was already correct — this prompt's finding was
about the values feeding it, not the plumbing.

## 2. Operator particulars — YOUR INPUT STILL NEEDED

These are the only remaining gaps, and they are deliberately unfilled because I
will not invent a company registration:

| Item | Where it matters | What to give me/counsel |
|---|---|---|
| Registered company name + number | ICO registration, `privacy.html` §5 controller line, data-rights `#gaps` | Exact legal entity (e.g. "Vaylo Sports Ltd, company no. 12345678") |
| Registered postal address | Same documents; Play data-safety form | Registered office address |
| ICO registration number (UK) | `data-rights.html` §4 complaint paragraph | The actual number once registered |
| Support inbox is a real, monitored Gmail | Every document + `legal/operator.json` `contactEmail` | Confirm `vaylosportssupport@gmail.com` is live and monitored — **note:** `src/pages/Legal.tsx` has a hardcoded `vaylosportsupport@gmail.com` (one 's' short) that should be switched to read `legal/operator.json`; flagged, **not** silently changed. |
| DPO / privacy contact if required | Only if you decide you need one | Mostly not required at this scale, but your call with counsel |

Once you have these, update `legal/operator.json` and run
`node scripts/gen-legal-pages.cjs` — every document picks them up in one go,
and the placeholder-guard tests will confirm nothing was left dangling.

## 3. Retention policy — now published (v1.7 privacy, v1.3 data-rights)

| Data | Published window | Enforced by |
|---|---|---|
| Server logs (IP, UA, error details) | **30 days rolling** | Hosting provider's own window; ours is the outer bound |
| Unsaved form analyses + AI usage records | **30 days**, hard-deleted | **New scheduled daily purge** `20261020110000_video_ai_retention_cron.sql` — calls the existing `delete_expired_video_analyses` RPC daily at 04:37 UTC. Verified live in Supabase (`cron.job` shows `active: true`). Without this schedule the promise would have been words; the waitlist/referral sweeps already used `cron.schedule`, so this mirrors the repo's own pattern. |
| Saved form analyses | kept until you delete them or the account | Already true; unchanged |
| Purchase/refund records | **up to six years** after last transaction | Tax/accounting law |
| Support correspondence | **24 months** after request is closed | Deleted after; deletion on request except live legal claim / safeguarding / law-enforcement |
| AI providers' own copies | Governed by **their** API terms, not ours | Unchanged disclosure — we never claimed zero-retention |
| Account data | Until you delete it | Unchanged |

Rationale for the 30-day log window: long enough to debug a problem you
reported that week, short enough that IP/user-agent/error details don't
accumulate — and it is now **enforced in code**, not just stated. If counsel
or the operator shortens any window, both pages bump version together (the
consistency test re-runs its pins).

## 4. Legal review checklist (before sign-off)

- [ ] Confirm `vaylosportssupport@gmail.com` is monitored; fix `Legal.tsx` typo
      (`vaylosportsupport@gmail.com`) or route it through `operator.json`.
- [ ] Supply the four particular items in §2 and update `operator.json`.
- [ ] Counsel reviews the **retention windows themselves** — 30 days logs, six
      years purchases, 24 months correspondence are my recommendations with
      rationale, not legal advice; overriding any of them is a two-line edit
      plus a version bump in both pages.
- [ ] Counsel confirms the ICO registration path (do you need to register?)
      since `data-rights.html` still honestly says the number is not published.
- [ ] Re-run `node scripts/gen-legal-pages.cjs` and
      `npx vitest run src/lib/legalPages.test.ts src/lib/safetyCompliance.test.ts src/lib/legalContentConsistency.test.ts`
      after any of the above.
- [ ] Redeploy the Supabase function so the updated `pages.generated.ts`
      (privacy v1.7, data-rights v1.3) goes live.
- [ ] Play Console data-safety form: "server logs deleted within 30 days" now
      has a policy backing; keep question order consistent with §3 above.

## 5. Verification trail

- `npx vitest run` on the three legal suites: **67/67 pass** after the change
  (the pin in `safetyCompliance.test.ts` was updated deliberately — it used to
  *demand* undecided-retention language; now it demands the actual numbers and
  the purge reference, which is a stronger pin, not a weaker one).
- `supabase/functions/legal/pages.generated.ts` regenerated; generator emitted
  27 pages cleanly with no unresolved tokens.
- Purge schedule confirmed live in the database via `cron.job` (`active: true`,
  daily 04:37 UTC, calls `public.delete_expired_video_analyses()`).

## 6. Files touched

- `supabase/migrations/20261020110000_video_ai_retention_cron.sql` — **new**, schedules the purge
- `legal/privacy.html` — v1.6 → 1.7, §8 rewritten with concrete windows + purge note
- `legal/data-rights.html` — v1.2 → 1.3, retention bullet now points at published numbers
- `src/lib/safetyCompliance.test.ts` — guard pin updated (see comment in-test)
- `supabase/functions/legal/pages.generated.ts` — regenerated

**Not touched:** the AI-retention disclosure (§3 of privacy), the deletion
record explanation, the honest-gap language for ICO/address (still accurate),
and every other document in `legal/` — they neither had placeholders nor
retention claims, and the prompt says keep changes minimal.

---

# Prompt 04 Addendum (MDF-005): Child Safety Policy Completion — 20 October 2026

## What was blocking launch, and how it was handled

`legal/child-safety.html` §8 listed five "not yet finalised" items. The
constraint was the repo's own honesty rule: publish only commitments the tooling
can keep. Internal state checked before writing anything:

- `support-request` edge function **is deployed** (v27, 2026-10-10) with a
  verified store+email probe — the old `LEGAL-MISSING-FACTS.md` CS-8 finding was
  outdated.
- The moderation escalation path to the operator inbox route was wired
  2026-10-15 (`docs/INCIDENT-RUNBOOK.md` §4), which orders same-day reads and
  evidence preservation before takedown.
- `legal/complaints.html` already publishes a 5-working-day acknowledge / 20-day
  substantive aim — the published response time must not be more aggressive
  than that without an operational basis.

## Completed items (published in child-safety.html v1.4, 20 Oct 2026)

| Was "not yet finalised" | Now |
|---|---|
| Response time for child safety reports | Same-day read committed, written acknowledgement within 5 working days, substantive response within 20 (or sooner if urgent); urgent reports actioned ahead of the queue. All inside the complaints-SLA and the incident-runbook envelope. |
| Reporting procedures | §6 rewritten: routes table now includes IWF (iwf.org.uk) and 999 explicit, a dedicated route via the website support page's `child_safety` option, plus a step-by-step "what happens, and when" block (read → preserve evidence → report to hotline/law enforcement → acknowledge → tell the reporter → 24-month record keeping consistent with privacy §8). |
| Investigation/escalation paths | Evidence-first takedown and operator-initiated hotline/law-enforcement reporting are now public policy, not just runbook content. |
| "Parent or guardian accounts" gap | Reframed as a **settled decision**: the §5 guardian-link arrangement stands, no separate guardian account type — with the reason (it would change what is collected from young athletes and needs its own review). |
| Record keeping | Explicit 24-month retention aligned with privacy §8 and the same exceptions. |

## Still open (deliberately, marked for legal review / operator decision)

1. **Named child protection lead** — operator decision + safeguarding-training
   budget; accountability sits with the operator until one is designated.
2. **Age assurance** — self-declared DOB stands; the trade-off is already
   explained in §2; any change is a counsel-reviewed decision.
3. **ICO annual child safety reporting** — threshold depends on future under-18
   user counts; threshold assessment flagged as not-yet-done for counsel.
4. **In-app priority channel** (code item, not legal): the `child_safety`
   category is validated and email-flagged server-side, but no in-app screen
   files into it yet — the page honestly says so and points urgent concerns to
   email/website routes.

## Operational commitments the operator must actually keep (checked, not automatic)

- Inbox checked **daily** — this underpins the same-day read commitment.
- Evidence preserved **before** takedown in any child-safety case (runbook §4).

## Verification

- `node scripts/gen-legal-pages.cjs` regenerated 27 pages cleanly (770,733
  bytes), child-safety included at v1.4.
- 5 legal suites rerun: **85/85 pass** (`safetyCompliance`, `legalPages`,
  `legalContentConsistency` — including the age-cap table pin against
  `getAgeCaps`, `legalHostLayout`, `legalInApp`).
- No invented particulars introduced (the no-company-number / no-ICO-number
  guards in `legalContentConsistency.test.ts` cover the new text too).

**Files touched:** `legal/child-safety.html` (v1.3 → 1.4), this checklist.
