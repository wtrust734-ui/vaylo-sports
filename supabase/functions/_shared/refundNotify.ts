/**
 * refundNotify — durable e-mail delivery for refund cases.
 *
 * The rule that shapes this file: the CASE is written first, the e-mail second.
 * A mail failure therefore never loses a refund, and the outbox row is the
 * durable record that somebody still needs to be told. Delivery is attempted
 * immediately, then retried by `refund-notify` with bounded exponential backoff.
 *
 * Exactly-once is not promised (SMTP cannot promise it), but exactly-once
 * *attempt* is: a row is claimed by flipping pending → sending with a
 * conditional update, and a duplicate request hits the unique
 * (case_id, kind, dedupe_key) index and returns the existing row. A stale claim
 * (worker died mid-send) is reclaimed after ten minutes, so a crash cannot
 * silence a notification forever.
 */
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.100.0";
import { emailConfigured, sendMail } from "./email.ts";
import { buildCustomerEmail } from "./refundEmail.ts";

export type NotificationKind = "admin_review" | "customer_update";

export interface EnqueueNotificationArgs {
  caseId: string;
  kind: NotificationKind;
  /** Stable per-notification key, e.g. "admin_review" or "status:completed". */
  dedupeKey: string;
  recipient: string;
  subject: string;
  body: string;
}

export interface OutboxRow {
  id: string;
  case_id: string;
  kind: NotificationKind;
  dedupe_key: string;
  recipient: string;
  subject: string;
  body: string;
  status: "pending" | "sending" | "sent" | "failed";
  attempts: number;
  last_error: string | null;
  next_attempt_at: string;
  sent_at: string | null;
  created_at: string;
}

// `SupabaseClient` with its default type arguments, not
// `ReturnType<typeof createClient>`: the latter instantiates a generic
// function's parameters with their constraints (unknown) and collapses every
// `.from(...)` payload to `never`, so the outbox writes stop type-checking.
// Same documented choice as ad-engine-tick and manus-invoke.
type Admin = SupabaseClient;

/** Never more than this many attempts; after that a person must intervene. */
export const MAX_NOTIFICATION_ATTEMPTS = 6;
const BASE_BACKOFF_MS = 2 * 60 * 1000;
const MAX_BACKOFF_MS = 6 * 60 * 60 * 1000;
const STALE_CLAIM_MS = 10 * 60 * 1000;

/**
 * Persists the notification if it does not already exist. Returns the row id
 * (new or existing) so the caller can attempt delivery now.
 */
export async function enqueueNotification(
  admin: Admin,
  args: EnqueueNotificationArgs
): Promise<string | null> {
  const { data, error } = await admin
    .from("refund_notifications")
    .insert({
      case_id: args.caseId,
      kind: args.kind,
      dedupe_key: args.dedupeKey,
      recipient: args.recipient,
      subject: args.subject,
      body: args.body,
    })
    .select("id")
    .maybeSingle();

  if (!error) return (data as { id?: string } | null)?.id ?? null;

  // 23505 = this notification already exists. That is the dedupe working.
  if ((error as { code?: string }).code === "23505") {
    const { data: existing } = await admin
      .from("refund_notifications")
      .select("id")
      .eq("case_id", args.caseId)
      .eq("kind", args.kind)
      .eq("dedupe_key", args.dedupeKey)
      .maybeSingle();
    return (existing as { id?: string } | null)?.id ?? null;
  }

  console.error("refund notification enqueue failed", error.message);
  return null;
}

/**
 * Claims and sends one row. Safe to call concurrently: only the caller whose
 * conditional update matched sends.
 */
export async function deliverNotification(
  admin: Admin,
  row: Pick<OutboxRow, "id" | "recipient" | "subject" | "body" | "attempts">
): Promise<"sent" | "failed" | "skipped"> {
  const { data: claimed } = await admin
    .from("refund_notifications")
    .update({ status: "sending" })
    .eq("id", row.id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (!claimed) return "skipped";

  const attempts = row.attempts + 1;

  if (!emailConfigured()) {
    await admin
      .from("refund_notifications")
      .update({
        status: "pending",
        attempts,
        last_error: "email_not_configured",
        next_attempt_at: new Date(Date.now() + BASE_BACKOFF_MS).toISOString(),
      })
      .eq("id", row.id);
    return "failed";
  }

  try {
    await sendMail({ to: row.recipient, subject: row.subject, text: row.body });
    await admin
      .from("refund_notifications")
      .update({
        status: "sent",
        attempts,
        last_error: null,
        sent_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    return "sent";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const exhausted = attempts >= MAX_NOTIFICATION_ATTEMPTS;
    const backoff = Math.min(BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1), MAX_BACKOFF_MS);
    await admin
      .from("refund_notifications")
      .update({
        status: exhausted ? "failed" : "pending",
        attempts,
        last_error: message.slice(0, 500),
        next_attempt_at: new Date(Date.now() + backoff).toISOString(),
      })
      .eq("id", row.id);
    console.error(`refund notification send failed (${attempts}/${MAX_NOTIFICATION_ATTEMPTS})`, message);
    return "failed";
  }
}

/** Enqueue + immediate attempt, returning the row id regardless of outcome. */
export async function notifyNow(admin: Admin, args: EnqueueNotificationArgs): Promise<string | null> {
  const id = await enqueueNotification(admin, args);
  if (!id) return null;
  const { data: row } = await admin
    .from("refund_notifications")
    .select("id, recipient, subject, body, attempts, status")
    .eq("id", id)
    .maybeSingle();
  if (!row) return id;
  const typed = row as Pick<OutboxRow, "id" | "recipient" | "subject" | "body" | "attempts" | "status">;
  if (typed.status === "pending") await deliverNotification(admin, typed);
  return id;
}

/**
 * Mails the customer about a decision. The address comes from the auth record,
 * never from the request; a missing address is skipped rather than guessed.
 */
export async function notifyCustomerOfCase(
  admin: Admin,
  args: {
    caseId: string;
    userId: string;
    publicRef: string;
    status: string;
    dedupeKey: string;
    message: string;
    note?: string | null;
  }
): Promise<string | null> {
  try {
    const { data } = await admin.auth.admin.getUserById(args.userId);
    const email = data?.user?.email;
    if (!email) return null;
    const mail = buildCustomerEmail({
      publicRef: args.publicRef,
      status: args.status,
      customerMessage: args.message,
      note: args.note ?? null,
    });
    return await notifyNow(admin, {
      caseId: args.caseId,
      kind: "customer_update",
      dedupeKey: args.dedupeKey,
      recipient: email,
      subject: mail.subject,
      body: mail.text,
    });
  } catch (error) {
    // A missing mail must never fail a decision that has already been recorded.
    console.error("customer refund notification failed", error instanceof Error ? error.name : error);
    return null;
  }
}

/**
 * Retries every due notification, plus stale claims. Used by the cron function
 * and by "Retry notification" on the admin case page.
 */
export async function retryDueNotifications(
  admin: Admin,
  opts: { caseId?: string; limit?: number; includeFailed?: boolean } = {}
): Promise<{ attempted: number; sent: number; failed: number }> {
  // The cron passes no caseId and only ever sees work that is still due. An
  // administrator pressing "Retry unsent email" on one case sets includeFailed:
  // rows that exhausted their automatic attempts are exactly what they are
  // there to rescue, and without this they would be permanently invisible to
  // the retry query.
  let query = admin
    .from("refund_notifications")
    .select("id, recipient, subject, body, attempts, status, next_attempt_at, created_at")
    .in("status", opts.includeFailed ? ["pending", "sending", "failed"] : ["pending", "sending"])
    .order("created_at", { ascending: true })
    .limit(opts.limit ?? 25);
  if (!opts.includeFailed) query = query.lt("attempts", MAX_NOTIFICATION_ATTEMPTS);
  if (opts.caseId) query = query.eq("case_id", opts.caseId);

  const { data, error } = await query;
  if (error) {
    console.error("refund notification retry query failed", error.message);
    return { attempted: 0, sent: 0, failed: 0 };
  }

  let attempted = 0;
  let sent = 0;
  let failed = 0;
  for (const raw of (data ?? []) as Array<OutboxRow>) {
    // A manual retry ignores the backoff clock (the admin is asking now) but
    // still respects a live claim: another worker may be sending it.
    const manual = opts.includeFailed === true;
    const exhausted = raw.status === "failed";
    const due =
      raw.status === "pending" && (manual || Date.parse(raw.next_attempt_at) <= Date.now());
    const stale =
      raw.status === "sending" && Date.now() - Date.parse(raw.created_at) > STALE_CLAIM_MS;
    if (!due && !stale && !(exhausted && manual)) continue;

    if (exhausted && manual) {
      // Re-open one attempt of headroom so a further failure is marked failed
      // again instead of silently looping.
      await admin
        .from("refund_notifications")
        .update({ status: "pending", attempts: MAX_NOTIFICATION_ATTEMPTS - 1 })
        .eq("id", raw.id)
        .eq("status", "failed");
    }

    if (stale) {
      // The previous worker never came back. Reclaim it explicitly so the
      // conditional pending claim below can succeed.
      await admin
        .from("refund_notifications")
        .update({ status: "pending" })
        .eq("id", raw.id)
        .eq("status", "sending");
    }

    attempted += 1;
    const outcome = await deliverNotification(admin, {
      ...raw,
      attempts: exhausted && manual ? MAX_NOTIFICATION_ATTEMPTS - 1 : raw.attempts,
    });
    if (outcome === "sent") sent += 1;
    if (outcome === "failed") failed += 1;
  }
  return { attempted, sent, failed };
}
