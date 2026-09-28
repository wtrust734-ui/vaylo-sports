#!/bin/sh
# Sync the working checkout to GitHub in one step.
#
#   bash scripts/sync-to-github.sh [commit message]
#
# Why this exists: there are two checkouts of this project and they are not the
# same directory.
#
#   P  the real git repository, where commits and pushes happen, and where the
#      post-commit hook mirrors P -> M
#   M  the Freebuff checkout, where the *editing tools are rooted*
#
# Nothing mirrors M -> P. So a file edited in M is invisible to git until someone
# copies it over, and that has already cost real time twice: a test fix and an
# offer-window patch each existed only in M and were one P -> M mirror away from
# being deleted. This script is the missing direction, plus the commit and push.
#
#   bash scripts/sync-to-github.sh "Explain the why, not the what"
#
# With no message it writes a generic one, which is worse for history; pass a
# message whenever you can.
#
# Excluded paths are the same set the git hooks exclude, and for the same reason:
# dependencies, build output, and the git-ignored generated web assets under
# android/app/src/main/assets, which `npx cap sync` owns. Mirroring those between
# trees is how a fresh sync got silently replaced by an older one.
#
# ARTIFACTS are excluded too. These two live in the Freebuff checkout and belong
# to it, not to the project, and neither is git-ignored — so without this a full
# sync would commit them on the first run:
#
#   project-id   a UUID that is not this project's Supabase ref
#   bun.lockb    a binary Bun lockfile, older format than the tracked bun.lock
#
# If either is ever wanted in the repository, drop it from these lists and add it
# deliberately rather than letting a sync sweep it in.
ARTIFACTS='bun.lockb project-id'
set -e

M="${FREEBUFF_CHECKOUT:-C:/Users/gemme/Downloads/.freebuff}"
P="${VAYLO_REPO:-C:/Users/gemme/Documents/Codex/2026-09-19/github-plugin-github-openai-curated-remote/work/vaylosports1-main}"
MESSAGE="${1:-Sync working changes}"

if [ ! -d "$M/.git" ] && [ ! -d "$M" ]; then
  echo "sync-to-github: no checkout at $M (set FREEBUFF_CHECKOUT)" >&2
  exit 1
fi
if [ ! -d "$P/.git" ]; then
  echo "sync-to-github: no git repository at $P (set VAYLO_REPO)" >&2
  exit 1
fi
if [ "$M" = "$P" ]; then
  echo "sync-to-github: both paths are the same directory; nothing to sync" >&2
  exit 1
fi

echo "[sync] M -> P  ($M -> $P)"

# --- 1. Copy M into P, leaving generated and dependency paths alone ----------
if command -v rsync >/dev/null 2>&1; then
  rsync -a \
    --exclude='.git/' --exclude='node_modules/' --exclude='dist/' \
    --exclude='android/app/build/' --exclude='android/build/' \
    --exclude='android/app/src/main/assets/' --exclude='.freebuff/' \
    --exclude='bun.lockb' --exclude='project-id' \
    --exclude='*.tsbuildinfo' \
    "$M"/ "$P"/
  echo "[sync] copied with rsync"
elif command -v robocopy >/dev/null 2>&1; then
  M_WIN="$(cygpath -w "$M" 2>/dev/null || echo "$M")"
  P_WIN="$(cygpath -w "$P" 2>/dev/null || echo "$P")"
  # Multi-segment /XD values must be absolute: robocopy matches a path containing
  # a separator against nothing and fails silently. See .git/hooks/post-commit.
  EX_BUILD="$(cygpath -w "$M/android/app/build" 2>/dev/null || echo "$M/android/app/build")"
  EX_ROOTBUILD="$(cygpath -w "$M/android/build" 2>/dev/null || echo "$M/android/build")"
  EX_ASSETS="$(cygpath -w "$M/android/app/src/main/assets" 2>/dev/null || echo "$M/android/app/src/main/assets")"
  # No /MIR: deleting in the repository is git's job, not a copy tool's.
  MSYS_NO_PATHCONV=1 robocopy "$M_WIN" "$P_WIN" /E \
    /XD .git node_modules dist .freebuff "$EX_BUILD" "$EX_ROOTBUILD" "$EX_ASSETS" \
    /XF "*.tsbuildinfo" $ARTIFACTS /NFL /NDL /NJH /NJS /NC /NS >/dev/null 2>&1 || true
  echo "[sync] copied with robocopy"
else
  echo "sync-to-github: neither rsync nor robocopy is available" >&2
  exit 1
fi

# --- 2. Commit and push in P -------------------------------------------------
cd "$P"
BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo main)"
[ "$BRANCH" = "HEAD" ] && BRANCH="main"

if git diff --quiet && git diff --cached --quiet && [ -z "$(git ls-files --others --exclude-standard)" ]; then
  echo "[sync] nothing to commit — P already matches M"
else
  echo "[sync] changes to commit:"
  git status --short | sed 's/^/[sync]   /'
  git add -A
  git commit -q -m "$MESSAGE"
  echo "[sync] committed on $BRANCH"
fi

# The post-commit hook pushes, so this usually finds nothing left to do. It is
# still run explicitly: a commit made before the hook existed, or a hook that is
# missing on a fresh clone, must not leave work stranded locally.
if [ -n "$(git log origin/"$BRANCH"..HEAD 2>/dev/null)" ]; then
  echo "[sync] pushing $BRANCH"
  git push origin "$BRANCH" 2>&1 | sed 's/^/[sync] /'
else
  echo "[sync] origin/$BRANCH is already up to date"
fi

echo "[sync] HEAD   $(git rev-parse --short HEAD)  $(git log -1 --pretty=%s)"
echo "[sync] origin $(git rev-parse --short origin/$BRANCH)"
