# 36 — Information Security Policy

**Drafted 2026-10-02. Internal. Owner: unassigned. NOT PUBLISHED — deliberately.**

> Published `security-disclosure.html` tells researchers what they can expect. It says plainly
> that we do **not** run a bug bounty, are **not** independently penetration tested and have
> **no** published certification. That is the honest public position. This document holds the
> internal detail.

## 1. Controls actually in place

These were verified against the code, the live schema or a deployed artefact on 2026-10-02.

### Database and access control
| Control | Evidence |
|---|---|
| RLS enabled across the public schema | 189 policies on 104 public tables |
| Very small anonymous surface | **5** policies are `anon`-facing, out of 189 |
| Sensitive tables closed to `anon` | `content_reports` revoked from `anon`; `support_requests` revoked from both client roles |
| Support inbox unreadable to clients | All four DML verbs denied to `anon` and `authenticated`; only `service_role` writes |
| Reports immutable by the client | `authenticated` gets `select, insert` and deliberately **no** `update` or `delete` |
| Blocking enforced server-side | `feed_visible_activities` view with `security_invoker`, both directions |
| Consent defaults enforced in the database | Minor-privacy trigger overrides whatever the client sends |
| Reports validated and rate-limited in the database | `report_content()` is the only write path; closed reason enum; 10/hour cap; idempotent |

### Application and secrets
| Control | Evidence |
|---|---|
| Minimal Android permissions | Manifest declares only `INTERNET` (plus `VIBRATE` and an AndroidX-injected receiver permission). Six unused Health Connect permissions removed 2026-10-02 |
| No scripts or third-party resources in legal pages | Enforced by `assertSelfContained` in the generator, and asserted in tests |
| Sign-in keys external to the repo | `keystore.properties` git-ignored; environment in CI |
| No analytics | None installed, deliberately, and disclosed |

### Build and supply chain
| Control | Evidence |
|---|---|
| Release builds are signed | `apksigner verify` passes; `CN=Vaylo Sports` |
| Build is reproducible from source | `npm run build:native` then Gradle; 617 tests and `tsc --noEmit` clean |
| Legal pages generated from one registry | `legal/pages.json` drives both the edge function and the website, so the two cannot publish different sets |

## 2. Controls that do not exist

| # | Missing | Consequence | Priority |
|---|---|---|---|
| S1 | **No alerting.** No monitoring on `auth.audit_log_entries`, on policy changes, or on reads of `content_reports`. | A breach or an abuse pattern may go unnoticed (document 31, B2) | High |
| S2 | **No security owner.** Nobody is accountable. | Nothing is watched because nobody is responsible for watching | High |
| S3 | **No independent testing.** No penetration test, no security certification. | Defences are only tested by the people who wrote them | High |
| S4 | **No vulnerability disclosure history.** The route exists on paper but this is its first report | No evidence the process works | Medium |
| S5 | **No MFA enforcement.** Social sign-in is offered; passkeys are supported. No policy decision on whether MFA is required for anything | A compromised password may be sufficient | Medium |
| S6 | **No session management policy.** No session revocation on a password change is evidenced | A stolen session may persist | Medium |
| S7 | **No rate limiting on authentication** in code that I have verified | Brute force against sign-in | High |
| S8 | **No secrets rotation procedure.** | A leaked key is rotated ad hoc, if at all | Medium |
| S9 | **No dependency scanning** in the visible pipeline | A vulnerable transitive dependency is found by chance | Medium |
| S10 | **No backup integrity testing** | Backups may not be restorable | Medium |
| S11 | **No logging policy or retention** for function logs | Either over-retained or missing when needed | Medium |
| S12 | **No incident history**, because there has been no incident and no process | The plan is untested (document 31) | High |

## 3. The honest summary

The **data model** is in good shape. Row-level security is comprehensive, the anonymous surface
is tiny, and several privacy and safety controls are enforced in the database where a client bug
cannot defeat them. That is better than most comparable products, and it is the result of
deliberate work.

The **operational** side is close to empty. There is no monitoring, no named owner, no external
testing and no incident history. The system has been built carefully and then not watched.

That asymmetry is the finding. A well-designed schema protects against mistakes by application
code; it does very little about a compromised credential, a leaked service-role key, or an
insider, because there is no detection layer behind any of those.

## 4. Priority actions

1. Name a security owner. Everything else depends on it.
2. Alert on `content_reports` reads, on any RLS policy change, and on any new `anon` grant.
3. Alert on the AI functions returning anything other than their configured auth failure.
4. Verify authentication rate limiting exists, and implement it if not.
5. Run a tabletop breach exercise (document 31, B3).
6. Commission an independent test once, even a narrow one, before launch.
7. Establish a secrets rotation and dependency scanning routine.

## 5. Cannot be completed here

- Whether an existing insurance policy responds to a breach is unknown.
- Whether the current hosting and build configuration meets any particular certification
  standard cannot be assessed from this repository.
- The threat model beyond the application — physical, social engineering of volunteers,
  supply chain compromise of build tooling — is not covered here.