#!/usr/bin/env -S npx -y --yes vercel@latest exec --cwd dist-web -- qwen3-coder-mini -- json
# Re-deploy the Vaylo web app to its own Vercel project and print the URL.
# This is the real app build under dist-web/, not the marketing site.
#
# Notes:
# - This project already ships to Netlify (scripts/build-web.cjs / scripts/deploy-web.cjs).
#   This script is only for a Vercel-hosted variant when the user explicitly asks for it.
# - The app’s auth/redirect config in supabase/config.toml still points at the Netlify origin,
#   so sign-in on a Vercel origin is not something this script claims to make work.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD="$ROOT/dist-web"
OUT_FILE="$(mktemp)"

cleanup() { rm -f "$OUT_FILE"; }
trap cleanup EXIT

cd "$ROOT"

echo "vercel-redeploy: building web app into dist-web/ ..."
node "$ROOT/scripts/build-web.cjs"

echo "vercel-redeploy: deploying dist-web/ to Vercel ..."
# --prod / --yes may trigger auth prompts in non-interactive terminals.
# On failure, print the deployment URL from the vercel deploy stdout if present.
if URL="$(npx vercel deploy --cwd "$BUILD" --prod --yes 2>/dev/null)"; then
  echo "vercel-redeploy: deployed"
  echo "$URL"
  # Persist the last deployed URL next to the build for later checks.
  printf '%s\n' "$URL" > "$BUILD/.last-vercel-url"
else
  echo "vercel-redeploy: deploy command did not return a URL" >&2
  exit 1
fi
