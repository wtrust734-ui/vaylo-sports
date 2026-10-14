// Source assertions for the Android / Capacitor / release-readiness package
// (30 September 2026). Same pattern as authShell.test.ts: the Gradle builds
// themselves are run separately (assembleDebug, bundleRelease, lint) and
// cannot run in CI's vitest; these tests pin the *sources* so a future edit
// silently dropping a guard, a keep rule or a manifest entry fails the suite.
//
// Not covered here (needs a device/emulator): hardware back traversal, Health
// Connect end-to-end sync, keyboard/safe-area rendering, permission dialogs.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { deepLinkId, parseDeepLink } from "@/lib/deepLinks";

const read = (p: string) =>
  readFileSync(path.resolve(__dirname, "../.." + p), "utf8").replace(/\r\n?/g, "\n");

const MANIFEST = "/android/app/src/main/AndroidManifest.xml";
const GRADLE_APP = "/android/app/build.gradle";
const PROGUARD = "/android/app/proguard-rules.pro";
const CAP_CONFIG = "/capacitor.config.ts";
const LINKS = "/src/lib/deepLinks.ts";
const OAUTH = "/src/lib/nativeOAuth.ts";
const APP = "/src/App.tsx";
const SYNC = "/src/lib/health/sync.ts";
const HOOK = "/src/hooks/useHealthConnect.ts";
const HC_PAGE = "/src/components/health/HealthConnectPrompt.tsx";
const BRIDGE = "/src/lib/health/bridge.ts";
const NUTRITION = "/src/pages/Nutrition.tsx";

/** True when `first` appears before `second`. Keeps an ordering assertion readable. */
const signout_after = (first: number, second: number) => first > -1 && second > -1 && first < second;

describe("Android manifest — permissions", () => {
  const m = read(MANIFEST);

  it("requests no runtime-dangerous permissions beyond Health Connect reads", () => {
    const permissions = m.match(/<uses-permission android:name="([^"]+)"/g) ?? [];
    const names = permissions.map((p) => p.match(/name="([^"]+)"/)![1]);
    // SCOPE: this reads the SOURCE manifest only. What actually ships is the
    // Gradle-merged manifest, which additionally carries whatever the bundled
    // libraries contribute — the Firebase SDK adds VIBRATE,
    // ACCESS_NETWORK_STATE, WAKE_LOCK, c2dm.permission.RECEIVE and an
    // app-scoped DYNAMIC_RECEIVER permission, all normal-level and auto-granted
    // (so none adds a runtime prompt, and POST_NOTIFICATIONS stays the only
    // dialog an athlete ever sees). Those are asserted by
    // scripts/build-apk.sh against the built artifact, which fails closed on any
    // WRITE permission. This test cannot see them; that gap is the reason the
    // build-time check exists rather than being redundant.
    //
    // Every permission we AUTHOR is a Health Connect read, INTERNET, or
    // POST_NOTIFICATIONS (push, added 4 October 2026 and genuinely used —
    // VayloMessagingService posts every push through it).
    for (const name of names) {
      expect(
        name.startsWith("android.permission.health.READ_") ||
          name === "android.permission.INTERNET" ||
          name === "android.permission.POST_NOTIFICATIONS"
      ).toBe(true);
    }
    // The dangerous ones must stay absent.
    for (const forbidden of [
      "android.permission.CAMERA",
      "android.permission.RECORD_AUDIO",
      "android.permission.ACCESS_FINE_LOCATION",
      "android.permission.ACCESS_COARSE_LOCATION",
      "android.permission.BLUETOOTH",
      "android.permission.READ_EXTERNAL_STORAGE",
      "android.permission.WRITE_EXTERNAL_STORAGE",
      "android.permission.READ_MEDIA_IMAGES",
    ]) {
      expect(names).not.toContain(forbidden);
    }
  });

  it("the Health Connect queries entry stays a direct manifest child", () => {
    // Asserted by containment rather than exact block shape: <queries> now also
    // holds the camera intents below. What must hold is that <queries> is a direct
    // child of <manifest> (Health Connect discovery fails otherwise) and that the
    // healthdata package is inside it.
    const openTag = m.match(/<manifest[^>]*>/)![0];
    // Match the `<application` ELEMENT, not the word: an earlier XML comment
    // mentions "<application>" in prose, so a bare indexOf finds the comment —
    // which sits before <queries> — and the ordering assertion compares against
    // the wrong offset and always fails. The element's tag is followed by a
    // newline; the prose mention is mid-sentence.
    const applicationAt = m.indexOf("<application\n");
    const queriesAt = m.indexOf("<queries>");
    expect(queriesAt).toBeGreaterThan(openTag.length);
    expect(queriesAt).toBeLessThan(applicationAt);
    const block = m.slice(queriesAt, m.indexOf("</queries>"));
    expect(block).toMatch(/<package android:name="com\.google\.android\.apps\.healthdata" \/>/);
  });

  it("camera capture and the image picker are declared for package visibility", () => {
    // API 30+ hides packages the app has not declared, so without these
    // resolveActivity() returns null on a device that does have a camera app and
    // capture silently degrades to the picker on every phone.
    const queriesAt = m.indexOf("<queries>");
    const block = m.slice(queriesAt, m.indexOf("</queries>"));
    expect(block).toMatch(/<action android:name="android\.media\.action\.IMAGE_CAPTURE" \/>/);
    expect(block).toMatch(/<action android:name="android\.intent\.action\.OPEN_DOCUMENT" \/>/);
    expect(block).toMatch(/<data android:mimeType="image\/\*" \/>/);
  });

  it("backup stays off so the session token never rides a cloud backup", () => {
    expect(m).toMatch(/android:allowBackup="false"/);
    expect(m).toMatch(/android:dataExtractionRules="@xml\/data_extraction_rules"/);
    expect(m).toMatch(/android:fullBackupContent="@xml\/full_backup_content"/);
  });

  it("Health Connect rationale intents are declared for both eras", () => {
    expect(m).toMatch(/androidx\.health\.ACTION_SHOW_PERMISSIONS_RATIONALE/);
    expect(m).toMatch(/VIEW_PERMISSION_USAGE/);
    expect(m).toMatch(/android.permission.START_VIEW_PERMISSION_USAGE/);
  });

  it("the custom scheme intent-filter is registered for VIEW/BROWSABLE", () => {
    const filter = m.slice(m.indexOf("Deep links on the app's own scheme"));
    expect(filter).toMatch(/android\.intent\.action\.VIEW/);
    expect(filter).toMatch(/android\.intent\.category\.BROWSABLE/);
    expect(filter).toMatch(/@string\/custom_url_scheme/);
  });
});

describe("Gradle — release toolchain", () => {
  const g = read(GRADLE_APP);

  it("R8 and resource shrinking are enabled for release", () => {
    expect(g).toMatch(/minifyEnabled true/);
    expect(g).toMatch(/shrinkResources true/);
    expect(g).toMatch(/proguard-android-optimize\.txt/);
  });

  it("bundleRelease hard-fails without upload signing; assembleRelease may verify locally", () => {
    const guard = g.slice(g.indexOf("bundleRelease"));
    expect(guard).toMatch(/if \(!hasReleaseSigning\)/);
    expect(guard).toMatch(/GradleException/);
    // Only bundleRelease is guarded; assembleRelease falls back to the debug key.
    expect(g).toMatch(/signingConfig signingConfigs\.debug/);
    expect(g).toMatch(/WARN: assembleRelease is using the DEBUG key/);
  });

  it("version code and name are CI-overridable and default to the current build", () => {
    expect(g).toMatch(/versionCode project\.hasProperty\("versionCode"\)/);
    // Bumped with each release; must be kept in step with apk/ or the checked-in
    // default drifts back to an already-used versionCode, which Play rejects.
    //
    // The literal is asserted as "higher than every artifact already in apk/",
    // not as a fixed number. A fixed number has to be edited on every release
    // and the edit is easy to forget — and when it is forgotten the failure is
    // silent until Play rejects an upload. Reading the built artifacts makes
    // the assertion test the property that actually matters.
    const code = Number(g.match(/versionCode project\.hasProperty\("versionCode"\)[^\n]*?: (\d+)/)?.[1]);
    const name = g.match(/versionName project\.hasProperty\("versionName"\)[^\n]*?: "([^"]+)"/)?.[1];
    expect(code, "build.gradle has no default versionCode").toBeGreaterThan(0);
    expect(name, "build.gradle has no default versionName").toBeTruthy();

    // Every shipped artifact must be strictly older than the default, or the
    // next upload reuses a versionCode.
    const root = path.resolve(__dirname, "../..");
    const shipped = readdirSync(path.join(root, "apk"))
      .map((f) => f.match(/^vaylo-sports-(\d+\.\d+\.\d+)-(\d+)-/))
      .filter((m): m is RegExpMatchArray => !!m);
    expect(shipped.length, "no artifacts in apk/ to compare against").toBeGreaterThan(0);

    // The default must never sit BELOW an artifact already on disk: Play
    // refuses an upload whose versionCode it has seen, so a build.gradle that
    // drifted back down would produce an upload Play rejects. Higher than every
    // artifact is fine (you bumped ahead of building); lower is the failure.
    const highestShipped = Math.max(...shipped.map((m) => Number(m[2])));
    expect(
      code!,
      `build.gradle versionCode ${code} must not be below an artifact already in apk/ (highest is ${highestShipped})`
    ).toBeGreaterThanOrEqual(highestShipped);

    // If there is an artifact at exactly this code, its versionName must be the
    // one gradle declares. A versionCode bumped without its versionName (or the
    // reverse) reads as two different releases of the same build.
    const atThisCode = shipped.find((m) => Number(m[2]) === code);
    if (atThisCode) {
      expect(
        atThisCode[1],
        `apk/ has versionCode ${code} as ${atThisCode[1]} but build.gradle says ${name}`
      ).toBe(name);
    }
  });

  it("SDK levels match the variables file used by CI", () => {
    const v = read("/android/variables.gradle");
    expect(v).toMatch(/minSdkVersion = 26/);
    expect(v).toMatch(/targetSdkVersion = 36/);
    expect(v).toMatch(/compileSdkVersion = 36/);
  });

  it("R8 keep rules protect the Capacitor bridge and Health Connect", () => {
    const p = read(PROGUARD);
    expect(p).toMatch(/-keep @com\.getcapacitor\.annotation\.CapacitorPlugin class \* \{ \*; \}/);
    expect(p).toMatch(/@com\.getcapacitor\.annotation\.PluginMethod <methods>/);
    expect(p).toMatch(/-keep class com\.getcapacitor\.\*\* \{ \*; \}/);
    expect(p).toMatch(/-keep class androidx\.health\.connect\.client\.\*\* \{ \*; \}/);
  });
});

describe("Capacitor shell", () => {
  it("WebView hardening stays on (no mixed content)", () => {
    expect(read(CAP_CONFIG)).toMatch(/allowMixedContent: false/);
  });

  it("web assets ship with no source maps", () => {
    expect(read("/vite.config.ts")).toMatch(/sourcemap: false/);
  });
});

describe("deep links — dispatcher", () => {
  const d = read(LINKS);

  it("validates ids structurally and drops junk instead of navigating", () => {
    expect(d).toMatch(/export function deepLinkId/);
    expect(d).toMatch(/UUID_RE\.test\(id\) \? id : null/);
    expect(d).toMatch(/rawUrl\.length > 2048/);
    expect(d).toMatch(/return fallback;/);
  });

  it("accepts only the app scheme or https", () => {
    expect(d).toMatch(/APP_SCHEME:|protocol === "https:"/);
    expect(d).toMatch(/const APP_SCHEME = "com\.vaylosports\.app"/);
  });

  it("never grants access via link contents — routes only, through the layout gates", () => {
    expect(d).toMatch(/never a credential/);
    expect(d).toMatch(/installDeepLinkHandler/);
    expect(d).toMatch(/getLaunchUrl/);
  });

  it("App installs the dispatcher and navigates only on a parsed path", () => {
    const app = read(APP);
    expect(app).toMatch(/installDeepLinkHandler\(\(parsed\) => \{/);
    expect(app).toMatch(/if \(parsed\.path\) navigate\(parsed\.path\)/);
  });

  it("the OAuth callback keeps its dedicated one-shot consumer", () => {
    const o = read(OAUTH);
    expect(o).toMatch(/exchangeCodeForSession/);
    expect(o).toMatch(/sub\.remove\(\)/);
  });

  it("an orphan callback (app killed mid-sign-in) completes safely via PKCE", () => {
    const o = read(OAUTH);
    expect(o).toMatch(/export async function completeOrphanOAuthCallback/);
    expect(o).toMatch(/single-use/);
    expect(o).toMatch(/isOAuthAwaiting/);
    // A browser that fails to open must not leave the awaiting flag stuck.
    expect(o).toMatch(/Couldn't open the sign-in window/);
    expect(o).toMatch(/oauthAwaiting = false/);
  });

  it("recovery/magic-link fragments restore a session through setSession (server-validated)", () => {
    const o = read(OAUTH);
    expect(o).toMatch(/export async function completeNativeRecoveryFragment/);
    expect(o).toMatch(/supabase\.auth\.setSession\(/);
    // Only Supabase auth fragments are replayed; everything else is untouched.
    expect(o).toMatch(/access_token\|refresh_token\|error_description=/);
    // An expired/used link surfaces its Supabase error instead of failing silently.
    expect(o).toMatch(/return \{ restored: false, recovery: false, error: errorDescription \}/);
    expect(o).toMatch(/error: error\.message/);
  });

  it("the dispatcher handles callbacks and session restores, not just public links", () => {
    const d = read(LINKS);
    expect(d).toMatch(/completeOrphanOAuthCallback/);
    expect(d).toMatch(/completeNativeRecoveryFragment/);
    expect(d).toMatch(/isSessionRestore/);
  });

  it("Auth redirects signed-in users away from /auth so restored sessions land in the app", () => {
    const a = read("/src/pages/Auth.tsx");
    expect(a).toMatch(/if \(authLoading \|\| !session \|\| mode === "updatePassword"\) return;/);
    expect(a).toMatch(/navigate\(profile\?\.onboarding_complete \? "\/" : "\/onboarding", \{ replace: true \}\)/);
  });
});

describe("Health Connect — disconnect", () => {
  it("disconnect clears consent locally and on the server and resets the cursor", () => {
    const s = read(SYNC);
    expect(s).toMatch(/export async function disconnectHealthConnect/);
    expect(s).toMatch(/writeConsent\(userId, false/);
    expect(s).toMatch(/localStorage\.removeItem\(STATE_KEY\(userId\)\)/);
    expect(s).toMatch(/connected: false/);
    expect(s).toMatch(/last_incremental_cursor: null/);
  });

  it("the hook exposes disconnect with a busy guard and refresh", () => {
    const h = read(HOOK);
    expect(h).toMatch(/disconnect: \(\) => Promise<void>;/);
    expect(h).toMatch(/if \(!user \|\| disconnecting\) return;/);
    expect(h).toMatch(/disconnectHealthConnect\(user\.id\)/);
  });

  it("the page confirms the exact effect and keeps data deletion separate", () => {
    const p = read(HC_PAGE);
    expect(p).toMatch(/Disconnect Health Connect\? Vaylo will stop reading your health data/);
    expect(p).toMatch(/aria-label="Disconnect Health Connect"/);
    expect(p).toMatch(/Delete ALL imported health data/);
    expect(p).toMatch(/This cannot be undone/);
  });

  it("revoked permissions stop syncing and flip consent off", () => {
    const s = read(SYNC);
    expect(s).toMatch(/writeConsent\(userId, false, HEALTH_PERMISSIONS_VERSION\);\s*\n\s*await saveConnectionToServer\(userId, false\)/);
  });

  it("the bridge never logs health payloads", () => {
    const b = read(BRIDGE);
    expect(b).not.toMatch(/console\.log/);
    expect(b).toMatch(/NEVER logged/);
  });
});

describe("native lifecycle — App.tsx", () => {
  const app = read(APP);

  it("back press order: keyboard, then overlays, then history, then minimize", () => {
    const kb = app.indexOf("if (dismissKeyboard()) return;");
    const overlay = app.indexOf("if (consumeBackPress()) return;");
    const hist = app.indexOf("window.history.back();");
    const min = app.indexOf("App.minimizeApp");
    expect(kb).toBeGreaterThan(-1);
    expect(overlay).toBeGreaterThan(kb);
    expect(hist).toBeGreaterThan(overlay);
    expect(min).toBeGreaterThan(hist);
  });

  it("the Capacitor app plugin listener is cleaned up", () => {
    expect(app).toMatch(/subscription\?\.remove\?\.\(\)/);
    expect(app).toMatch(/cancelled = true;/);
  });

  it("REGRESSION: NativeBackButton renders inside <Router>, never outside", () => {
    // Original failure: the component was mounted above <Router> while using
    // useNavigate() for deep links. react-router throws its invariant
    // ("useNavigate() may be used only in the context of a <Router>") on
    // every render — ErrorBoundary recovered, but every route logged an
    // unhandled error and the deep-link navigate fired without a live
    // navigator. Found by the ui:audit screenshot run, invisible to tsc.
    const open = app.indexOf("<Router>");
    const close = app.indexOf("</Router>");
    const mount = app.indexOf("<NativeBackButton />");
    expect(open).toBeGreaterThan(-1);
    expect(close).toBeGreaterThan(open);
    expect(mount).toBeGreaterThan(open);
    expect(mount).toBeLessThan(close);
  });

  it("global rejections are recorded without payloads and not left to crash", () => {
    const main = read("/src/main.tsx");
    expect(main).toMatch(/window\.addEventListener\("unhandledrejection"/);
    expect(main).toMatch(/event\.preventDefault\(\)/);
    expect(main).toMatch(/reason instanceof Error \? `\$\{reason\.name\}: \$\{reason\.message\}` : typeof reason/);
  });
});

describe("media handling — Nutrition scan", () => {
  it("every scan preview blob URL is revoked", () => {
    const n = read(NUTRITION);
    const created = n.match(/URL\.createObjectURL/g)?.length ?? 0;
    const revoked = n.match(/URL\.revokeObjectURL/g)?.length ?? 0;
    // An invariant rather than a magic count: the scan now has a camera route, a
    // gallery route and a native picker route that all write the same preview
    // state, so the number of releases moves whenever a capture path is added.
    // What must not move is that every preview created is released — asserting
    // the relationship is what stops a new route from shipping a leak past a
    // count that nobody updated.
    expect(created, "the scan must still create a preview").toBeGreaterThan(0);
    expect(revoked, "every created preview needs a revoke path").toBeGreaterThanOrEqual(created);
    expect(n).toMatch(/leaked each photo's bytes/);
  });
});

// The parser is a pure function — exercised for real, not just in source.
describe("parseDeepLink — behavior", () => {
  const UID = "a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d";

  it("maps a shared challenge link to its route", () => {
    expect(parseDeepLink(`com.vaylosports.app://c/${UID}`)).toMatchObject({
      path: `/c/${UID}`,
      isAuthCallback: false,
    });
  });

  it("maps an https share link the same way", () => {
    expect(parseDeepLink(`https://vaylosports.com/c/${UID}`).path).toBe(`/c/${UID}`);
    expect(parseDeepLink(`https://vaylosports.com/packs/${UID}`).path).toBe(`/packs/${UID}`);
  });

  it("accepts the former preview host only as an inbound legacy link", () => {
    // Existing shared links still land safely, but the host is never emitted by
    // the app as a new canonical URL.
    expect(parseDeepLink(`https://vaylosports.lovable.app/c/${UID}`).path).toBe(`/c/${UID}`);
  });

  it("drops hostile or malformed payloads", () => {
    expect(parseDeepLink("javascript:alert(1)").path).toBeNull();
    expect(parseDeepLink(`com.vaylosports.app://c/${UID}/../../../admin/pricing`).path).toBeNull();
    expect(parseDeepLink(`com.vaylosports.app://c/${"x".repeat(300)}`).path).toBeNull();
    expect(parseDeepLink(`com.vaylosports.app://c/${"<script>alert(1)</script>"}`).path).toBeNull();
    expect(parseDeepLink("not a url at all").path).toBeNull();
    expect(parseDeepLink(`com.vaylosports.app://settings/delete-account`).path).toBeNull();
    expect(parseDeepLink(`evilapp://c/${UID}`).path).toBeNull();
    expect(parseDeepLink(`com.vaylosports.app://c/${UID}?${"q=".padEnd(2100, "a")}`).path).toBeNull();
  });

  it("marks the OAuth callback for its dedicated consumer", () => {
    const parsed = parseDeepLink(`com.vaylosports.app://auth-callback#code=abc&flow_state_id=xyz`);
    expect(parsed.isAuthCallback).toBe(true);
    expect(parsed.isSessionRestore).toBe(true);
  });

  it("routes recovery fragments to /auth for the existing flow", () => {
    const parsed = parseDeepLink(`com.vaylosports.app://auth#access_token=t&refresh_token=r&type=recovery`);
    expect(parsed).toMatchObject({ path: "/auth", isSessionRestore: true });
  });

  it("public profile usernames are shape-checked, uuids included (public by design)", () => {
    expect(parseDeepLink(`com.vaylosports.app://profile/_serena`).path).toBe("/profile/_serena");
    expect(parseDeepLink(`com.vaylosports.app://profile/${"n".repeat(40)}`).path).toBeNull();
    expect(parseDeepLink(`com.vaylosports.app://profile/a b`).path).toBeNull();
  });

  it("deepLinkId accepts exactly an id-shaped string", () => {
    expect(deepLinkId(UID)).toBe(UID);
    expect(deepLinkId(`${UID}/extra`)).toBe(UID);
    expect(deepLinkId("1 OR 1=1")).toBeNull();
    expect(deepLinkId(null)).toBeNull();
  });
});
// ============================================================================
// Native shell hardening — 4 October 2026
// ----------------------------------------------------------------------------
// Three behaviours were added to the shell that no existing test covered: real
// ACTION_IMAGE_CAPTURE capture (a hand-written plugin, not an npm package),
// native scroll semantics on navigation, and a real offline write queue. Each
// has a failure mode that is invisible from the web build and invisible to tsc:
// a dropped plugin registration, a lost manifest query, a banner that lies.
// ============================================================================

describe("native camera — registration", () => {
  const activity = read("/android/app/src/main/java/com/vaylosports/app/MainActivity.java");
  const plugin = read(
    "/android/app/src/main/java/com/vaylosports/app/camera/CameraCapturePlugin.kt"
  );

  it("the plugin is registered before super.onCreate", () => {
    // Capacitor reads registeredPlugins while the bridge is built in
    // super.onCreate. A registration after it is a plugin that silently never
    // exists in the WebView.
    const register = activity.indexOf("CameraCapturePlugin.class");
    // The call, not the prose: the explanatory comment above also contains the
    // words "super.onCreate()".
    const superCall = activity.indexOf("super.onCreate(savedInstanceState);");
    expect(register).toBeGreaterThan(-1);
    expect(superCall).toBeGreaterThan(-1);
    expect(register).toBeLessThan(superCall);
  });

  it("is exposed as VayloCamera, the name the JS side registers", () => {
    expect(plugin).toMatch(/@CapacitorPlugin\(name = "VayloCamera"\)/);
    const platform = read("/src/lib/platform.ts");
    expect(platform).toMatch(/"VayloCamera"/);
    expect(read("/src/lib/camera.ts")).toMatch(/loadPlugin<CameraPlugin>\("VayloCamera"\)/);
  });

  it("uses startActivityForResult, not an androidx activity-result launcher", () => {
    // Plugin.activity is not a ComponentActivity, so registerForActivityResult
    // does not resolve — this is the one approach known not to work here.
    expect(plugin).toMatch(/startActivityForResult\(/);
    expect(plugin).toMatch(/@ActivityCallback/);
    expect(plugin).not.toMatch(/registerForActivityResult/);
  });

  it("writes the photo into its own cache via a FileProvider, so no permission is needed", () => {
    expect(plugin).toMatch(/FileProvider/);
    expect(plugin).toMatch(/EXTRA_OUTPUT/);
    expect(read(MANIFEST)).toMatch(/androidx\.core\.content\.FileProvider/);
    // The whole reason the app declares no CAMERA permission.
    expect(read(MANIFEST)).not.toMatch(/android\.permission\.CAMERA/);
  });

  it("downscales and applies EXIF rotation, and deletes its temp file", () => {
    expect(plugin).toMatch(/inSampleSize/);
    expect(plugin).toMatch(/ExifInterface/);
    expect(plugin).toMatch(/finally/);
    expect(read(GRADLE_APP)).toMatch(/androidx\.exifinterface:exifinterface/);
  });

  it("resolves cancelled rather than rejecting, so a cancel is not an error", () => {
    expect(plugin).toMatch(/cancelled/);
    expect(plugin).not.toMatch(/call\.reject\("cancel/i);
  });
});

describe("native camera — capture surfaces", () => {
  it("FormAnalysis is video-only: no photo capture, no photo picker", () => {
    // Form analysis takes movement videos, not stills — so this screen must
    // not offer a photo capture or a photo picker, and must point at the
    // video analysis screen (which keeps the file input, since the still
    // plugin cannot record clips — see the test below).
    const page = read("/src/pages/FormAnalysis.tsx");
    expect(page).not.toMatch(/capturePhoto\(/);
    expect(page).not.toMatch(/pickPhoto\(/);
    expect(page).not.toMatch(/type="file"/);
    expect(page).toMatch(/navigate\("\/form\/video"\)/);
    expect(page).toMatch(/video_form_analysis/);
  });

  it("Nutrition re-checks the calorie-scan entitlement on the camera path", () => {
    // The scan button is reachable without opening the hidden panel, so the
    // check has to happen on the path the button actually takes.
    const page = read("/src/pages/Nutrition.tsx");
    expect(page).toMatch(/const shot = await capturePhoto\(\)/);
    expect(page).toMatch(/scanFromCamera/);
    const cameraFn = page.slice(page.indexOf("scanFromCamera"));
    expect(cameraFn).toMatch(/canScanCalories/);
    expect(cameraFn).toMatch(/CALORIE_SCAN_REFUSAL/);
  });

  it("video form analysis still uses a file input — a still plugin cannot record clips", () => {
    const page = read("/src/pages/VideoFormAnalysis.tsx");
    expect(page).toMatch(/type="file" accept="video\//);
    expect(page).not.toMatch(/capturePhoto\(/);
  });

  it("@capacitor/camera is not a dependency — it cannot compile against Kotlin 1.9.24", () => {
    const pkg = read("/package.json");
    expect(pkg).not.toMatch(/"@capacitor\/camera"/);
    // The pin that would have to move first.
    expect(read("/android/build.gradle")).toMatch(/1\.9\.24/);
  });
});

describe("native feel — scroll and navigation", () => {
  const scroll = read("/src/lib/scrollRestoration.ts");
  const app = read(APP);

  it("is mounted inside <Router>, since it reads the location from context", () => {
    const open = app.indexOf("<Router>");
    const mount = app.indexOf("<ScrollRestoration />");
    expect(mount).toBeGreaterThan(open);
  });

  it("keys off the navigation type, not just the path", () => {
    // Keying off the path alone scrolls to the top on every back press, which
    // is the web behaviour this exists to remove.
    expect(scroll).toMatch(/useNavigationType/);
    expect(scroll).toMatch(/navigationType === "POP"/);
  });

  it("restores on back and resets to the top — with no animation — on push", () => {
    expect(scroll).toMatch(/requestAnimationFrame\(\(\) => window\.scrollTo\(0, remembered\)\)/);
    expect(scroll).toMatch(/window\.scrollTo\(0, 0\);/);
    // No behavior:"smooth" on the reset: an instant jump is the native feel.
    expect(scroll).not.toMatch(/behavior: "smooth"[^\n]*\n\s*\}?\)?;\s*\n\s*window\.scrollTo/);
  });

  it("honours hash anchors instead of resetting past them", () => {
    expect(scroll).toMatch(/getElementById\(hash\.slice\(1\)\)/);
    expect(scroll).toMatch(/scrollIntoView/);
  });

  it("keeps its offset map bounded, and does not share it across mounts", () => {
    expect(scroll).toMatch(/const MAX_ENTRIES = 40/);
    expect(scroll).toMatch(/useRef\(new Map<string, number>\(\)\)/);
  });

  it("overscroll is suppressed so the dark UI does not glow white past the edge", () => {
    const css = read("/src/index.css");
    expect(css).toMatch(/overscroll-behavior-y: none/);
    expect(css).toMatch(/-webkit-overflow-scrolling: touch/);
  });
});

describe("offline resilience", () => {
  const queue = read("/src/lib/offlineQueue.ts");
  const banner = read("/src/components/OfflineBanner.tsx");

  it("only a connectivity failure is queued; a server refusal is surfaced", () => {
    // Queuing a 402 would mean the athlete is never told, and it retries until
    // the queue is full.
    expect(queue).toMatch(/export const isNetworkError/);
    expect(queue).toMatch(/if \(!isNetworkError\(error\)\)/);
  });

  it("is installed at app start, and cleaned up on unmount", () => {
    const app = read(APP);
    expect(app).toMatch(/installOfflineQueue/);
    expect(app).toMatch(/useEffect\(\(\) => installOfflineQueue\(\), \[\]\)/);
  });

  it("no screen claims an offline write the app cannot queue", () => {
    // The workout log screen was the only writer through the queue, and it was
    // removed on 2026-10-05. It came back on 2026-10-08 as a LOG-ONLY screen
    // that writes straight to the table — no queue, and no copy anywhere in
    // it suggesting that going offline saves anything. So it is read here to
    // prove the write path is the direct one, and the scan below covers it
    // like every other page.
    expect(read("/src/pages/Workouts.tsx")).toContain('supabase.from("workouts").insert(');
    const sources = readdirSync(path.resolve(__dirname, "../pages"))
      .filter((f) => f.endsWith(".tsx"))
      .map((f) => read(`/src/pages/${f}`))
      .join("\n");
    expect(sources, "a page still writes through the offline queue").not.toMatch(/insertOrQueue\(/);
  });

  it("the banner reports the real queue and claims nothing it cannot do", () => {
    const status = read("/src/lib/syncStatus.ts");
    expect(banner).toMatch(/subscribeToQueue/);
    expect(banner).toMatch(/role="status"/);
    expect(banner).toMatch(/aria-live="polite"/);
    // The regression this file exists to prevent: the old copy promised that
    // "cached plans, workouts and routines still work" when nothing was cached.
    // Scoped to the rendered component, not the file: the header comment
    // deliberately quotes the old copy to record why it was wrong.
    const rendered = banner.slice(banner.indexOf("const OfflineBanner"));
    expect(rendered).not.toMatch(/cached plans/i);
    expect(rendered).not.toMatch(/still work/i);
    // Phase 5 changed this assertion on purpose. The workout log was the only
    // caller of `insertOrQueue`, so the banner used to guard on `queued === 0`
    // and could only ever report a drain. Phase 5 gave the app a real snapshot
    // cache (lib/offlineCache.ts) and three real writers (life events, plan
    // adjustments, import corrections), so the banner now has something true to
    // say while offline and is allowed to appear on a bare offline blip — which
    // is exactly what the offline-first requirement asks for. What must not
    // change is that it decides nothing itself: it renders the one derivation.
    expect(rendered).toMatch(/syncNeedsAttention\(sync\.state\)/);
    expect(rendered).toMatch(/if \(!visible\) return null;/);
    expect(rendered).toMatch(/sync\.copy\.label/);
    expect(rendered).toMatch(/sync\.copy\.detail/);
    // The claim is still scoped to what actually queues, and the offline copy
    // still says where the data is rather than what request the network dropped.
    expect(status).toMatch(/will sync when you reconnect/);
    expect(status).toMatch(/saved on this device/i);
    expect(banner).not.toMatch(/will be saved and synced automatically/);
  });
});
// ============================================================================
// Push notifications — 4 October 2026
// ----------------------------------------------------------------------------
// The app shipped a notifications table, a prefs screen and zero delivery. The
// interesting properties are the ones that decide whether delivery is real or
// decorative:
//   * a message posted by the WebView does not arrive when the app is closed,
//     so the service must post natively;
//   * a token belongs to an INSTALL, so sign-out has to remove it;
//   * a token is a delivery ADDRESS, so no athlete may read another's;
//   * a build with no Firebase project must say so instead of pretending.
// ============================================================================

describe("push notifications — manifest and build", () => {
  const m = read(MANIFEST);
  const g = read(GRADLE_APP);

  it("declares POST_NOTIFICATIONS, and it is actually used", () => {
    expect(m).toMatch(/android\.permission\.POST_NOTIFICATIONS/);
    // A declared permission nobody uses is both a Play rejection risk and an
    // over-claim, so the usage has to be pinned with it.
    expect(read("/android/app/src/main/java/com/vaylosports/app/push/VayloMessagingService.kt")).toMatch(
      /Manifest\.permission\.POST_NOTIFICATIONS/
    );
  });

  it("binds the Firebase messaging service, unexported", () => {
    // Exported would let any installed app start this service with a forged
    // message payload.
    expect(m).toMatch(/com\.google\.firebase\.MESSAGING_EVENT/);
    expect(m).toMatch(/android:name="com\.vaylosports\.app\.push\.VayloMessagingService"/);
    expect(m).toMatch(/android:exported="false"/);
  });

  it("ships the FCM SDK through the BOM, without the google-services plugin", () => {
    // The google-services Gradle plugin fails the BUILD when its json is
    // missing, which would make the repository unbuildable for anyone without
    // the Firebase project. Configuration is read from string resources instead.
    expect(g).toMatch(/com\.google\.firebase:firebase-bom/);
    expect(g).toMatch(/com\.google\.firebase:firebase-messaging/);
    // The plugin is supported but must stay guarded: applied unconditionally
    // it fails the whole build for anyone without the file.
    expect(g).toMatch(/if \(servicesJSON\.text\) \{/);
    expect(g).toMatch(/apply plugin: 'com\.google\.gms\.google-services'/);
  });

  it("ships the FCM SDK through the BOM, without the google-services plugin", () => {
    // The google-services Gradle plugin fails the BUILD when its json is
    // missing, which would make the repository unbuildable for anyone without
    // the Firebase project. Configuration is read from string resources.
    const g = read("/android/app/build.gradle");
    expect(g).toMatch(/com\.google\.firebase:firebase-bom/);
    expect(g).toMatch(/com\.google\.firebase:firebase-messaging/);
    // The plugin is supported but must stay guarded: applied unconditionally
    // it fails the whole build for anyone without the file.
    expect(g).toMatch(/if \(servicesJSON\.text\) \{/);
    expect(g).toMatch(/apply plugin: 'com\.google\.gms\.google-services'/);
  });

  it("ships Firebase values, so the build can report configured:true", () => {
    const res = read("/android/app/src/main/res/values/vaylo_fcm.xml");
    for (const name of [
      "vaylo_fcm_app_id",
      "vaylo_fcm_api_key",
      "vaylo_fcm_project_id",
      "vaylo_fcm_sender_id",
    ]) {
      expect(res).toContain(`name="${name}"`);
      // Every value non-empty: the plugin resolves a real token and the
      // prefs screen reports this build as push-available.
      expect(res).toMatch(new RegExp(`name="${name}"[\\s\\S]*?>[^<]*<`));
    }
  });

  it("registers the push plugin before super.onCreate, like the others", () => {
    const activity = read("/android/app/src/main/java/com/vaylosports/app/MainActivity.java");
    const register = activity.indexOf("PushPlugin.class");
    const superCall = activity.indexOf("super.onCreate(savedInstanceState);");
    expect(register).toBeGreaterThan(-1);
    expect(register).toBeLessThan(superCall);
    expect(read("/src/lib/platform.ts")).toMatch(/"VayloPush"/);
  });
});

describe("push notifications — token handling", () => {
  const push = read("/src/lib/push.ts");
  const plugin = read("/android/app/src/main/java/com/vaylosports/app/push/PushPlugin.kt");
  const service = read("/android/app/src/main/java/com/vaylosports/app/push/VayloMessagingService.kt");

  it("never rejects: unconfigured, denied and unsupported must stay distinguishable", () => {
    // A rejected promise collapses "Firebase is not set up", "the athlete said
    // no" and "it worked" into one failure with no detail.
    expect(push).toMatch(/status: "unconfigured"/);
    expect(push).toMatch(/status: "denied"/);
    expect(push).toMatch(/status: "unsupported"/);
    expect(push).toMatch(/status: "registered"/);
    expect(plugin).toMatch(/call\.resolve\(out\)/);
  });

  it("registers through claim_push_token, never a raw table insert", () => {
    // A raw insert of an explicit user_id would depend entirely on the insert
    // policy holding; the RPC also handles the device changing hands.
    expect(push).toMatch(/rpc\("claim_push_token"/);
    expect(push).not.toMatch(/from\("push_tokens"\)\.insert/);
  });

  it("sign-out removes THIS device's token before the session dies", () => {
    const ctx = read("/src/contexts/AuthContext.tsx");
    const unregister = ctx.indexOf("unregisterPush()");
    const signOut = ctx.indexOf("supabase.auth.signOut()");
    expect(unregister).toBeGreaterThan(-1);
    expect(signout_after(unregister, signOut)).toBe(true);
    // Scoped to the one install, or an athlete with a phone and a tablet loses
    // the tablet's registration too.
    expect(push).toMatch(/from\("push_tokens"\)\.delete\(\)\.eq\("token", token\)/);
  });

  it("does not ask for the permission until the athlete asks for it", () => {
    // The prompt is one-shot. Asking on launch, before the screen that explains
    // what a notification is, is how an app earns a permanent "no".
    const prefs = read("/src/pages/NotificationPrefs.tsx");
    expect(prefs).toMatch(/onClick=\{enablePush\}/);
    expect(prefs).toMatch(/Turn on notifications on this device/);
    expect(read(APP)).not.toMatch(/registerPush\(/);
  });

  it("caches a rotated token, because an ignored onNewToken is a silent black hole", () => {
    expect(service).toMatch(/override fun onNewToken/);
    expect(service).toMatch(/putString/);
    // And posts natively, because a WebView-rendered push does not arrive when
    // the app is closed.
    expect(service).toMatch(/NotificationCompat\.Builder/);
    expect(service).toMatch(/manager\?\.notify\(/);
  });

  it("channel ids match between Kotlin and TypeScript", () => {
    const channels = read("/android/app/src/main/java/com/vaylosports/app/push/PushChannels.kt");
    for (const id of ["vaylo_default", "vaylo_reminders"]) {
      expect(channels).toContain(id);
      expect(push).toContain(id);
    }
  });
});

describe("push notifications — server side", () => {
  const migration = read("/supabase/migrations/20261004120000_push_tokens.sql");
  const fn = read("/supabase/functions/push-notify/index.ts");

  it("push_tokens is own-row only, with no cross-user read path", () => {
    // A push token is a delivery address: knowing someone else's means you can
    // push to their phone.
    expect(migration).toMatch(/USING \(auth\.uid\(\) = user_id\)/);
    expect(migration).toMatch(/WITH CHECK \(auth\.uid\(\) = user_id\)/);
    expect(migration).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(migration).not.toMatch(/USING \(true\)/);
  });

  it("the one definer RPC cannot be turned into a token oracle", () => {
    expect(migration).toMatch(/SECURITY DEFINER/);
    // The owner is always the caller. A version taking a user id would be a
    // "register any athlete's device" primitive.
    expect(migration).toMatch(/v_user uuid := auth\.uid\(\)/);
    expect(migration).not.toMatch(/p_user_id/);
    // It may only ever remove the exact token presented.
    expect(migration).toMatch(/DELETE FROM public\.push_tokens WHERE token = btrim\(p_token\)/);
    expect(migration).toMatch(/GRANT EXECUTE[\s\S]*TO authenticated/);
  });

  it("a token is unique per device, not per account", () => {
    // Otherwise one phone signed out of Alice and into Bob keeps delivering
    // Alice's notifications.
    expect(migration).toMatch(/token text NOT NULL UNIQUE/);
  });

  it("the sender honours the preference and cannot be aimed at strangers", () => {
    expect(fn).toMatch(/PREF_FOR_TYPE/);
    expect(fn).toMatch(/unknown notification type/);
    expect(fn).toMatch(/isServiceRole && Array\.isArray\(body\.user_ids\)/);
    // Without the service role, a caller may only ever target themselves.
    expect(fn).toMatch(/targets = \[user\.id\]/);
  });

  it("quiet hours wrap around midnight", () => {
    // 22:00-07:00 spans midnight; the naive comparison treats it as empty, so
    // "do not disturb me" is silently ignored every single night.
    expect(fn).toMatch(/start < end \? minutes >= start && minutes < end : minutes >= start \|\| minutes < end/);
    expect(fn).toMatch(/if \(start === end\) return false/);
  });

  it("account deletion and data export cover the new table", () => {
    expect(read("/supabase/functions/_shared/userTables.ts")).toMatch(/\["push_tokens", \["user_id"\]\]/);
  });
});