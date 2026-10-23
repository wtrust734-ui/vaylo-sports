/**
 * refundCredits — return credits that were charged before an AI call failed.
 *
 * Why this exists: the AI edge functions deduct credits up-front (single
 * authoritative path via credits_spend) and then call a provider. If the
 * provider fails, the athlete has paid for nothing. This grants the charge
 * back through the service-role-only credits_grant RPC, which the client
 * cannot call.
 *
 * Idempotency: every refund uses a DETERMINISTIC key derived from the charge
 * itself (dedupeKey — the idempotency key `credits_spend` holds on the charge
 * transaction). Key `refund:<charge-key>` pairs 1:1 with the charge: retries
 * of the same refund collapse into one grant, while two different failures
 * refund independently. A refund is therefore safe to retry forever and can
 * never over-credit.
 *
 * Resilience: a failed refund is retried once in the function itself (cheap,
 * bounded — the refund is a single RPC, so if the first attempt died on a
 * transient fetch there is a good chance the second lands). If the retry also
 * fails, the failure is written to the admin-visible app_error_reports table
 * (the same store the app's crash reports go to — no new schema, no new
 * third-party processor, arguably the topic the published legal pages care
 * most about) and the operator is emailed the first time a given failure
 * shape appears. Reconciliation reads the ledger directly: the charge row
 * carries the spend key, its refund is the row keyed `refund:<spend key>`;
 * a charge with no refund row and an open credit_refund_failed report is the
 * case a reconciliation pass fixes by replaying the same refund key.
 *
 * This function never throws: a refund problem must not turn a handled AI
 * failure into an unhandled one. Its return value tells the caller whether
 * the credits went back.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.0";
import { emailConfigured, sendMail } from "./email.ts";
import { markServiceJobFailed } from "./serviceJobs.ts";

interface RefundArgs {
  supabaseUrl: string;
  serviceRoleKey: string;
  userId: string;
  amount: number;
  reason: string;
  /** Ledger source, e.g. "refund" or "video-form-analysis-refund". */
  source?: string;
  /**
   * Deterministic tie to the charge: pass the idempotency key credits_spend
   * recorded when the athlete was charged. Omitted only by call sites that
   * charged without one — those keep per-call random keys.
   */
  dedupeKey?: string;
}

/** Attempts per refund call: the first try plus one bounded retry. */
const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 300;

const ADMIN = {
  version: "server" as const,
  name: "credit_refund_failed",
  screen: "server:refund",
};

export async function refundCredits({
  supabaseUrl,
  serviceRoleKey,
  userId,
  amount,
  reason,
  source = "refund",
  dedupeKey,
}: RefundArgs): Promise<boolean> {
  if (!amount || amount <= 0) return false;
  const idempotencyKey = dedupeKey ? `refund:${dedupeKey}` : `refund:${crypto.randomUUID()}`;

  // This call IS the verified failure signal: the AI function only asks for its
  // charge back when the provider or persistence failed. Record it on the
  // service job so a later refund request can be auto-settled from evidence
  // instead of guessed from absence of success. Best-effort, never throws.
  if (dedupeKey) {
    await markServiceJobFailed({ supabaseUrl, serviceRoleKey, userId, chargeKey: dedupeKey });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);
  let lastError: string | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const { error } = await admin.rpc("credits_grant", {
        p_user: userId,
        p_amount: amount,
        p_reason: reason,
        p_source: source,
        p_idempotency_key: idempotencyKey,
        p_metadata: { kind: "refund", refund_key: idempotencyKey },
      });
      if (!error) {
        console.log(`refunded ${amount} credits to ${userId} (${idempotencyKey}): ${reason}`);
        return true;
      }
      lastError = error.message;
    } catch (e) {
      lastError = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    }
    console.error(
      `credit refund attempt ${attempt}/${MAX_ATTEMPTS} failed (${idempotencyKey}): ${lastError}`,
    );
    if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
  }

  // The charge stands and the money did not go back. Record the failure where
  // triage already happens, and mail the operator the first time this exact
  // failure shape appears. Both best-effort: nothing here may throw.
  console.error(`credit refund FAILED (${idempotencyKey}): ${lastError}`);
  await alertRefundFailure(supabaseUrl, serviceRoleKey, { amount, source, idempotencyKey, lastError }).catch(
    () => undefined,
  );
  return false;
}

/* ---------------------------------------------------------------- alerting */

interface AlertDetails {
  amount: number;
  source: string;
  idempotencyKey: string;
  lastError: string | null;
}

/**
 * The fingerprints that make an error message different every time it happens
 * — mirrors report-error's normalization so the same refund failure lands on
 * one aggregated row instead of a row per occurrence. Ids, long hex runs and
 * URLs become placeholders; three-digit folds are off so counts stay visible.
 */
async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function fingerprintFor(name: string, message: string, screen: string): Promise<string> {
  return (await sha256Hex(`${name}|${message}|${screen}`)).slice(0, 32);
}

/**
 * One aggregated admin-visible row, then one operator email per NEW failure
 * shape (the upsert answers whether this was the first). Returns void; every
 * problem inside is logged and swallowed.
 */
async function alertRefundFailure(
  supabaseUrl: string,
  serviceRoleKey: string,
  { amount, source, idempotencyKey, lastError }: AlertDetails,
): Promise<void> {
  const admin = createClient(supabaseUrl, serviceRoleKey);

  const message =
    `Auto-refund failed after ${MAX_ATTEMPTS} attempts. ` +
    `${source} charged ${amount} credits the athlete has not had returned. ` +
    `Key: ${idempotencyKey}. Last error: ${lastError ?? "unknown"}`;

  const fingerprint = await fingerprintFor(ADMIN.name, message, ADMIN.screen);
  const seenAt = new Date().toISOString();

  const reported = await admin.rpc("record_app_error_report", {
    p_fingerprint: fingerprint,
    p_app_version: ADMIN.version,
    p_name: ADMIN.name,
    p_message: message.slice(0, 1000),
    p_stack: `refund_key=${idempotencyKey} amount=${amount} source=${source}`.slice(0, 4000) || null,
    p_screen: ADMIN.screen,
    p_platform: "web",
    p_user_agent: null,
    p_seen_at: seenAt,
  });

  const first = !reported.error && (reported.data as { was_new?: boolean } | null)?.was_new === true;
  if (!first) return; // repeats of a known failure shape are counted, not mailed

  if (!emailConfigured()) return;
  try {
    await sendMail({
      to: Deno.env.get("OPERATOR_EMAIL") ?? "vaylosportssupport@gmail.com",
      subject: `Vaylo Sports: failed auto-refund — ${source}`,
      text: [
        "Vaylo Sports — an automatic refund failed and needs reconciliation",
        "",
        `Charged:     ${amount} credits (${source})`,
        `Refund key:  ${idempotencyKey}`,
        `Attempts:    ${MAX_ATTEMPTS}`,
        `Last error:  ${lastError ?? "unknown"}`,
        "",
        "The athlete was charged and the credits are still theirs to get back:",
        "re-run a refund with the SAME key via credits_grant, or fix manually.",
        "The charge row in credit_transactions is keyed with the spend key that",
        "derives this refund key, so charge and refund can be matched directly.",
        "",
        "Repeats of this failure shape are counted in app_error_reports under",
        "the credit_refund_failed fingerprint without sending another email.",
        "Triage at /admin/errors.",
      ].join("\n"),
    });
  } catch (e) {
    // The durable row already exists. A mail failure must not throw out of
    // refundCredits.
    console.error("refund alert email failed", e);
  }
}
