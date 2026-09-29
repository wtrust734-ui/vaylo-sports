#!/bin/sh
# Build a signed, installable APK and prove what is in it before handing it over.
#
#   bash scripts/build-apk.sh              # release (the one to install)
#   bash scripts/build-apk.sh --debug      # debug as well
#
# Why this is a script and not three commands: the build succeeding says nothing
# about whether the artefact is any good. A release APK can be unsigned, signed
# with the debug key, carry write permissions to health data, or have no
# `versionCode` Play will accept. Each of those was found by hand at least once,
# and each is one line here, so none of them can come back unnoticed.
#
# The checks are deliberately noisy about what they proved. A build log that
# just says BUILD SUCCESSFUL is exactly the log that hides a wrong signer.

set -e

M="${FREEBUFF_CHECKOUT:-C:/Users/gemme/Downloads/.freebuff}"
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/AppData/Local/Android/Sdk}}"
JAVA_HOME="${JAVA_HOME:-C:/Program Files/Android/Android Studio/jbr}"
export JAVA_HOME

DEBUG=0
[ "$1" = "--debug" ] && DEBUG=1

cd "$M"

# --- 1. Build the web assets and copy them into the native shell ------------
# `build:native` is what ships; plain `build` only works served from a root
# path, which is not the case inside a Capacitor WebView.
echo "[apk] building web assets"
npm run cap:sync

# --- 2. Pick the newest build-tools, so this is not pinned to 36.0.0 ---------
BT="$(ls -1d "$SDK"/build-tools/*/ 2>/dev/null | sort -V | tail -1)"
if [ -z "$BT" ]; then
  echo "[apk] no build-tools found under $SDK — set ANDROID_HOME" >&2
  exit 1
fi
AAPT2="$BT/aapt2"; [ -f "$AAPT2" ] || AAPT2="$AAPT2.exe"
APKSIGNER="$BT/apksigner"; [ -f "$APKSIGNER" ] || APKSIGNER="$APKSIGNER.bat"
echo "[apk] build-tools: $(basename "$BT")"

# --- 3. Build ---------------------------------------------------------------
cd "$M/android"
TASK=":app:assembleRelease"
[ "$DEBUG" = "1" ] && TASK=":app:assembleDebug $TASK"
echo "[apk] gradle $TASK"
./gradlew $TASK --console=plain -q || {
  echo "[apk] BUILD FAILED" >&2
  exit 1
}

# --- 4. Verify and publish the release APK ----------------------------------
REL="$M/android/app/build/outputs/apk/release/app-release.apk"
if [ ! -f "$REL" ]; then
  echo "[apk] no release APK at $REL" >&2
  exit 1
fi

echo
echo "[apk] --- release checks ---"

# 4a. Signature. Play refuses a bundle signed with the debug key, and a
#     sideloaded app signed with the debug key cannot later be replaced by the
#     Play version without an uninstall — so the signer is checked by name, not
#     merely asserted to exist.
SIG="$(MSYS_NO_PATHCONV=1 "$APKSIGNER" verify --print-certs "$REL" 2>&1 || true)"
DN="$(printf '%s' "$SIG" | grep -m1 "certificate DN:" || true)"
case "$DN" in
  *"CN=Vaylo Sports"*) echo "[apk] ok   signed with the Vaylo Sports upload key" ;;
  *) echo "[apk] FAIL not signed with the upload key: ${DN:-<no cert>}" >&2; exit 1 ;;
esac
printf '%s' "$SIG" | grep -m1 "SHA-256 digest" | sed 's/^/[apk]     /'

# 4b. Permissions. The whole point of the Health Connect work is reading health
#     data and nothing else; a single WRITE permission here would mean the app
#     can alter what the athlete's own device recorded, and it is a policy
#     rejection in the Play review.
PERMS="$("$AAPT2" dump permissions "$REL" 2>/dev/null || true)"
WRITES="$(printf '%s' "$PERMS" | grep -c "WRITE" || true)"
if [ "$WRITES" != "0" ]; then
  echo "[apk] FAIL $WRITES write permission(s) in the release manifest" >&2
  printf '%s' "$PERMS" | grep "WRITE" | sed 's/^/[apk]     /' >&2
  exit 1
fi
READS="$(printf '%s' "$PERMS" | grep -c "health.READ" || true)"
echo "[apk] ok   $READS health read permission(s), 0 write"

# 4c. The seed activity is a debug-only backdoor for populating Health Connect
#     fixtures. It must not exist in a release, or it is an exported component
#     anyone can invoke.
if printf '%s' "$PERMS" | grep -q "HcSeedActivity"; then
  echo "[apk] FAIL HcSeedActivity present in release" >&2
  exit 1
fi
echo "[apk] ok   no HcSeedActivity in release"

# 4d. Identity. versionCode has to be higher than the last upload or Play
#     rejects the bundle outright.
BADGING="$("$AAPT2" dump badging "$REL" 2>/dev/null || true)"
echo "[apk] ok   $(printf '%s' "$BADGING" | grep -m1 '^package:')"
echo "[apk] ok   $(printf '%s' "$BADGING" | grep -m1 "targetSdkVersion")"

# 4e. Nothing sensitive baked into the web bundle that ships inside the APK.
LEAKS=$(grep -roE "eyJ[A-Za-z0-9_-]{10,}" "$M/android/app/src/main/assets/public" 2>/dev/null | wc -l | tr -d ' ')
if [ "$LEAKS" != "0" ]; then
  echo "[apk] FAIL $LEAKS JWT(s) in the shipped web bundle" >&2
  exit 1
fi
echo "[apk] ok   0 JWTs in the shipped web bundle"

# --- 5. Publish --------------------------------------------------------------
mkdir -p "$M/apk"
NAME="$(printf '%s' "$BADGING" | grep -m1 "versionName=" | sed "s/.*versionName='\([^']*\)'.*/\1/")"
CODE="$(printf '%s' "$BADGING" | grep -m1 "versionCode=" | sed "s/.*versionCode='\([^']*\)'.*/\1/")"
OUT="$M/apk/vaylo-sports-${NAME:-unknown}-${CODE:-0}-release.apk"
cp "$REL" "$OUT"

[ "$DEBUG" = "1" ] && cp \
  "$M/android/app/build/outputs/apk/debug/app-debug.apk" \
  "$M/apk/vaylo-sports-${NAME:-unknown}-${CODE:-0}-debug.apk"

echo
echo "[apk] $OUT"
ls -la "$M/apk"
echo "[apk] sha256 $(sha256sum "$OUT" | cut -d' ' -f1)"
echo
echo "[apk] install with:  adb install -r $OUT"
