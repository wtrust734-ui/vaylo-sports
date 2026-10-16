#!/usr/bin/env bash
# ============================================================================
# set-report-escalation-secret.sh
# ----------------------------------------------------------------------------
# Content reports are escalated to the operator inbox by a database trigger ->
# pg_net -> the `content-report-escalate` edge function (migration
# 20261015210000). The caller has no Supabase session to present, so the two
# sides share one random secret. It has to exist in two places, and they have
# to match:
#
#   1. `public.private_secrets`, row name `content_report_escalation_key` —
#      read by `notify_content_report_escalation()` at fire time and sent as
#      the `x-escalation-key` header. A service-owner-owned table replacing
#      the Vault row the waitlist trigger uses, because the Management API
#      query role cannot write Vault (42501 on the pgsodium crypto functions)
#      and this table is readable by the trigger's SECURITY DEFINER owner and
#      by service_role only.
#
#   2. The function's own environment, as REPORT_ESCALATION_KEY, so the
#      function can check the header it receives.
#
# Idempotent: running it again rotates the secret in both places, which is the
# correct response to it being exposed, and is safe because the trigger reads
# the value fresh on every report insert. Until the row exists, the trigger
# logs a warning, the report stays stored, and nobody is emailed — which the
# wiring test (src/lib/moderationEscalation.test.ts) pins as the honest
# failure mode, not a silent success.
# ============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."

SECRET="$(openssl rand -hex 32 2>/dev/null || node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')"

PROJECT_REF="${SUPABASE_PROJECT_ID:-vvwhausdjzdmsyxekrcl}"

echo "Setting function secret REPORT_ESCALATION_KEY ..."
supabase secrets set "REPORT_ESCALATION_KEY=${SECRET}" \
  --project-ref "$PROJECT_REF" >/dev/null

echo "Storing the same value in public.private_secrets ..."
node scripts/run-sql.cjs "
  insert into public.private_secrets (name, value)
  values ('content_report_escalation_key', '${SECRET}')
  on conflict (name) do update
    set value = excluded.value, rotated_at = now();
" >/dev/null

echo "Done. Both copies updated; the value was not printed."
