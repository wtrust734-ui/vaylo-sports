#!/usr/bin/env bash
# ============================================================================
# set-waitlist-cron-secret.sh
# ----------------------------------------------------------------------------
# The scheduled launch emails are triggered by pg_cron -> pg_net -> the
# `waitlist-campaigns` edge function. That function must not be callable by
# anyone else, and the caller (a cron job) has no Supabase session to present,
# so the two sides share one random secret.
#
# It has to exist in two places, and they have to match:
#
#   1. Supabase Vault, as `waitlist_cron_secret` — read by the
#      `waitlist_trigger_campaigns()` SQL function at fire time and sent as the
#      `x-cron-secret` header. Vault (not a literal in the cron command) because
#      anything in `cron.job` is readable in plain text by whoever can query it.
#
#   2. The function's own environment, as WAITLIST_CRON_SECRET, so the function
#      can check the header it receives.
#
# This script is idempotent: running it again rotates the secret in both places,
# which is the correct response to it being exposed, and is safe because the
# running job reads the value fresh on every fire.
#
# Generating here (rather than committing a value) is the point: a secret in the
# repository is not a secret.
# ============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."

SECRET="$(openssl rand -hex 32 2>/dev/null || node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')"

echo "Setting function secret WAITLIST_CRON_SECRET ..."
supabase secrets set "WAITLIST_CRON_SECRET=${SECRET}" >/dev/null

echo "Storing the same value in Vault as waitlist_cron_secret ..."
# delete-then-create so a re-run rotates rather than colliding. The value is a
# hex string, so it needs no escaping in the SQL literal.
supabase db query --linked "
  delete from vault.secrets where name = 'waitlist_cron_secret';
  select vault.create_secret(
    '${SECRET}',
    'waitlist_cron_secret',
    'Header secret pg_cron sends to the waitlist-campaigns edge function'
  );
" >/dev/null

echo "Done. Both copies updated; the value was not printed."
