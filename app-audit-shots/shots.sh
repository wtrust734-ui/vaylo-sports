#!/usr/bin/env bash
# Navigate to a screen by label and capture it. Screenshots are the only way to
# see the things the accessibility tree cannot report: colour, contrast, wrapped
# labels, overlaps, and a card that is the wrong shape.
set -uo pipefail
export MSYS_NO_PATHCONV=1
ADB="/c/Users/gemme/AppData/Local/Android/Sdk/platform-tools/adb.exe"
cd "$(dirname "$0")"

HOME_X=141; TRAIN_X=321; PERFORM_X=711; PROFILE_X=929; TAB_Y=2248

for spec in "$@"; do
  name="${spec%%=*}"; rest="${spec#*=}"; hub="${rest%%:*}"; pat="${rest#*:}"
  case "$hub" in
    Home) x=$HOME_X ;; Train) x=$TRAIN_X ;; Perform) x=$PERFORM_X ;; Profile) x=$PROFILE_X ;;
  esac
  "$ADB" shell input tap "$x" "$TAB_Y"; sleep 2.4
  # Find the child's tap point from the accessibility tree, then tap it.
  point=$(node ui.cjs find "$pat" | awk '/tap /{print $2" "$3; exit}')
  if [ -z "$point" ]; then echo "!! $name: no match for /$pat/"; continue; fi
  "$ADB" shell input tap $point; sleep 2.8
  "$ADB" exec-out screencap -p > "s-$name.png"
  echo "s-$name.png  <- $hub /$pat/ via $point"
done
