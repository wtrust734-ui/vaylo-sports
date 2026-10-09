import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { sendMail } from "../_shared/email.ts";

// ============================================================================
// sponsor-enquiry — the endpoint behind the /sponsors/ questionnaire
// ----------------------------------------------------------------------------
// A brand fills in a short questionnaire on the website and presses send. This
// function stores the answers and emails the operator, so the enquiry reaches a
// human rather than sitting in a dashboard nobody is watching.
//
// What it does, in order:
//   1. rejects anything that is not a POST
//   2. drops honeypot submissions, answering exactly as it would on success
//   3. validates the fields a human can actually fill in
//   4. re-derives the interest answers from a closed key set, so a crafted
//      request cannot invent a key or smuggle a value past the whitelist
//   5. rate-limits per client address
//   6. inserts with the service role, and answers with a short reference
//   7. emails the operator, including what can actually be delivered today
//
// What it deliberately does NOT do:
//
//   * create a brand, a placement, or any kind of reservation. An enquiry is not
//     a contract, and nothing here changes what the app serves to an athlete.
//     Turning one into a live deal stays the manual step in SPONSORSHIP.md,
//     because a brand only becomes visible after somebody has read the
//     disclosure obligations and set `status = 'active'` on purpose.
//
//   * fail the request because mail failed. The row is stored by then, so a mail
//     outage must cost a delayed reply, never a lost lead. The response says so
//     plainly instead of claiming an email is on its way.
//
//   * promise anything the product cannot do. The questionnaire offers an
//     "AI preference" option, which is NOT implemented — SPONSORSHIP.md records
//     that slot as "data model only". It is recorded here as an expression of
//     interest and the operator's email says so in as many words, because a lead
//     that arrives pre-loaded with an assumption we do not meet is worse than no
//     lead. The published advertising disclosure also promises that placement
//     choice never changes what an athlete's own coaching says, and that promise
//     is not ours to sell.
// ============================================================================

/** Closed interest set. Keys are the questionnaire's, not the client's. */
const INTEREST_KEYS = [
  "sponsored_challenges",
  "sponsored_achievements",
  "learning_slot",
  "post_session_slot",
  "leaderboard",
  "ai_preference",
] as const;

type InterestKey = (typeof INTEREST_KEYS)[number];

/**
 * What Vaylo can actually deliver for each interest today.
 *
 * Printed into the operator's email so a deal is never quoted from an
 * assumption. Kept here rather than derived from the placements table because
 * `learning_slot` and `post_session_slot` have a ready component but no live
 * placement, and that distinction is exactly the one a sales conversation gets
 * wrong.
 */
const DELIVERABILITY: Record<InterestKey, "live" | "component_ready" | "not_implemented"> = {
  sponsored_challenges: "live",
  sponsored_achievements: "live",
  learning_slot: "component_ready",
  post_session_slot: "component_ready",
  leaderboard: "component_ready",
  ai_preference: "not_implemented",
};

const DELIVERABILITY_NOTE: Record<string, string> = {
  live: "live today",
  component_ready: "built, not yet placed on a page",
  not_implemented: "NOT IMPLEMENTED — interest only",
};

/** Submissions from one client address per hour. */
const RATE_LIMIT = 3;
const MAX_GOALS = 4000;
/** Sports/regions are a short pick, not a payload. */
const MAX_TAGS = 24;
const MAX_TAG_LEN = 60;

/**
 * The terms versions this function will record.
 *
 * A closed set, not a free string: the row's whole purpose is to be proof that
 * a specific version was accepted, so accepting "whatever the client said"
 * would make the record worthless. The version is the advertising disclosure's
 * version, which is where the brand and sponsorship enquiry terms live
 * (section 8). 1.0 is kept so a page cached from before the section existed
 * still records something true rather than being rejected outright.
 */
const ACCEPTED_TERMS_VERSIONS = new Set(["1.0", "1.1"]);

const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Short, quotable reference. Avoids ambiguous characters (no 0/O, no 1/I) so it
 * can be read out loud, matching support_requests.
 */
function makeReference(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let out = "VYB-";
  for (let i = 0; i < 8; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

/**
 * Salted hash of the client address, for rate limiting and abuse investigation
 * only. Not a user identifier and not reused for anything else.
 */
async function hashIp(ip: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .slice(0, 12)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("cf-connecting-ip") ?? "unknown";
}

function clean(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

/**
 * A short list of tags, de-duplicated and length-bounded.
 *
 * Anything that is not a plain non-empty string is dropped rather than coerced:
 * a client sending `[{"$ne": null}]` should end up with nothing, not with a
 * stringified object stored as if the brand had chosen it.
 */
function cleanTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const tag = item.trim().slice(0, MAX_TAG_LEN);
    if (!tag) continue;
    if (!out.includes(tag)) out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

/** Where the enquiry goes. The one inbox the operator reads. */
const ENQUIRY_EMAIL = "vaylosportssupport@gmail.com";

interface Enquiry {
  reference: string;
  brandName: string;
  website: string | null;
  contactName: string | null;
  contactEmail: string;
  interests: Record<string, boolean>;
  sports: string[];
  regions: string[];
  goals: string | null;
}

/**
 * Hand a stored enquiry to the operator's inbox.
 *
 * Runs after the row is already written, so it can only ever *add* to what
 * happened. Returns true when the message was handed to SMTP, false when it was
 * not — the caller turns that into an honest note, because a lead that reached
 * a dashboard but not an inbox may sit unread for days.
 */
async function notifyOperator(enquiry: Enquiry): Promise<boolean> {
  const wanted = INTEREST_KEYS.filter((key) => enquiry.interests[key] === true);
  const declined = INTEREST_KEYS.filter((key) => enquiry.interests[key] === false);

  const interestLines = wanted.length
    ? wanted.map((key) => `  [x] ${key} — ${DELIVERABILITY_NOTE[DELIVERABILITY[key]]}`)
    : ["  (none selected)"];

  const subject = `Vaylo Sports: sponsor enquiry — ${enquiry.brandName}`;

  const text = [
    "Vaylo Sports",
    "A brand submitted the sponsorship questionnaire on the website.",
    "",
    `Reference: ${enquiry.reference}`,
    `Date: ${new Date().toISOString()}`,
    "",
    "--- Who is asking ---",
    `Brand: ${enquiry.brandName}`,
    `Contact: ${enquiry.contactName ?? "(blank)"}`,
    `Email: ${enquiry.contactEmail}`,
    `Website: ${enquiry.website ?? "(blank)"}`,
    "",
    "--- What they want ---",
    ...interestLines,
    declined.length ? `Also asked and declined: ${declined.join(", ")}` : "",
    "",
    `Sports: ${enquiry.sports.length ? enquiry.sports.join(", ") : "(all sports)"}`,
    `Regions: ${enquiry.regions.length ? enquiry.regions.join(", ") : "(all regions)"}`,
    "",
    "--- In their words ---",
    enquiry.goals ?? "(nothing written)",
    "",
    "--- Before you reply ---",
    "Read the 'what they want' lines above again. Anything marked",
    "'NOT IMPLEMENTED' or 'built, not yet placed on a page' is not something you",
    "can promise yet: SPONSORSHIP.md records ai_slot as a data model only.",
    "",
    "Two obligations apply to every deal, and they are not negotiable:",
    "  1. Sponsored content is 18+ only, enforced in the database, not the UI.",
    "  2. Every placement carries a disclosure label. An AI answer an athlete",
    "     reads as coaching must never be influenced by who is paying — the",
    "     advertising disclosure published on the site says so, so that promise",
    "     is already made and cannot be sold away.",
    "",
    "Nothing has been reserved or promised by this email. To make a deal real,",
    "create the brands row and the placement by hand, per SPONSORSHIP.md.",
  ]
    .filter((line) => line !== "")
    .join("\n");

  try {
    await sendMail({ to: ENQUIRY_EMAIL, subject, text });
    return true;
  } catch (error) {
    console.error("sponsor-enquiry: failed to email operator", error);
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "invalid_json", message: "The request could not be read." }, 400);
  }

  // ---------------------------------------------------------------------------
  // Honeypot. A real person never sees this field, so leaving it empty is the
  // only thing a browser can do. On a hit we answer exactly as we would on a
  // success: a rejected bot that gets an error learns the trap exists.
  // ---------------------------------------------------------------------------
  if (typeof payload.company_website === "string" && payload.company_website.trim() !== "") {
    return json({ ok: true, reference: makeReference(), received: true });
  }

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------
  const brandName = clean(payload.brand_name, 161);
  if (!brandName) {
    return json({ error: "invalid_brand", message: "Please tell us the brand or company name." }, 400);
  }
  if (brandName.length > 160) {
    return json({ error: "brand_too_long", message: "That brand name is too long." }, 400);
  }

  const contactEmail = clean(payload.contact_email, 321);
  if (!contactEmail || !EMAIL_RE.test(contactEmail)) {
    return json({ error: "invalid_email", message: "Please enter an email address we can reply to." }, 400);
  }
  if (contactEmail.length > 320) {
    return json({ error: "email_too_long", message: "That email address is too long." }, 400);
  }

  // ---------------------------------------------------------------------------
  // Terms acceptance. Required, and re-checked here rather than trusted from the
  // checkbox: the row records an accepted version and a date, and that claim has
  // to be true of the row, not merely of the form.
  // ---------------------------------------------------------------------------
  if (payload.terms_accepted !== true) {
    return json(
      {
        error: "terms_not_accepted",
        message: "Please accept the brand and sponsorship enquiry terms before sending.",
      },
      400,
    );
  }

  const termsVersion = clean(payload.terms_version, 41);
  if (!termsVersion || !ACCEPTED_TERMS_VERSIONS.has(termsVersion)) {
    return json(
      {
        error: "invalid_terms_version",
        message:
          "The terms have changed. Please reload the page and read the current version before sending.",
      },
      400,
    );
  }

  // ---------------------------------------------------------------------------
  // Interests, re-derived. Only the closed key set survives, and only a literal
  // true/false is kept — so a crafted request cannot add a key, and a string
  // "false" cannot be read as agreement.
  // ---------------------------------------------------------------------------
  const rawInterests =
    payload.interests && typeof payload.interests === "object" && !Array.isArray(payload.interests)
      ? (payload.interests as Record<string, unknown>)
      : {};

  const interests: Record<string, boolean> = {};
  for (const key of INTEREST_KEYS) {
    const value = rawInterests[key];
    if (value === true) interests[key] = true;
    else if (value === false) interests[key] = false;
  }

  const goals = clean(payload.goals, MAX_GOALS + 1);
  if (goals && goals.length > MAX_GOALS) {
    return json(
      { error: "goals_too_long", message: "That is too long. Please shorten it, or email us instead." },
      400,
    );
  }

  const website = clean(payload.website, 301);
  if (website && website.length > 300) {
    return json({ error: "website_too_long", message: "That website address is too long." }, 400);
  }

  const contactName = clean(payload.contact_name, 121);
  if (contactName && contactName.length > 120) {
    return json({ error: "contact_name_too_long", message: "That name is too long." }, 400);
  }

  const sports = cleanTags(payload.sports);
  const regions = cleanTags(payload.regions);

  // ---------------------------------------------------------------------------
  // Rate limit
  // ---------------------------------------------------------------------------
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const salt = Deno.env.get("SUPPORT_IP_SALT") ?? "vaylo-support";
  const ipHash = await hashIp(clientIp(req), salt);

  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await admin
    .from("sponsor_enquiries")
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
    .gt("created_at", since);

  if ((count ?? 0) >= RATE_LIMIT) {
    return json(
      {
        error: "rate_limited",
        message:
          "You have sent several enquiries recently. Please wait an hour, or email us directly if it is urgent.",
      },
      429,
    );
  }

  // ---------------------------------------------------------------------------
  // Store. A reference collision is astronomically unlikely but not impossible,
  // and a duplicate key here means we must not tell the brand it failed. Retry
  // with a fresh reference rather than losing a real enquiry to a 1-in-4-billion
  // event.
  // ---------------------------------------------------------------------------
  let lastError: string | null = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    const reference = makeReference();
    const { error } = await admin.from("sponsor_enquiries").insert({
      reference,
      brand_name: brandName,
      website,
      contact_name: contactName,
      contact_email: contactEmail,
      interests,
      sports,
      regions,
      goals,
      terms_version: termsVersion,
      terms_accepted_at: new Date().toISOString(),
      ip_hash: ipHash,
      user_agent: req.headers.get("user-agent"),
    });

    if (!error) {
      const emailed = await notifyOperator({
        reference,
        brandName,
        website,
        contactName,
        contactEmail,
        interests,
        sports,
        regions,
        goals,
      });

      // Best-effort bookkeeping. A failure here costs a column, never a lead.
      await admin
        .from("sponsor_enquiries")
        .update({
          email_message_sent: emailed,
          email_sent_at: emailed ? new Date().toISOString() : null,
        })
        .eq("reference", reference);

      return json({
        ok: true,
        reference,
        received: true,
        emailed,
        // Shown to the brand. Never claims a deal, a price, a reservation or a
        // reply time — it says the enquiry was received and what happens next.
        message: emailed
          ? "Received. We will read this and reply to the address you gave."
          : "Received and saved, but our email notification did not go out just now. Your enquiry is still in our queue and a person will read it — if it is urgent, please email us directly.",
      });
    }

    lastError = error.message;
    if (!/duplicate key/i.test(error.message)) break;
  }

  console.error("sponsor-enquiry: insert failed", lastError);
  return json(
    {
      error: "store_failed",
      message:
        "We could not save your enquiry just now. Nothing has been sent — please email us instead so we still get it.",
    },
    500,
  );
});
