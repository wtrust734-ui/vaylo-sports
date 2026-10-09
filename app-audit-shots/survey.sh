#!/usr/bin/env bash
# Survey the APK's screens: tap a tab root, then drill into one child by its
# accessible label, and print the layout report for what came up.
#
# Anchored regexes are deliberate. An unanchored /Train/ matches the label
# "Training plans — Your active plan and weeks" and navigates to /training
# instead of tapping the tab, which silently surveys the wrong screen (and once
# tapped "Create Training Plan").
set -uo pipefail
export MSYS_NO_PATHCONV=1
ADB="/c/Users/gemme/AppData/Local/Android/Sdk/platform-tools/adb.exe"
cd "$(dirname "$0")"

HOME_X=141; TRAIN_X=321; PERFORM_X=711; PROFILE_X=929; TAB_Y=2248

tap_tab() { "$ADB" shell input tap "$1" "$TAB_Y"; sleep 3.2; }
child()   { node drill.cjs "$1" 2>&1 | grep -v '^$'; }

{
for spec in "$@"; do
  hub="${spec%%:*}"; pat="${spec#*:}"
  case "$hub" in
    Home) x=$HOME_X ;; Train) x=$TRAIN_X ;; Perform) x=$PERFORM_X ;; Profile) x=$PROFILE_X ;;
  esac
  echo "################ ${hub} > ${pat}"
  tap_tab "$x"
  child "$pat"
done
} 2>&1
