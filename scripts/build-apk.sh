#!/bin/sh
# Build, verify and publish collision-safe Android release artifacts.
set -e

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
M="${FREEBUFF_CHECKOUT:-$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)}"
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/AppData/Local/Android/Sdk}}"
JAVA_HOME="${JAVA_HOME:-/c/Program Files/Android/Android Studio/jbr}"
export JAVA_HOME

DEBUG=0
if [ "${1:-}" = "--debug" ]; then DEBUG=1; fi

cd "$M"
echo "[apk] building web assets"
npm run cap:sync

BT="$(ls -1d "$SDK"/build-tools/*/ 2>/dev/null | sort -V | tail -1)"
if [ -z "$BT" ]; then
  echo "[apk] no build-tools found under $SDK — set ANDROID_HOME" >&2
  exit 1
fi
AAPT2="$BT/aapt2"; [ -f "$AAPT2" ] || AAPT2="$BT/aapt2.exe"
APKSIGNER="$BT/apksigner"; [ -f "$APKSIGNER" ] || APKSIGNER="$BT/apksigner.bat"
AAPT2="$(cygpath -w "$AAPT2" 2>/dev/null || printf '%s' "$AAPT2")"
APKSIGNER="$(cygpath -w "$APKSIGNER" 2>/dev/null || printf '%s' "$APKSIGNER")"
# apksigner ships as a .bat wrapper that hands JAVA_HOME to java.exe untouched, so
# it rejects the MSYS-style path Gradle is happy with. Give the wrapper a native path.
JAVA_HOME_WIN="$(cygpath -w "$JAVA_HOME" 2>/dev/null || printf '%s' "$JAVA_HOME")"
# aapt2/apksigner are invoked with MSYS_NO_PATHCONV=1, so a POSIX artifact path
# reaches the Windows binary verbatim and resolves to \c\... — pass native paths.
winpath() { cygpath -w "$1" 2>/dev/null || printf '%s' "$1"; }
JARSIGNER_BIN="$JAVA_HOME/bin/jarsigner"
if [ -f "$JARSIGNER_BIN.exe" ]; then JARSIGNER_BIN="$JARSIGNER_BIN.exe"; fi
echo "[apk] build-tools: $(basename "$BT")"

cd "$M/android"
TASK=":app:assembleRelease"
if [ "$DEBUG" = "1" ]; then TASK=":app:assembleDebug $TASK"; fi
TASK="$TASK :app:bundleRelease"
echo "[apk] gradle $TASK"
./gradlew $TASK --console=plain -q || {
  echo "[apk] BUILD FAILED" >&2
  exit 1
}

REL="$M/android/app/build/outputs/apk/release/app-release.apk"
AAB_SRC="$M/android/app/build/outputs/bundle/release/app-release.aab"
if [ ! -f "$REL" ] || [ ! -f "$AAB_SRC" ]; then
  echo "[apk] FAIL release APK or AAB missing" >&2
  exit 1
fi

echo
echo "[apk] --- release checks ---"
SIG="$(MSYS_NO_PATHCONV=1 JAVA_HOME="$JAVA_HOME_WIN" "$APKSIGNER" verify --print-certs "$(winpath "$REL")" 2>&1 || true)"
DN="$(printf '%s' "$SIG" | grep -m1 "certificate DN:" || true)"
case "$DN" in
  *"CN=Vaylo Sports"*) echo "[apk] ok   APK signed with the Vaylo Sports upload key" ;;
  *) echo "[apk] FAIL APK signer is ${DN:-<no cert>}" >&2; exit 1 ;;
esac
printf '%s' "$SIG" | grep -m1 "SHA-256 digest" | sed 's/^/[apk]     /'

PERMS="$(MSYS_NO_PATHCONV=1 "$AAPT2" dump permissions "$(winpath "$REL")" 2>/dev/null || true)"
if [ -z "$PERMS" ]; then
  echo "[apk] FAIL aapt2 returned no permission list — cannot verify the manifest" >&2
  exit 1
fi
WRITES="$(printf '%s' "$PERMS" | grep -c "WRITE" || true)"
if [ "$WRITES" != "0" ]; then
  echo "[apk] FAIL $WRITES write permission(s) in the release manifest" >&2
  printf '%s' "$PERMS" | grep "WRITE" | sed 's/^/[apk]     /' >&2
  exit 1
fi
READS="$(printf '%s' "$PERMS" | grep -c "health.READ" || true)"
echo "[apk] ok   $READS health read permission(s), 0 write"
if printf '%s' "$PERMS" | grep -q "HcSeedActivity"; then
  echo "[apk] FAIL HcSeedActivity present in release" >&2
  exit 1
fi
echo "[apk] ok   no HcSeedActivity in release"

BADGING="$(MSYS_NO_PATHCONV=1 "$AAPT2" dump badging "$(winpath "$REL")" 2>/dev/null || true)"
if [ -z "$BADGING" ]; then
  echo "[apk] FAIL aapt2 returned no badging — cannot verify package, target SDK or version" >&2
  exit 1
fi
PACKAGE="$(printf '%s' "$BADGING" | grep -m1 '^package:' || true)"
TARGET_SDK="$(printf '%s' "$BADGING" | grep -m1 "targetSdkVersion" || true)"
case "$PACKAGE" in
  *"name='com.vaylosports.app'"*) echo "[apk] ok   $PACKAGE" ;;
  *) echo "[apk] FAIL unexpected package: ${PACKAGE:-<missing>}" >&2; exit 1 ;;
esac
case "$TARGET_SDK" in
  *"targetSdkVersion:'36'"*) echo "[apk] ok   $TARGET_SDK" ;;
  *) echo "[apk] FAIL unexpected target SDK: ${TARGET_SDK:-<missing>}" >&2; exit 1 ;;
esac
LEAKS=$(grep -roE "eyJ[A-Za-z0-9_-]{10,}" "$M/android/app/src/main/assets/public" 2>/dev/null | wc -l | tr -d ' ')
if [ "$LEAKS" != "0" ]; then
  echo "[apk] FAIL $LEAKS JWT(s) in the shipped web bundle" >&2
  exit 1
fi
echo "[apk] ok   0 JWTs in the shipped web bundle"
if find "$M/android/app/src/main/assets/public" -type f -name '*.map' -print -quit | grep -q .; then
  echo "[apk] FAIL source maps found in the shipped web bundle" >&2
  exit 1
fi
echo "[apk] ok   no source maps in the shipped web bundle"

if [ ! -f "$JARSIGNER_BIN" ]; then
  echo "[apk] FAIL jarsigner not found; cannot verify the AAB" >&2
  exit 1
fi
KEYTOOL_BIN="$JAVA_HOME/bin/keytool"
if [ -f "$KEYTOOL_BIN.exe" ]; then KEYTOOL_BIN="$KEYTOOL_BIN.exe"; fi
if [ ! -f "$KEYTOOL_BIN" ]; then
  echo "[apk] FAIL keytool not found; cannot verify the AAB signer" >&2
  exit 1
fi
CERT="$("$KEYTOOL_BIN" -printcert -jarfile "$AAB_SRC" 2>&1 || true)"
OWNER="$(printf '%s' "$CERT" | grep -m1 'Owner:' || true)"
case "$OWNER" in
  *"CN=Vaylo Sports"*) echo "[apk] ok   AAB signed with the Vaylo Sports upload key" ;;
  *) echo "[apk] FAIL AAB signer is ${OWNER:-<not a signed jar>}" >&2; exit 1 ;;
esac
VOUT="$("$JARSIGNER_BIN" -verify -verbose:summary "$AAB_SRC" 2>&1 || true)"
case "$VOUT" in
  *"jar verified."*) echo "[apk] ok   AAB signature verifies" ;;
  *) echo "[apk] FAIL AAB signature did not verify" >&2; exit 1 ;;
esac

NAME="$(printf '%s' "$BADGING" | grep -m1 "versionName=" | sed "s/.*versionName='\([^']*\)'.*/\1/")"
CODE="$(printf '%s' "$BADGING" | grep -m1 "versionCode=" | sed "s/.*versionCode='\([^']*\)'.*/\1/")"
# Compare against android/app/build.gradle rather than a literal. The literal
# used to be "1.2.1 (5)" and silently stopped matching once the app moved to
# 1.2.7 (11): the check that exists to catch a mis-built artifact was itself the
# reason no artifact could be built. Gradle is the source of truth for the
# version, so the assertion reads it there.
EXPECTED_NAME="$(grep -m1 'versionName project.hasProperty' "$M/android/app/build.gradle" | sed "s/.*: *\"\([^\"]*\)\".*/\1/")"
EXPECTED_CODE="$(grep -m1 'versionCode project.hasProperty' "$M/android/app/build.gradle" | sed "s/.*: *\([0-9][0-9]*\).*/\1/")"
if [ -z "$EXPECTED_NAME" ] || [ -z "$EXPECTED_CODE" ]; then
  echo "[apk] FAIL could not read the expected version out of android/app/build.gradle" >&2
  exit 1
fi
if [ "$NAME" != "$EXPECTED_NAME" ] || [ "$CODE" != "$EXPECTED_CODE" ]; then
  echo "[apk] FAIL expected version ${EXPECTED_NAME} (${EXPECTED_CODE}) from build.gradle, found ${NAME:-unknown} (${CODE:-unknown})" >&2
  exit 1
fi
echo "[apk] ok   version ${NAME} (${CODE}) matches build.gradle"
APK_OUT="$M/apk/vaylo-sports-${NAME:-unknown}-${CODE:-0}-release.apk"
AAB_OUT="$M/apk/vaylo-sports-${NAME:-unknown}-${CODE:-0}-release.aab"
DEBUG_OUT="$M/apk/vaylo-sports-${NAME:-unknown}-${CODE:-0}-debug.apk"
DEBUG_SRC="$M/android/app/build/outputs/apk/debug/app-debug.apk"
mkdir -p "$M/apk"
for candidate in "$APK_OUT" "$AAB_OUT"; do
  if [ -e "$candidate" ]; then
    echo "[apk] refusing to overwrite existing artifact: $candidate" >&2
    exit 1
  fi
done
if [ "$DEBUG" = "1" ] && [ -e "$DEBUG_OUT" ]; then
  echo "[apk] refusing to overwrite existing artifact: $DEBUG_OUT" >&2
  exit 1
fi
if [ "$DEBUG" = "1" ] && [ ! -f "$DEBUG_SRC" ]; then
  echo "[apk] FAIL debug APK missing at $DEBUG_SRC" >&2
  exit 1
fi
cp "$REL" "$APK_OUT"
cp "$AAB_SRC" "$AAB_OUT"
if [ "$DEBUG" = "1" ]; then
  cp "$DEBUG_SRC" "$DEBUG_OUT"
fi

echo
echo "[apk] release APK: $APK_OUT"
echo "[apk] release AAB: $AAB_OUT"
ls -lh "$APK_OUT" "$AAB_OUT"
echo "[apk] APK sha256 $(sha256sum "$APK_OUT" | cut -d' ' -f1)"
echo "[apk] AAB sha256 $(sha256sum "$AAB_OUT" | cut -d' ' -f1)"

# Record the sums in apk/SHA256SUMS.txt.
#
# The script computed and printed these from the beginning but never wrote them
# anywhere, so the manifest drifted: 1.2.9-13 was built, signed and handed out
# with no entry at all. That failure is worse than having no manifest, because
# `sha256sum -c` still prints "OK" for every line it does contain — it verifies
# the subset that happens to be listed and says nothing about the rest, which
# reads exactly like a clean bill of health for the whole directory.
#
# Appending rather than rewriting keeps the file's history: earlier entries are
# what other people may already have checked a download against, so an existing
# line is never touched, and a filename already present is never added twice.
SUMS="$M/apk/SHA256SUMS.txt"
touch "$SUMS"
record_sum() {
  file="$1"
  name="$(basename "$file")"
  if grep -qF " *$name" "$SUMS"; then
    echo "[apk] manifest already lists $name"
    return 0
  fi
  printf '%s *%s\n' "$(sha256sum "$file" | cut -d' ' -f1)" "$name" >> "$SUMS"
  echo "[apk] recorded $name in apk/SHA256SUMS.txt"
}
record_sum "$APK_OUT"
record_sum "$AAB_OUT"
if [ "$DEBUG" = "1" ]; then record_sum "$DEBUG_OUT"; fi
