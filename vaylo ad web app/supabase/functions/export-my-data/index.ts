import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { USER_TABLES } from "../_shared/userTables.ts";

// ============================================================================
// EXPORT MY DATA — UK GDPR Article 20 (data portability)
// ----------------------------------------------------------------------------
// Vaylo could not honour a portability request at all before this existed, and
// could not evidence that it could. Article 20 gives an individual the right
// to receive their personal data in a structured, commonly used,
// machine-readable format and to transmit it elsewhere.
//
// Design:
//
//   * The table list is SHARED with delete-account (../_shared/userTables.ts).
//     Two separate lists is a trap: a table added to one and forgotten in the
//     other means either data survives deletion forever, or an export quietly
//     under-delivers on a legal request. Both failure modes are unacceptable,
//     and both are prevented by having one list.
//
//   * Auth is by the caller's own access token, verified server-side. There is
//     no way to ask for anybody else's data — the userId is never a parameter.
//
//   * The service role is used ONLY to read, and ONLY rows already scoped to
//     this user id. Every query is `.eq(userColumn, userId)`; nothing is read
//     unscoped.
//
//   * Failures are REPORTED, not swallowed. A table that could not be read is
//     listed in `unreadable` with the reason, so the athlete and the operator
//     both know the export was partial. A silent partial export is worse than
//     no export: it is an inaccurate statement about completeness.
//
//   * `public.inventory` rows, storage objects and the auth identity are also
//     returned, because a portability request covers what you hold, not only
//     what is in a table with a user_id column.
// ============================================================================

const MAX_TOKEN_AGE_SECONDS = 30 * 60;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Strip fields that are credentials rather than personal data. */
function redact<T extends Record<string, unknown>>(row: T): T {
  const out = { ...row } as Record<string, unknown>;
  for (const k of ["encrypted_password", "password_hash", "recovery_token", "confirmation_token"]) {
    if (k in out) out[k] = "[redacted]";
  }
  return out as T;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST" && req.method !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return json({ error: "Sign in to export your data." }, 401);
  }
  const token = authHeader.replace("Bearer ", "").trim();

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const { data: { user }, error: authError } = await admin.auth.getUser(token);
  if (authError || !user) {
    return json({ error: "Your session has expired. Sign in again and retry." }, 401);
  }
  const userId = user.id;

  // A fresh token only, mirroring delete-account. An export is a bulk read of
  // everything about someone; it should not be triggerable by a long-lived
  // token that has been sitting in local storage.
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    const age = Math.floor(Date.now() / 1000) - Number(payload.iat ?? 0);
    if (age > MAX_TOKEN_AGE_SECONDS) {
      return json(
        { error: "For your security, export needs a recent sign-in. Please sign in again and retry." },
        403,
      );
    }
  } catch {
    // Not a JWT we can read an iat from. getUser already proved the token is
    // valid, so continue rather than blocking a legitimate request.
  }

  const data: Record<string, unknown> = {};
  const unreadable: { table: string; reason: string }[] = [];
  let tablesIncluded = 0;
  let totalRows = 0;

  for (const [table, columns] of USER_TABLES) {
    // A row belongs to this athlete if ANY identifying column matches, which is
    // what `friend_requests` (from/to), `team_assignments` (assigned_to/by) and
    // the referral tables need.
    const orFilter = columns.map((c) => `${c}.eq.${userId}`).join(",");

    const { data: rows, error } = await admin
      .from(table)
      .select("*")
      .or(orFilter)
      .limit(10000);

    if (error) {
      unreadable.push({ table, reason: error.message });
      continue;
    }
    data[table] = (rows ?? []).map(redact);
    tablesIncluded++;
    totalRows += (rows ?? []).length;
  }

  // The auth identity itself: email, provider, created_at, MFA enrolments.
  // Not stored in any public table, but unambiguously personal data about the
  // person making the request.
  data.account = {
    id: user.id,
    email: user.email ?? null,
    phone: user.phone ?? null,
    created_at: user.created_at,
    last_sign_in_at: user.last_sign_in_at ?? null,
    email_confirmed_at: user.email_confirmed_at ?? null,
    providers: user.app_metadata?.providers ?? [],
    identities: (user.identities ?? []).map((i) => ({
      provider: i.provider,
      identity_id: i.identity_id ?? null,
      created_at: i.created_at ?? null,
    })),
  };

  // Anything this athlete uploaded. Currently there are no storage buckets, so
  // this is a loop that returns nothing — but a portability request should not
  // depend on that staying true, and finding out at audit time is too late.
  const storageFiles: { bucket: string; path: string }[] = [];
  try {
    const { data: buckets } = await admin.storage.listBuckets();
    for (const b of buckets ?? []) {
      const { data: files } = await admin.storage.from(b.name).list(userId, { limit: 1000 });
      for (const f of files ?? []) storageFiles.push({ bucket: b.name, path: f.name });
    }
  } catch (err) {
    unreadable.push({ table: "storage", reason: String(err) });
  }
  data.uploaded_files = storageFiles;

  const body = {
    exported_at: new Date().toISOString(),
    format: "vaylo-portability-1",
    // Stated plainly so the athlete can judge completeness themselves.
    summary: {
      tables_included: tablesIncluded,
      tables_expected: USER_TABLES.length,
      total_rows: totalRows,
      uploaded_files: storageFiles.length,
      unreadable_tables: unreadable.length,
    },
    // Anything listed here did not make it into the export. Present and
    // visible rather than omitted.
    unreadable,
    data,
  };

  // A partial export is still returned — it is better than nothing — but it is
  // labelled partial so the client can say so on screen.
  if (unreadable.length > 0) {
    return json({ ...body, complete: false }, 206);
  }
  return json({ ...body, complete: true });
});
