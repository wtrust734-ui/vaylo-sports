# Ads Studio — Beta Test Plan

Tester tasks with starting conditions, pass evidence and failure severity.
Run each scenario against a deployed preview (or local dev against a
database migrated to the latest supabase/migrations).

Severity if the test fails:
- **P0** data loss, unauthorised spend, security breach
- **P1** core workflow unusable or misleading results
- **P2** usability/reliability issue with a workaround
- **P3** cosmetic or non-essential

## 1. First image advertisement (new user)
- Start: signed in, empty library, onboarding visible.
- Steps: read onboarding → Image Ads → write brief → generate concepts → select one → generate IG Feed background → compose.
- Expected: concept cards appear (evidence badge if a research project was chosen); background appears with cost applied; compose produces correctly sized ad.
- Evidence: artifact rows exist; a credit transaction exists server-side.
- Fail: P0 if charged without confirmation or with wrong amount; P1 if plan cannot be executed.

## 2. Short video advertisement
- Start: signed in, `GOOGLE_VIDEO_API` configured.
- Steps: Video Ads → free concept (script + storyboard) → shot "Get quote" → confirm → poll to ready → narration → attempt render.
- Expected: per-shot quote before spend (refusals honest), narration stores with billed-characters disclosed, render shows the hosted-worker requirement if unhosted.
- Evidence: operationId tracked in ad_video_shots; attempted render returns an honest error, never a video.
- Fail: P0 if a video is claimed without a stored render; P1 if the shot costs nothing (metering missing).

## 3. Competitor research
- Steps: Research → new project → scrape/ingest 2–3 public pages → analyse → opportunities.
- Expected: sources with links; blocked sources named; opportunities cite findings.
- Evidence: findings reference source URLs.
- Fail: P1 if fabricated statistics appear; P2 if a source is dropped silently.

## 4. Creative variations
- Steps: Image Ads → select generated background → "Ask for a variant" with a visual instruction.
- Expected: new variant artifact cites parent; original untouched; each variant costs credits and shows that.
- Fail: P1 if the original is overwritten.

## 5. Revise and export
- Steps: Library → pick an asset → download export → re-download.
- Expected: signed URL works each time; no public URL leak.
- Fail: P0 if asset of another user is reachable; P2 if download fails once but recovers.

## 6. Campaigns
- Steps: Campaigns → create → edit → duplicate manual check → archive via edit → delete with confirm.
- Expected: statuses honest; delete cascades concepts/assets/exports.
- Fail: P1 if delete leaves orphaned paid artifacts or unconfirmed status claims.

## 7. Performance data review
- Steps: ask chat "show me the results of this campaign"; open Integrations.
- Expected: honest answer — ad-platform APIs are not connected; no invented metrics; estimates are labelled estimates.
- Fail: P0 if any metric is presented as actual without a source.

## 8. Recovery from failed generation
- Steps: force provider failure (e.g., temporarily invalid model name in a test deployment) → observe retry.
- Expected: failure reason shown; project/concepts intact; retry replays same step; doubled-charge prevented by idempotency keys.
- Fail: P0 if work is lost or double-charged.

## 9. Unavailable integrations
- Steps: attempt render/video on a deployment without `RENDER_WORKER_URL`; open Integrations without `GOOGLE_VIDEO_API`.
- Expected: explicit "not configured" messages naming the missing secret; no fake success; jobs stay failed with the reason.
- Fail: P1 if any flow claims success.

## 10. Small-screen access
- Steps: run scenarios 1 and 6 at 360×640 (Chrome mobile emulation + real phone).
- Expected: no horizontal overflow, reachable controls, dialogs scroll.
- Fail: P2.

## Feedback
Testers use **Report a problem** in the Studio header (issues flow through the
existing support-request path into the operator's ticket queue with email
reference). Errors are additionally captured automatically via the
error-reporting pipeline and visible to the operator at /admin/errors.
