#!/bin/sh
# ==============================================================================
# Build the APK with build-apk.sh, then email it to gemmellj175@gmail.com.
# ============================================================================
# Usage:
#   sh scripts/build-apk-and-email.sh        # release build + email
#   sh scripts/build-apk-and-email.sh --debug # debug build + email
#
# Depends on:
#   - scripts/build-apk.sh (existing, unchanged)
#   - scripts/send-apk-email.mjs (this project, new)
#   - scripts/share-apk.mjs (this project: stages newest APK + refreshes the
#     stable Pixel 9 download link and QR so the phone always gets the latest)
#   - RESEND_API_KEY in .env (git-ignored)
#
# The email step only runs when the build succeeds. On build failure it is
# skipped entirely, and the APK is not emailed.
# The Pixel 9 share staging runs before the email step, so a broken email
# login can never block the share.
# ==============================================================================

set -e

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
M="${FREEBUFF_CHECKOUT:-$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)}"

cd "$M"

DEBUG=0
if [ "${1:-}" = "--debug" ]; then
  DEBUG=1
fi

echo "[build+email] building APK (debug=$DEBUG)"
sh scripts/build-apk.sh "$@"

# --- Decide which APK to email. Mirrors the naming in build-apk.sh. -----------
NAME="$(grep -m1 'versionName project.hasProperty' android/app/build.gradle | sed 's/.*: *"\([^"]*\)".*/\1/')"
CODE="$(grep -m1 'versionCode project.hasProperty' android/app/build.gradle | sed 's/.*: *\([0-9][0-9]*\).*/\1/')"

if [ "$DEBUG" = "1" ]; then
  APK_OUT="$M/apk/vaylo-sports-${NAME}-${CODE}-debug.apk"
else
  APK_OUT="$M/apk/vaylo-sports-${NAME}-${CODE}-release.apk"
fi

if [ ! -f "$APK_OUT" ]; then
  echo "[build+email] FAIL: expected APK not found at $APK_OUT" >&2
  exit 1
fi

echo "[build+email] APK built: $APK_OUT"
echo "[build+email] refreshing stable Pixel 9 download link + QR"
node scripts/share-apk.mjs

echo "[build+email] done: stable Pixel download link updated"
echo "[build+email] emailing to gemmellj175@gmail.com"

node scripts/send-apk-email.mjs "$APK_OUT"
