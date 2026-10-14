# Push notifications — one-time setup

Push is wired end to end but **cannot deliver anything until a Firebase project
exists**. Nothing in the repository is configured for it, on purpose: the
service-account key is a credential and the four app-side values need a project
that does not exist yet. Until they are filled in the app builds, runs and
behaves exactly as it did before push existed — the settings screen says "this
build has no push delivery configured" rather than pretending a device is
registered.

## What is already in place

| Piece | Where |
| --- | --- |
| Runtime permission, channels, FCM token | `push/PushPlugin.kt` |
| Posting while the app is closed | `push/VayloMessagingService.kt` |
| Channel ids shared with JS | `push/PushChannels.kt` |
| Manifest entries | `AndroidManifest.xml` (`POST_NOTIFICATIONS`, the service) |
| Client registration | `src/lib/push.ts` |
| Registration + teardown on sign-in/out | `src/lib/push.ts`, wired into `NotificationPrefs.tsx` and `AuthContext.signOut` |
| Token storage + access rules | `supabase/migrations/20261004120000_push_tokens.sql` |
| The sender | `supabase/functions/push-notify/index.ts` |

## Turning it on

### 1. Firebase project

1. Create a project in the [Firebase console](https://console.firebase.google.com).
2. Add an **Android** app with package name `com.vaylosports.app` — it must
   match `applicationId` exactly or FCM rejects the token.
3. From the app's web config, put the four values into
   `android/app/src/main/res/values/vaylo_fcm.xml`:
   `google_app_id`, `api_key`, `project_id`, `gcm_sender_id`.
   These are public-by-design client identifiers; shipping them in the APK is
   how FCM works. The repo's `google-services.json` has them in it, so you can
   also copy the four strings straight out of it.
4. Download `google-services.json` and place it at `android/app/`. It is
   already handled by a guarded block in `android/app/build.gradle`, so the file
   being absent never breaks a build.

### 2. Function secrets

The sender uses FCM HTTP v1 and needs a **service account** (Project settings →
Service accounts → Generate new private key). Do not commit that key.

```bash
supabase secrets set \
  FCM_PROJECT_ID="your-project-id" \
  FCM_CLIENT_EMAIL="firebase-adminsdk-xxxxx@your-project.iam.gserviceaccount.com" \
  FCM_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n... \n-----END PRIVATE KEY-----\n"
```

The key comes back from Firebase with literal `\n` sequences. The function
un-escapes them, so paste it exactly as downloaded.

To check what is set, run:

```bash
npx --yes supabase secrets list --project-ref $(grep project_id supabase/config.toml | awk '{print $3}' | tr -d '"')
```

### 3. Deploy and run the migration

The `push-notify` function is deployed without a JWT check — only an
authenticated caller can use it, and even then an athlete can only target
themselves.

```bash
supabase db push
supabase functions deploy push-notify --no-verify-jwt=false
```

### 4. Verify

On a device with the app installed: **Settings → Notification settings → Turn on
notifications on this device**. The card flips to "This device is registered"
only when the plugin returned a token *and* `claim_push_token` stored it.

Then, from a signed-in session:

```bash
curl -X POST "$SUPABASE_URL/functions/v1/push-notify" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "apikey: $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"type":"streak_alert","title":"Test","body":"Push works."}'
```

An authenticated caller can only ever target itself. Sending to other athletes
requires a scheduled job invoking the function with the service-role key and
`user_ids`.

## What is not covered

* **Nothing has been run on a physical device.** Every check so far is a build,
  a typecheck and a test. FCM token issuance, channel behaviour on a real
  install and the OS permission dialog are all unverified on hardware.
* **Scheduled sends do not exist.** Streak alerts, challenge deadlines and
  re-engagement still need a cron/Edge Cron job to call `push-notify` with
  `user_ids`; the preference columns and the sender are ready for it.
* **iOS is not configured.** The schema accepts `platform = 'ios'` and the
  JS surface is platform-agnostic, but there is no APNs side yet.
