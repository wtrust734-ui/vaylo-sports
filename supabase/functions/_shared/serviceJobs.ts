/**
 * serviceJobs — one durable row per charged AI call, linked to the ledger.
 *
 * Why the charge key and not a new id passed around every function: the debit
 * already carries a deterministic idempotency key written by credits_spend().
 * Reusing it means the charge row, the service job and any refund case can be
 * joined with a single value the server generated itself — nothing the browser
 * can choose.
 *
 * Status semantics, and why they are conservative:
 *   started    charged, no recorded outcome (crashed, still running, or older
 *              code). A refund request for this state goes to a HUMAN, never to
 *              automatic restoration, because "started" is not "failed".
 *   delivered  the function reached its success return.
 *   failed     the automatic refund path established a genuine failure.
 *
 * Every helper is best-effort: a bookkeeping failure must never turn a working
 * AI call into an error, and must never block a refund that is otherwise owed.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.0";

interface JobEnv {
  supabaseUrl: string;
  serviceRoleKey: string;
}

export interface BeginServiceJobArgs extends JobEnv {
  userId: string;
  feature: string;
  chargeKey: string | null | undefined;
  credits: number;
  metadata?: Record<string, unknown>;
}

/** Records the charge as a started job. No-op without a charge key. */
export async function beginServiceJob({
  supabaseUrl,
  serviceRoleKey,
  userId,
  feature,
  chargeKey,
  credits,
  metadata,
}: BeginServiceJobArgs): Promise<string | null> {
  if (!chargeKey || !userId || !feature) return null;
  try {
    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data, error } = await admin
      .from("service_jobs")
      .insert({
        user_id: userId,
        feature,
        charge_key: chargeKey,
        credits: Math.max(0, Math.floor(credits)),
        status: "started",
        metadata: metadata ?? {},
      })
      .select("id")
      .maybeSingle();
    if (error) {
      // 23505 = the same charge was already recorded (a retried spend collapsed
      // into the existing debit). That is success, not failure.
      if ((error as { code?: string }).code !== "23505") {
        console.error("service job insert failed", error.message);
      }
      return null;
    }
    return (data as { id?: string } | null)?.id ?? null;
  } catch (error) {
    console.error("service job insert threw", error);
    return null;
  }
}

/** Marks a charged job as delivered. Never overwrites a recorded failure. */
export async function markServiceJobDelivered({
  supabaseUrl,
  serviceRoleKey,
  userId,
  chargeKey,
}: JobEnv & { userId: string; chargeKey: string | null | undefined }): Promise<void> {
  if (!chargeKey) return;
  try {
    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { error } = await admin
      .from("service_jobs")
      .update({ status: "delivered", finished_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("charge_key", chargeKey)
      .eq("status", "started");
    if (error) console.error("service job deliver mark failed", error.message);
  } catch (error) {
    console.error("service job deliver mark threw", error);
  }
}

/** Marks a charged job as failed. Never overwrites a recorded delivery. */
export async function markServiceJobFailed({
  supabaseUrl,
  serviceRoleKey,
  userId,
  chargeKey,
  errorCode,
}: JobEnv & {
  userId: string;
  chargeKey: string | null | undefined;
  errorCode?: string | null;
}): Promise<void> {
  if (!chargeKey) return;
  try {
    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { error } = await admin
      .from("service_jobs")
      .update({
        status: "failed",
        error_code: errorCode ?? null,
        finished_at: new Date().toISOString(),
      })
      .eq("user_id", userId)
      .eq("charge_key", chargeKey)
      .eq("status", "started");
    if (error) console.error("service job failure mark failed", error.message);
  } catch (error) {
    console.error("service job failure mark threw", error);
  }
}
