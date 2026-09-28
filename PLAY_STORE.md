# Google Play closed testing

Everything needed to get Vaylo Sports into a closed test track, in the order Play
Console asks for it. Written against the state of this repository, so where a value
is quoted — package name, version code, signing fingerprint — it came from the
files here rather than from memory.

Read §0 first: two decisions change what you answer in §4, and §"What only you can
provide" is the list of things that will stop you.

---

## Status

| | |
|---|---|
| Application ID | `com.vaylosports.app` |
| App name (target) | `VAYLO Sports` |
| minSdk / targetSdk | 26 (Android 8.0) / 36 |
| Version code / name | `2` / `1.1.0`, both overridable at build time |
| Release signing | Configured. Upload key `upload` in `android/upload-keystore.jks` |
| Upload key SHA-256 | `3B:E6:CD:40:CC:7F:21:5C:00:5D:94:32:58:7A:D8:51:89:17:1C:47:E8:53:F9:FA:EE:6B:BD:04:42:76:23:FD` |
| Upload key valid until | 2054-02-13 (Play requires validity past 2033) |
| Signed bundle in CI | `.github/workflows/android-release.yml` (manual or `v*` tag) |
| Privacy policy / terms / deletion pages | Written; published by the `legal` edge function |
| Store icon + feature graphic | Generated into `store/` |
| Screenshots | **Not yet captured** — see §6 |

---

## What only you can provide

Ordered by how early they block you.

1. **Legal entity name and a working support email.** `legal/operator.json` still
   holds `REPLACE_ME`. The `legal` function answers **503** until both are filled
   in, deliberately: a privacy policy that names the wrong company offers reviewers
   no way to make a data request, and publishing one is worse than being late. Fill
   it in, run `node scripts/gen-legal-pages.cjs`, redeploy.
   Also needed for the store listing itself, which requires a support email.
2. **A decision on target audience** — §0.
3. **A Play Console developer account.** Note the account *type*: personal,
   non-organisation accounts created after 13 November 2023 must run a closed test
   with **at least 12 testers for 14 continuous days** before they can even apply
   for production access. An organisation account has no such gate. If you have a
   registered business, the organisation route is materially faster.
4. **A demo account for the reviewer** (email + password), for the App access
   declaration in §4. The app is behind a login, so without this a reviewer sees
   the sign-in screen and nothing else.
5. **`OPENAI_API_KEY`** as a Supabase secret. Every AI feature returns HTTP 500 in
   production right now (`supabase/functions/_shared/openai.ts` throws
   `AI service is not configured`). A reviewer who tries the coach will see a
   failure. Set it with
   `supabase secrets set OPENAI_API_KEY=sk-...` — no redeploy needed.
6. **A real public URL for `VITE_PUBLIC_APP_URL`.** Unset, so share links, referral
   links and password-reset redirects point at `localhost`. Not a Play blocker, but
   it makes the app look broken in ways that are hard to explain in a review.

---

## 0. Two decisions before you fill any form

**a) Target audience.** Play's "Target audience and content" section decides both
your Data safety answers and whether the Families policy applies to you.

Vaylo Sports collects health data, sells credits with real money, and runs branded
sponsor placements. Recommended answer: **13 and over**, with no appeal to children,
and "not designed for families". Do not pick an under-13 band — that pulls in COPPA
and the Families policy, which this app is not built for.

The app now enforces the age half of that: creating an account requires ticking a
"**I am 13 or older**" box that links to the Terms and the Privacy Policy
(`src/pages/Auth.tsx`). There are still no *other* age gates, date of birth remains
optional, and under-18s are handled by suppressing sponsored content and capping
training loads — not by blocking them.

**b) Ads: yes or no.** There is no advertising SDK in this app — no AdMob, no
mediation, and no advertising identifier permission in the manifest. But the app
does show **labelled sponsor placements** to adults (`SPONSORSHIP.md`,
`brand_placements`), and Play counts sponsored or branded promotion as ads.
Recommended answer: **"Yes, my app contains ads."** Declaring "no ads" while the
app renders sponsor placements is a misrepresentation risk with no upside: the
declaration costs nothing, and getting it wrong is a policy strike.

---

## 1. Publish the legal pages

The pages are written, but living in `legal/` they are not yet reachable from a
URL, and Play will not let you finish the listing without one.

```bash
# 1. Fill in legal/operator.json (operatorName, contactEmail), then:
node scripts/gen-legal-pages.cjs

# 2. Publish them
supabase functions deploy legal --no-verify-jwt

# 3. Verify — expect HTTP 200 and real content, not the 503 notice
curl -sS -o /dev/null -w '%{http_code}\n' \
  "https://vvwhausdjzdmsyxekrcl.supabase.co/functions/v1/legal/privacy"

# 4. Set the same value where the app reads it, before building the APK/AAB
#    (optional once a real domain exists)
# VITE_LEGAL_BASE_URL=https://<host>/functions/v1/legal
```

These are the URLs to paste into Play Console:

| Play Console field | URL |
|---|---|
| Privacy policy (App content) | `…/functions/v1/legal/privacy` |
| Data deletion → URL | `…/functions/v1/legal/account-deletion` |

Why an edge function rather than a web host: this project has no public domain
yet — `vaylosports.com`, which the code defaults to elsewhere, does not resolve —
and Play will not publish a listing without a reachable policy URL. The same files
can be dropped onto any static host later; nothing in them refers to this host.

**`legal/` is not bundled into the app.** The in-app Privacy and Terms links in
Profile → Settings open these URLs in the in-app browser, so there is one copy of
each document and it cannot drift from what Play reviewed.

---

## 2. Build the signed bundle

Every upload needs a `versionCode` Play has never seen. The committed default is
`2`; bump it for each upload.

**Locally** (needs `android/keystore.properties`, which is git-ignored alongside
the keystore):

```bash
npm run build:native
npx cap sync android
cd android
./gradlew bundleRelease -PversionCode=3 -PversionName=1.2.0
# → app/build/outputs/bundle/release/app-release.aab
```

`bundleRelease` **fails on purpose** if signing is not configured, rather than
emitting an unsigned bundle Play would reject with a less useful message.

**In CI** (Settings → Secrets and variables → Actions → *Secrets*):

| Secret | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | `base64 -w0 android/upload-keystore.jks` |
| `ANDROID_KEYSTORE_PASSWORD` | `storePassword` from `android/keystore.properties` |
| `ANDROID_KEY_ALIAS` | `upload` |
| `ANDROID_KEY_PASSWORD` | `keyPassword` from `android/keystore.properties` |

Then run the **android-release** workflow with a version code and name. It runs
typecheck, lint and the test suite first, builds, and verifies the bundle is signed
with the Vaylo Sports key before uploading the artifact.

Keep the keystore and its passwords somewhere you will still have them in five
years. Losing an upload key is recoverable (Play Console can reset it) but tedious.

---

## 3. Create the app and upload

1. Play Console → **Create app**. Name `Vaylo Sports`, English (US), **App**, **Free**.
2. Before the first upload, Play asks for three declarations: Play policies
   (yes), US export laws (yes), and whether the app contains ads (§0b).
3. **Testing → Closed testing → Create track → Manage testers**, then
   **Create new release** and upload the `.aab`.
4. Accept Play App Signing. Our key is the *upload* key; Google holds the app
   signing key and can re-sign if the upload key is ever lost.
5. Write release notes (max 500 characters per language).
6. Add testers by email list or Google Group. Testers must accept the opt-in link
   on a device signed into that Google account.

Add **yourself first** and check the opt-in link works before inviting anyone else:
a broken opt-in link is the most common reason a closed test silently has no
testers.

---

## 4. App content declarations

Play Console → Policy → **App content**. Every row below must be complete before
the release can roll out; the ones marked ⚠ change what you can ship.

| Declaration | Answer |
|---|---|
| Privacy policy | The §1 URL |
| App access | **All functionality is not available without special access.** Provide the demo account from §"What only you can provide" as email + password. |
| Ads | Per §0b — recommended **Yes** |
| ⚠ Content rating | Fill in the IARC questionnaire honestly. There is **user-generated content** (posts, comments, community messages, DMs) and **social features** (friends, leaderboards, challenges) — both are mandatory disclosures. There are in-app purchases and **simulated rewards** (credits, coins). No violence, no sexual content, no gambling, no controlled substances. Expect a Teen-ish rating. |
| Target audience | Per §0a — recommended **13+**, not designed for families |
| ⚠ Health apps | **Yes** — see §7 |
| Data safety | §5 |
| Government apps | No |
| Financial features | No (credits are not a financial product; purchases run through Play Billing) |
| News apps | No |
| COVID-19 contact tracing | No |
| Data deletion | **Yes, my app allows users to request deletion** → `…/functions/v1/legal/account-deletion`. Deletion is in-app and immediate; the page documents the email route for people who no longer have the app, which Play requires. |

⚠ The **content rating** row is the one most likely to go wrong. User-generated
content and social features must be declared, and the app must have moderation
available. It does — there is reporting and admin tooling under `src/pages/Admin*`
— but check that a report actually reaches a human before you answer, because that
is the thing Play's reviewers ask about next.

---

## 5. Data safety

Answer from what the code does, not from what the marketing says. Verified in this
repository:

**Collected (and why):**

| Category | Data | Purpose |
|---|---|---|
| Personal info | Name, email, user IDs, date of birth (optional) | Account, app functionality |
| Health and fitness | Fitness info (workouts, distance, calories, steps), health info (heart rate, sleep) | App functionality |
| Financial info | Purchase history (credits, coins, subscription) | App functionality |
| Messages | In-app messages (coach chat, community, DMs) | App functionality |
| Photos and videos | Photos (profile, avatar), videos (form analysis uploads) | App functionality |
| App activity | App interactions, other user-generated content | App functionality, analytics? → **no**, there is no analytics SDK |

**Not collected:**

- **Location.** Worth stating explicitly because it is a plausible mistake: the
  app calls `navigator.geolocation` while a workout is tracking
  (`src/pages/Workouts.tsx`, `src/pages/Routines.tsx`) but stores only the derived
  distance in `workouts.distance_km`. Coordinates live in a `useRef` and are
  discarded. On Android it does not even get that far — the manifest declares **no
  location permission**, so GPS tracking is inert on the shipped app (see
  "Known gaps").
- **Payment info.** Handled entirely by Google Play.
- **Contacts, calendar, audio, files, web browsing, device or other IDs.** No SDK
  or permission touches any of these.

**Shared with third parties:** Yes — to OpenAI (text of AI features) and Google
(Gemini for video form analysis, Play Billing). Both must be declared as
processors with "app functionality" as the purpose. Sponsor partners receive
**aggregate counts only**; no personal or health data (`brand_metrics` has no
user-identifying column). Do not declare them as recipients of personal data.

Also declare: data is **encrypted in transit**, and users **can request deletion**
(the in-app flow, and the §1 URL).

---

## 6. Store listing

Required assets, and where they are:

| Asset | Spec | Status |
|---|---|---|
| App icon | 512×512 PNG, 32-bit, ≤1 MB | `store/icon-512.png` (75 KB) |
| Feature graphic | 1024×500 JPEG or 24-bit PNG, no alpha | `store/feature-graphic-1024x500.jpg` (50 KB) |
| Phone screenshots | 2–8, 16:9 or 9:16, 320–3840 px | **Not done** |
| App name | ≤30 chars | `Vaylo Sports` |
| Short description | ≤80 chars | **Write it** |
| Full description | ≤4000 chars | **Write it** |

Regenerate the two images with:

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/gen-store-assets.ps1
```

The icon is rendered from `ic_launcher.png` — the launcher artwork, so the store
icon and the home screen agree. It is a 192 px source upscaled to 512; the design
is flat (761 distinct colours), so it holds up, but a vector or 1024 px export
would replace it cleanly if the brand is ever redrawn.

**Screenshots** are captured from the running app rather than generated:

```bash
adb shell screencap -p /sdcard/shot.png && adb pull /sdcard/shot.png store/screenshots/
```

Capture at least four: the Today/Hub screen, the coach or a training plan, a
progress chart, and the market or an event. Take them on a **wide** phone profile
(1080×2340 is fine) and avoid showing real personal data — use the demo account.

---

## 7. Health apps declaration

Because the app requests Health Connect permissions, Play requires an approved
**Health apps** declaration (App content → Health apps). Complete it before
rollout; the release cannot go out while it is outstanding.

Declare at minimum:

- **Health Connect** as the data source, with the six record types the manifest
  asks for: exercise, distance, total calories burned, heart rate, steps, sleep.
- **Fitness and wellness** as the feature type.
- That the purpose is training and recovery guidance, not diagnosis or treatment.

Two things already in place that this form depends on:

- **The permission rationale page.** `public/health-rationale.html` explains each
  record type, what happens to it, and how to revoke access. Android routes the
  Android 13 rationale intent and the Android 14 `VIEW_PERMISSION_USAGE` intent
  there (`MainActivity.onNewIntent`); without that it would open the app on
  whatever screen was last shown, which fails the requirement.
- **Read-only access.** The manifest requests no Health Connect write permission,
  and the app has no path to write to it.

Health Connect itself supports Android 8+ at the SDK level, so `minSdk 26` is
correct as it stands — but note that the Health Connect *app* only runs on
Android 9+, so on Android 8 there is nothing to connect to.

---

## 8. Play Billing

Purchases cannot be tested in a closed track until this is done, and the app
currently cannot verify any purchase because the server side is unconfigured
(`PAYMENT_MODE` is set but the Google credentials are not).

1. Play Console → **Monetise → Products** → create the in-app products and
   subscriptions the app sells. The catalogue is generated: read the ids from
   `supabase/functions/_shared/moneyCatalog.ts` and the subscription ids from the
   pricing config, and do not invent new ones — the app grants only what it can
   look up by id.
2. Play Console → **Setup → API access** → create a service account, grant it
   *Financial data* → *View financial data*, and download its JSON key.
3. Set the secrets the verifier needs:

   ```bash
   supabase secrets set \
     GOOGLE_SERVICE_ACCOUNT_EMAIL=... \
     GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n" \
     GOOGLE_ANDROID_PACKAGE_NAME=com.vaylosports.app
   ```

4. Add testers to **License testing** (Setup → License testing) so purchases are
   free and can be repeated.
5. Set `PAYMENT_MODE=store` when you are ready to verify real purchases;
   `PAYMENT_MODE=test` keeps the test path.

Event Packs are currently bought with **credits**, not cash, so they work in a
closed test today without any of the above. Credits themselves cannot be bought
until Billing is configured — testers will see the purchase fail.

---

## 9. Roll out

1. Complete every row in §4 — Play blocks the rollout with a checklist.
2. Upload the bundle (§2), write release notes, review, **Start rollout**.
3. Add testers, then have each one open the opt-in link and install from Play.
4. Watch **Quality → Android vitals** for crashes during the test. A closed test
   is where a crash-only-on-a-real-device shows up.

If it is your first release, expect **1–7 days** for review of a closed test.

---

## 10. Version discipline

- Never reuse a `versionCode`. Play rejects the whole upload.
- Bump `versionCode` per upload (`-PversionCode=`); only bump the `versionName`
  default in `android/app/build.gradle` when it is worth a commit.
- Keep the upload key and its passwords backed up. If you lose them, Play Console
  → Test and release → Setup → App signing → *Request upload key reset*.
- The `.aab` is **not** in git (`android/.gitignore` excludes `*.aab`), and neither
  is the web bundle under `android/app/src/main/assets/public`, because
  `npx cap sync` regenerates it from `dist/`.

---

## Known gaps

These are not Play blockers, but they are real and they will surface in a review
if a tester goes looking.

1. **GPS tracking does nothing on Android.** `Workouts.tsx` and `Routines.tsx` call
   `navigator.geolocation`, but the manifest declares no location permission, so the
   call fails and the button is inert. Either accept it (and consider hiding the
   button on Android, as the copy now says "distance only") or add
   `ACCESS_FINE_LOCATION` plus a WebView geolocation grant — the second also means
   declaring location in the Data safety form.
2. **AI features return HTTP 500 in production** until `OPENAI_API_KEY` is set.
3. **Wearable sync is unconfigured.** `wearable-oauth` answers `not_configured` for
   every provider because no vendor OAuth secrets are set. The screen is honest
   about it, but it is a headline feature that does not work.
4. **Share and reset links point at `localhost`** until `VITE_PUBLIC_APP_URL` is set.
5. **Password-reset email delivery** depends on Supabase's SMTP configuration; the
   built-in sender is rate-limited and unsuitable for real users.
