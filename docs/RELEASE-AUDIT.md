# Release audit — 8 October 2026

A pre-release pass over the whole product: the rendered UI, the copy, the code, the
database, the edge functions, security posture and every published legal document. Run
against the working tree **and** the live project, because a repository that is correct
and a deployment that is not is exactly the failure this looks for.

Everything below is either (a) fixed and verified, (b) blocked on something only the
owner can do, or (c) evidence that it was checked and is clean. No check is reported as
passing that was not run.

## Verdict

**One release blocker left, and it is not code: the marketing site at
`vaylo-sports.netlify.app` is not deployed from the current sources**, so the URLs a
store listing points at serve an older revision of the legal documents. Rebuilding it is
one command; it needs Netlify credentials that are not in this environment (B1).

The Supabase copy of the same documents is fixed and deployed (below). B2 needs a
Dashboard change, B3 needs Firebase, B4 needs the company's own details.

---

## 1. Blockers

### B1. The published legal pages are an older revision — Supabase side fixed, Netlify side needs a deploy

There are **two** places these documents are published, and both were stale. They are
different problems with different fixes, and the first draft of this audit conflated
them.

**a) The Supabase function — fixed and deployed today.**

`/functions/v1/legal/*` served a build from before the current documents: 28,705 bytes
for the Terms, with no "Version 1.4" anywhere in it, while the repository's Terms
(`legal/terms.html`, 33,418 bytes) is version 1.4 — the version every athlete is asked
to accept by the re-acceptance banner and the version recorded in
`profiles.terms_version`. Regenerate and deploy (run twice in this pass — the second
carried the title fix described in section 2):

```bash
node scripts/gen-legal-pages.cjs
supabase functions deploy legal --no-verify-jwt --project-ref vvwhausdjzdmsyxekrcl
```

Verified live afterwards: `/legal` → 200, 27 document links; `/legal/terms` → 34,419
bytes **and contains "Version 1.4"**; `/legal/privacy` → 43,171 bytes;
`/legal/account-deletion` → 20,940; `/legal/child-safety` → 34,788. The gateway still
rewrites one header and one policy — (b) below is exactly what that means.

**b) That host can never serve a *rendered* page, and that is not a bug we can fix.**

`GET /functions/v1/legal/privacy` returns:

```
content-type: text/plain            ← the function sends text/html
content-security-policy: default-src 'none'; sandbox   ← the function sends
                                            "default-src 'none'; style-src 'unsafe-inline'; …"
x-content-type-options: nosniff     ← ours, passed through
x-frame-options: SAMEORIGIN         ← ours, passed through
sb-gateway-version: 1
```

The gateway rewrites `Content-Type` to `text/plain` and replaces the policy with
`sandbox` for HTML responses. `/functions/v1/og-image` returning `image/png` unchanged
shows it is specific to HTML, not a blanket gateway behaviour: this is Supabase refusing
to let a functions subdomain serve web pages, which is a reasonable thing to refuse.
So **the function URLs are a machine-readable mirror and must not be the policy URL in a
store listing.**

**c) The real published URLs are on Netlify, and they are stale.**

`SITE_URL=https://vaylo-sports.netlify.app` and `VITE_LEGAL_BASE_URL=…/legal`, and the
app already links there. Measured today:

| URL | Status | Result |
|---|---|---|
| `/legal/` | 200 | `text/html`, Legal Centre |
| `/legal/terms/` | 200 | `text/html`, **19,879 bytes, no "Version 1.4"** |
| `/legal/privacy/` | 200 | `text/html`, 25,869 bytes |
| `/legal/account-deletion/`, `/support/`, `/delete-account/`, `/contact/` | 200 | all reachable |

The site is generated deterministically from this repository, and the regenerated
output is current (Terms 1.4, 43 files, 38 URLs). It has **not been deployed from it**:
this environment has no `NETLIFY_AUTH_TOKEN` and no `~/.netlify` session, so
`scripts/deploy-web.cjs` cannot run here. One command does it:

```bash
node scripts/deploy-web.cjs     # generate → verify → netlify deploy --prod
```

Until that lands, the store listing should point at the current documents. If Play's
privacy-policy and data-deletion URLs currently use the `supabase.co` function URLs,
they are serving raw source text as well as an older revision and should be changed to
the Netlify ones.

### B2. Auth posture — 3 of 3 AT RISK (Dashboard settings, not code)

`npm run auth:posture`:

| Check | Result | Close it by |
|---|---|---|
| A 6-character password is refused | **accepted**, session issued | **Mitigated in code**: `Auth.tsx` now requires 8 for a new password. Dashboard → Authentication → Sign In / Providers → Email → minimum length 8 |
| Sign-up requires email confirmation | **session issued with no email confirmed** | Turn on "Confirm email". This is the single biggest anti-abuse control: it is what makes mass free-trial sign-up cost something |
| Repeated wrong passwords are rate limited | 12 attempts, no 429 | Set the token and password rate limits |

The probe left two accounts behind: `authposture.1791480420254@example.com`,
`authposture2.1791480420684@example.com` — delete them in Dashboard → Authentication →
Users.

### B3. Push is not configured — `npm run push:ready` → NOT READY (7 items)

Four FCM values empty in `android/app/src/main/res/values/vaylo_fcm.xml` and three
function secrets unset (`FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY`). The app
degrades honestly — it reports push as unconfigured and local notifications still work —
so this is a launch task, not a defect. Walkthrough:
`android/app/src/main/java/com/vaylosports/app/push/FIREBASE.md`.

### B4. The operator's legal identity is still unpublished (owner input)

`legal/operator.json` holds a name and an inbox and nothing else: no registered company
name, number, registered address, ICO registration number, country of establishment or
DPO. The published documents disclose the gap rather than invent details, which is the
right handling, but a consumer contract normally has to identify the trader, Art
13(1)(a) wants a postal address, and the Terms' governing-law clause reads as evasive
precisely because the country is unset. `docs/LEGAL-MISSING-FACTS.md` item 1.

---

## 2. Fixed and verified in this pass

| Fix | Files |
|---|---|
| **The legal function stopped serving a stale revision** (was Terms without 1.4) | regenerated + `supabase functions deploy legal` (verified live) |
| **Eight legal documents published a double-escaped title** — "Child &amp;amp; Young Athlete Safety" in meta tags and a literal "&amp;" in the browser tab. The title extraction kept the source's `&amp;` and the layout escaped it again | `scripts/gen-legal-pages.cjs`, `scripts/gen-website.cjs` — 0 occurrences of `&amp;amp;` remain in the generated site |
| New passwords require 8 characters (reset asked for 6; sign-up had no check at all) | `src/pages/Auth.tsx` |
| Removed the Goals "Accountability Partners" card: it promised friends could see goal progress and its button did `window.location.href = "/friends"`, a route that redirects home — a dead end that also left the app inside the Capacitor shell | `src/pages/Goals.tsx` |
| Retired the friend-based copy with the surface (see section 3) | `src/pages/Achievements.tsx`, `src/pages/NotificationPrefs.tsx`, `src/pages/Notifications.tsx` |
| "Friends, followers, groups and messages" → "Friendships, communities and messages": there is no followers concept anywhere in the tree, and a deletion notice should name what will actually go | `src/pages/DeleteAccount.tsx` |
| VPR hero "RUNNINGTrend needs 2 saves" — an `inline-flex` badge sharing a line with the following inline text | `src/components/vpr/VprHero.tsx` |
| Featured learning cards rendered 109px wide inside their scroller (title wrapped to four lines, the meta line crushed to 72px against the Read button); now `shrink-0` at 76vw with a real gutter on the meta row | `src/components/learning/LessonCard.tsx` |
| The terms banner and the stored-preferences notice were drawn over each other on every screen, 130px deep | `src/components/legal/TermsChangeNotice.tsx`, `src/components/CookieNotice.tsx`, `src/index.css` |
| The UI audit could not see any of the above; it now measures "things touching with no gutter" and "two fixed layers over each other", both gating `npm run ui:check` | `scripts/ui-audit.mjs`, `docs/UI.md` |

## 3. Retired with the friends surface — and restored the same day

The morning pass retired the copy that sold a friends feature nothing could reach:
`/friends`, `/feed` and `/communities` were redirects to the home screen and no client
code called `accept_friend_request` or `find_user_by_friend_code`.

**That was corrected the same day (2026-10-08, later).** The friends surface is back
rather than retired — the friend graph, direct messaging, per-activity sharing,
reporting, blocking and unfriending, all reachable from the sidebar. See
[docs/FRIENDS.md](FRIENDS.md) for the rules, where each one is enforced, and the live
verification.

What that changes in this document:

- **`/friends` is a real page again** (`/friends/:friendId` for a conversation).
  `/feed` and `/communities` are still redirects, and the Feed surface is not part of
  this work.
- **The four friend achievements are back and earnable** (`Achievements.tsx`);
  `d.friends` was never removed, so they restored unchanged. **The two friend
  challenges** ("Social Butterfly", "Friend Network") stay retired — they are seeded
  rows, so they need a seed migration and a copy review.
- **The "Friend activity" switch is back and is not a decoration**
  (`NotificationPrefs.tsx`): `notify_direct_message()` reads
  `notification_prefs.friend_activity` and writes nothing to the bell while it is off.
- **`Notifications.tsx`** now says messages from friends arrive there, because they do.
- **The Goals "Accountability Partners" card stays out.** It promised that a partner
  could see your goal progress; messaging a friend is not that, and the promise is
  still unbuilt.

## 4. Decisions or facts still owed (from `docs/LEGAL-MISSING-FACTS.md`)

- **Retention periods.** Proposed in doc 30, decided nowhere, published nowhere.
- **Complaint and support response times.** `complaints.html` publishes aims of 5 and 20
  working days. Confirm or change them, and name who owns complaints.
- **Wearable providers, AI provider, training use of prompts, data residency.** None
  named, because none chosen. AI features are live (`npm run ai:health`: 7/7 answering),
  so this is current, not hypothetical.
- **Moderation.** Nobody reads reports. This is the largest operational gap in the
  product.
- **Minors.** Whether `allow_friend_requests` and `allow_community_posting` stay on, and
  whether an age gate and parental controls are added.

## 5. Verified clean (and how)

| Check | Result |
|---|---|
| `npm run security:check` | **PASS** — 31 live checks (7 added for friend messaging; 24 as reported): RPC-level privilege rules, RLS write refusals, self-friending, duplicate reward claims, malformed baskets, client-inserted ledger rows, unofficial challenge minting |
| `npm run secret:scan` | **PASS** — 933 files, 11 rules, 0 findings (working tree; history is not scanned) |
| `npm run ai:health` | **7/7 AI features alive**. The three that answer 400 spend nothing; the run cost the review account 10 credits and said so |
| `npm test` | **84/84 files pass** |
| `npm run ui:check` | **PASS** — 46 routes: every control ≥44px, nothing scrolls sideways, nothing cut off, nothing jammed, no fixed layers overlapping |
| `npm run typecheck:app`, `npx eslint` on every file touched | clean (4 pre-existing warnings, none on a changed line) |
| Edge-function auth spot-check | `ai-service` → 401 without a JWT; `support-request` → 405 on GET; `waitlist-campaigns` → 405 on GET. `verify_jwt` is off only where a signature cannot exist (Stripe webhook, unsubscribe, legal pages), each documented in place |
| RLS | enabled on every table; remaining `USING (true)` policies are public catalogue reads (avatars, event packs, pricing, challenges, creators) plus the ones explicitly reviewed in `20261006140000_audit_rls_exposure_fixes.sql` |
| Client storage | `localStorage` holds device preferences, caches, a push token and the notice dismissal. No session token, no password, no service key anywhere in `src/` |
| Website forms | `website/assets/site.js` never reports success on failure — "Nothing was sent" on validation, HTTP, or network failure. `support-request` is deployed and emails the operator, and tells the site when mail did *not* go |

## 6. Not verified, and why

- **The Netlify deploy.** No credentials in this environment; see B1(c). The generated
  output is verified by `scripts/deploy-web.cjs --dry-run` and `website.test.ts`.
- **Support email delivery.** `GMAIL_USER` / `GMAIL_APP_PASSWORD` are function secrets I
  cannot read, and proving delivery means filing a real request, which writes a row and
  emails a human. The code is right; confirm with `supabase secrets list` or one labelled
  test request.
- **Two screens were not photographed.** `/auth` and `/onboarding` report as "redirected
  to /" because the audit runs signed in. They are covered by tests (`authShell.test.ts`,
  i18n parity, legal/consent tests), not by a screenshot.
- **Anything behind a tap.** Open sheets, modals and menus are not in the automated
  sweep — it measures each route in its resting state.
- **Billing purchase flows**, per instruction: out of scope.
- `website/` and `webapp-clone/` are generated. `website/` was regenerated after the UI
  audit, as the repo's own workflow requires (`ui:check` rewrites the screenshots it
  embeds).
