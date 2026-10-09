import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { emailConfigured, sendMail, withFooter } from "../_shared/email.ts";

// ============================================================================
// waitlist-campaigns — the dated launch sequence, sent on a schedule
// ----------------------------------------------------------------------------
// This is the function pg_cron calls every day at 09:00 UTC. It decides which
// message, if any, is due, and sends it. Everything else about the launch
// sequence — the dates, the copy, "how many emails before launch" — lives in
// CAMPAIGNS below, so changing the plan is a review of one table rather than an
// archaeology of cron commands.
//
// Four decisions are worth stating, because each one is a place a version of
// this could quietly do harm:
//
//   1. It sends the EARLIEST due campaign only, then stops. The countdown is a
//      sequence: "one month to go" arriving after "one week to go" is worse than
//      not arriving. One campaign per run, strictly in date order, makes the
//      order structural instead of hopeful.
//
//   2. A countdown that is too far past its date is SKIPPED, not sent. If the
//      schedule was broken and the run happens a week late, "one week to go" is
//      now false, and mailing a false statement to the whole list is the exact
//      failure this whole file is arranged to avoid. The launch email is the one
//      exception: it is never stale, so it always sends.
//
//   3. Exactly-once is enforced in Postgres, not here. Every address is claimed
//      in waitlist_campaign_sends before the message is sent, so a retry, an
//      overlapping run, or a crash mid-batch cannot double-send. A failed send
//      gives the claim back so it is retried rather than recorded as delivered.
//
//   4. It responds before it sends. Forty SMTP conversations is tens of
//      seconds, far longer than the HTTP call that triggered it is willing to
//      wait, so the reply is a plan ("campaign X, N recipients") and the sending
//      runs in the background. That is safe precisely because of (3): if the
//      background work is cut off, nothing is lost and nothing is duplicated.
//
// Authorisation: this is not a public endpoint. verify_jwt is deliberately OFF
// for it (see supabase/config.toml) because the caller is pg_cron, which is not
// a Supabase user and holds no JWT — a scheduled job that has to authenticate as
// a person is a job that stops working when that person's session expires.
// Instead the caller must present WAITLIST_CRON_SECRET, a random value stored
// once in Supabase Vault and injected here as a function secret. The comparison
// is constant-time. The service key is also accepted, so the operator can run a
// campaign by hand without knowing the cron secret.
// ============================================================================

const BATCH_DEFAULT = 40;
const BATCH_MAX = 100;

/** The one date the whole sequence hangs off. UTC. */
const LAUNCH_AT = "2027-01-01T08:00:00Z";

/**
 * Public web app, used for "look around while you wait" links. Optional: when
 * it is unset the copy drops the link rather than printing a dead one.
 */
function siteUrl(): string | null {
  const value = (Deno.env.get("PUBLIC_APP_URL") ?? "").trim().replace(/\/+$/, "");
  return value || null;
}

/**
 * The Google Play listing, once it exists. Optional and read at send time, so
 * the launch email can name the real listing the moment it is published without
 * a code change — and, until then, say where to look instead of linking nothing.
 */
function playUrl(): string | null {
  const value = (Deno.env.get("PLAY_STORE_URL") ?? "").trim();
  if (!value) return null;
  return /^https:\/\/play\.google\.com\//.test(value) ? value : null;
}

/* --------------------------------------------------------------- content -- */

interface Campaign {
  key: string;
  /** When this becomes sendable. */
  sendAt: string;
  subject: string;
  /**
   * Skip rather than send if the run is more than this many days late.
   * `null` means never skip — used for the launch email, which cannot go stale.
   */
  skipIfLateDays: number | null;
  text: string;
  html: string;
}

function panel(inner: string): string {
  return `<!doctype html>
<html><body style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;line-height:1.55;color:#12172a">
${inner}
  <p style="color:#66708c;font-size:13px">Vaylo Sports &middot; vaylosportssupport@gmail.com</p>
</body></html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function link(url: string, label: string): string {
  return `<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>`;
}

/**
 * The sequence. Dates are UTC 08:00, deliberately an hour BEFORE the 09:00 daily
 * job, so a campaign is already due when the job runs. Sitting it exactly on the
 * job's own timestamp would make "is it due yet?" a coin-toss on clock skew, and
 * losing that toss delays the launch email by a whole day.
 *
 * Copy rule, the same one the site follows: no hype, no manufactured urgency,
 * no promise we cannot keep. The countdown says how many messages are left so
 * the next one is expected rather than a surprise, and the launch email is the
 * last one — which is stated, because it is true.
 */
function campaigns(): Campaign[] {
  const site = siteUrl();
  const play = playUrl();

  const announceText = [
    "Hello,",
    "",
    "There is a date now. Vaylo Sports opens on the Google Play Store on",
    "1 January 2027.",
    "",
    "You are getting this because you joined the waiting list and asked to be",
    "told when that happened. This is the first of three messages before launch:",
    "one a week before, one the day before, and then the link when it is live.",
    "",
    "The app is not on the Store yet. Nothing is needed from you now, and there",
    "is nothing to buy. If the date moves, you will be told that too.",
  ].join("\n");

  const announceHtml = panel(`  <p>Hello,</p>
  <p><strong>There is a date now.</strong> Vaylo Sports opens on the Google Play
  Store on <strong>1 January 2027</strong>.</p>
  <p>You are getting this because you joined the waiting list and asked to be told
  when that happened. This is the first of three messages before launch: one a week
  before, one the day before, and then the link when it is live.</p>
  <p>The app is not on the Store yet. Nothing is needed from you now, and there is
  nothing to buy. If the date moves, you will be told that too.</p>`);

  const weekText = [
    "Hello,",
    "",
    "Vaylo Sports opens on the Google Play Store in one week, on 1 January 2027.",
    "",
    "Nothing to do now. This is the second of three messages before launch; the",
    "last one arrives the day before it opens, and it will carry the link.",
    ...(site
      ? ["", "You can look around the app in your browser in the meantime — it", `runs on the same backend as the Android release: ${site}`]
      : []),
  ].join("\n");

  const weekHtml = panel(`  <p>Hello,</p>
  <p>Vaylo Sports opens on the Google Play Store in <strong>one week</strong>, on
  <strong>1 January 2027</strong>.</p>
  <p>Nothing to do now. This is the second of three messages before launch; the last
  one arrives the day before it opens, and it will carry the link.</p>${
    site
      ? `\n  <p>You can look around the app in your browser in the meantime &mdash; it runs
  on the same backend as the Android release: ${link(site, "open the web app")}.</p>`
      : ""
  }`);

  const tomorrowText = [
    "Hello,",
    "",
    "Vaylo Sports opens on the Google Play Store tomorrow, 1 January 2027.",
    "",
    "You will get one more message when the listing is live, with the link.",
    "That one is the last email this address will receive.",
  ].join("\n");

  const tomorrowHtml = panel(`  <p>Hello,</p>
  <p>Vaylo Sports opens on the Google Play Store <strong>tomorrow</strong>, on
  <strong>1 January 2027</strong>.</p>
  <p>You will get one more message when the listing is live, with the link. That one
  is the last email this address will receive.</p>`);

  // The launch email. It links the Play listing when one is configured and, when
  // it is not, points at the site and says plainly that the Store link is not
  // published yet — rather than linking a dead listing page.
  const launchText = [
    "Hello,",
    "",
    "Vaylo Sports is on the Google Play Store. It is open now.",
    "",
    ...(play
      ? [`${play}`]
      : [
          "The Play listing link is not in this message yet — it will appear on",
          ...(site ? [`the site as soon as it is published: ${site}`] : ["our site as soon as it is published."]),
          "Until then, search the Play Store for \"Vaylo Sports\".",
        ]),
    "",
    "That is the last email this address will get, and it is the only reason it",
    "was ever collected. Thank you for waiting.",
  ].join("\n");

  const launchHtml = panel(`  <p>Hello,</p>
  <p><strong>Vaylo Sports is on the Google Play Store. It is open now.</strong></p>${
    play
      ? `\n  <p><a href="${escapeHtml(play)}">Open Vaylo Sports on Google Play</a></p>`
      : `\n  <p>The Play listing link is not in this message yet &mdash; it ${
          site ? `appears on ${link(site, "the site")} as soon as it is published` : "will be published shortly"
        }. Until then, search the Play Store for &ldquo;Vaylo Sports&rdquo;.</p>`
  }
  <p>That is the last email this address will get, and it is the only reason it was
  ever collected. Thank you for waiting.</p>`);

  return [
    {
      key: "countdown-30",
      sendAt: "2026-12-02T08:00:00Z",
      subject: "Vaylo Sports opens on 1 January 2027",
      skipIfLateDays: 3,
      text: announceText,
      html: announceHtml,
    },
    {
      key: "countdown-7",
      sendAt: "2026-12-25T08:00:00Z",
      subject: "One week until Vaylo Sports opens",
      skipIfLateDays: 2,
      text: weekText,
      html: weekHtml,
    },
    {
      key: "countdown-1",
      sendAt: "2026-12-31T08:00:00Z",
      subject: "Vaylo Sports opens tomorrow",
      skipIfLateDays: 1,
      text: tomorrowText,
      html: tomorrowHtml,
    },
    {
      key: "launch",
      sendAt: LAUNCH_AT,
      subject: "Vaylo Sports is live on Google Play",
      // Never stale: a late "it is live" is still true, so it is never skipped.
      skipIfLateDays: null,
      text: launchText,
      html: launchHtml,
    },
  ];
}

/* ------------------------------------------------------------ plumbing -- */

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Length-independent comparison for a secret. */
function constantTimeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
  return diff === 0;
}

function authorised(req: Request, cronSecret: string, serviceKey: string): boolean {
  const header = req.headers.get("x-cron-secret") ?? "";
  if (header && constantTimeEqual(header, cronSecret)) return true;
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (bearer && constantTimeEqual(bearer, serviceKey)) return true;
  return false;
}

/**
 * Keep working after the response. The claim ledger makes this safe: work that
 * is cut off mid-flight leaves a stale claim that the next run reclaims, and
 * work that completes leaves 'sent' rows that the next run will not repeat.
 */
function background(task: () => Promise<void>): void {
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } })
    .EdgeRuntime;
  const started = task().catch((error) => {
    console.error("waitlist campaign run failed", String(error).slice(0, 200));
  });
  if (runtime?.waitUntil) {
    runtime.waitUntil(started);
    return;
  }
  void started;
}

const DAY_MS = 24 * 60 * 60 * 1000;

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const cronSecret = Deno.env.get("WAITLIST_CRON_SECRET");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!cronSecret || !serviceKey) return json({ error: "server_not_configured" }, 500);
  if (!authorised(req, cronSecret, serviceKey)) return json({ error: "forbidden" }, 403);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

  // -------------------------------------------------------------------------
  // Sync the schedule from the copy table above. Only send_at is written on
  // conflict, so a campaign's finished/skipped state survives a redeploy. A
  // campaign that has been REMOVED from the code leaves its row behind; it is
  // reported as unknown below rather than blocking the sequence.
  // -------------------------------------------------------------------------
  const defs = campaigns();
  const { error: syncError } = await admin
    .from("waitlist_campaigns")
    .upsert(
      defs.map((c) => ({ campaign_key: c.key, send_at: c.sendAt })),
      { onConflict: "campaign_key" },
    );
  if (syncError) {
    console.error("campaign sync failed", syncError.code);
    return json({ error: "sync_failed" }, 500);
  }

  const now = Date.now();
  const { data: rows, error: listError } = await admin
    .from("waitlist_campaigns")
    .select("campaign_key, send_at, status")
    .neq("status", "done")
    .neq("status", "skipped")
    .lte("send_at", new Date(now).toISOString())
    .order("send_at", { ascending: true });

  if (listError) {
    console.error("campaign list failed", listError.code);
    return json({ error: "list_failed" }, 500);
  }

  // -------------------------------------------------------------------------
  // Choose exactly one campaign: the earliest due one that is still worth
  // sending. Too-late countdowns (and rows for campaigns no longer in code) are
  // skipped here, so they cannot hold the sequence up or go out misleading.
  // -------------------------------------------------------------------------
  const byKey = new Map(defs.map((c) => [c.key, c]));
  let chosen: Campaign | null = null;
  const skipped: string[] = [];

  for (const row of rows ?? []) {
    const def = byKey.get(row.campaign_key);
    const lateBy = (now - new Date(row.send_at).getTime()) / DAY_MS;

    if (!def) {
      await admin
        .from("waitlist_campaigns")
        .update({ status: "skipped", updated_at: new Date().toISOString() })
        .eq("campaign_key", row.campaign_key);
      skipped.push(row.campaign_key);
      continue;
    }

    if (def.skipIfLateDays !== null && lateBy > def.skipIfLateDays) {
      await admin
        .from("waitlist_campaigns")
        .update({ status: "skipped", updated_at: new Date().toISOString() })
        .eq("campaign_key", def.key);
      skipped.push(def.key);
      continue;
    }

    chosen = def;
    break;
  }

  if (!chosen) return json({ ok: true, sent: 0, skipped, message: "nothing due" });

  const batch = Math.min(BATCH_DEFAULT, BATCH_MAX);
  const { data: recipients, error: recipientsError } = await admin.rpc(
    "waitlist_campaign_recipients",
    { p_campaign_key: chosen.key, p_limit: batch },
  );

  if (recipientsError) {
    console.error("campaign recipients failed", recipientsError.code);
    return json({ error: "recipients_failed" }, 500);
  }

  const list = (recipients ?? []) as {
    email: string;
    display_name: string | null;
    unsubscribe_token: string;
  }[];

  if (list.length === 0) {
    await admin
      .from("waitlist_campaigns")
      .update({
        status: "done",
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        last_run_at: new Date().toISOString(),
      })
      .eq("campaign_key", chosen.key);
    return json({ ok: true, campaign: chosen.key, sent: 0, skipped, message: "complete" });
  }

  if (!emailConfigured()) {
    return json(
      {
        error: "email_not_configured",
        message: "GMAIL_USER and GMAIL_APP_PASSWORD are not set for this project.",
      },
      500,
    );
  }

  const def = chosen;

  background(async () => {
    let sent = 0;

    // Sequential, not parallel: Gmail rate-limits per connection and per second,
    // and a burst of parallel SMTP conversations from one address is what gets
    // an account throttled.
    for (const row of list) {
      const claim = await admin.rpc("waitlist_claim_campaign_send", {
        p_campaign_key: def.key,
        p_email: row.email,
      });
      if (claim.error) {
        console.error("campaign claim failed", claim.error.code);
        continue;
      }
      // false means somebody else owns it, or it has already been sent. Skipping
      // is the whole point of the ledger.
      if (claim.data !== true) continue;

      try {
        const footer = withFooter(def.html, def.text, row.unsubscribe_token);
        await sendMail({
          to: row.email,
          subject: def.subject,
          text: footer.text,
          html: footer.html,
          unsubscribeUrl: footer.link || undefined,
        });
        await admin.rpc("waitlist_mark_campaign_sent", {
          p_campaign_key: def.key,
          p_email: row.email,
        });
        await admin
          .from("waitlist_signups")
          .update({ last_emailed_at: new Date().toISOString() })
          .eq("email", row.email);
        sent++;
      } catch (failure) {
        // Give the claim back so the next run retries this address: a failure
        // must look unsent, not delivered.
        await admin.rpc("waitlist_release_campaign_send", {
          p_campaign_key: def.key,
          p_email: row.email,
        });
        console.error("campaign send failed", String(failure).slice(0, 200));
      }
    }

    const { data: remaining } = await admin.rpc("waitlist_campaign_remaining", {
      p_campaign_key: def.key,
    });
    const { count } = await admin
      .from("waitlist_campaign_sends")
      .select("email", { count: "exact", head: true })
      .eq("campaign_key", def.key)
      .eq("status", "sent");

    const finished = remaining === 0;
    await admin
      .from("waitlist_campaigns")
      .update({
        last_run_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        sent_count: count ?? sent,
        ...(finished ? { status: "done", completed_at: new Date().toISOString() } : {}),
      })
      .eq("campaign_key", def.key);
  });

  return json({
    ok: true,
    campaign: chosen.key,
    subject: chosen.subject,
    batch: list.length,
    skipped,
    message: "sending in background",
  });
});
