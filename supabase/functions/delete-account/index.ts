import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

// Max age (seconds) of the auth token that may authorise a deletion.
const MAX_TOKEN_AGE_SECONDS = 30 * 60;
// Guard against concurrent / repeated requests for the same user.
const inFlight = new Set<string>();

async function hashRef(userId: string): Promise<string> {
  const data = new TextEncoder().encode(`vaylo-deletion:${userId}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Every table that can hold a row belonging to an athlete, with the column(s)
// that identify them.
//
// This list is the whole point of the function, so two things about it matter:
//
// 1. It is exhaustive. It was built by cross-referencing every table in the
//    schema for a user-identifying column, not by guessing from table names.
//    The previous version was missing `event_pack_ownership`,
//    `fair_usage_events`, `learning_feedback`, `shared_activities` and
//    `activity_hypes` entirely — rows that would have survived deletion forever.
//
// 2. Every column name exists. The previous version deleted several tables by a
//    `user_id` column they do not have (`challenges` and `marketplace_listings`
//    use `creator_id`, `team_assignments` uses `assigned_to`/`assigned_by`), so
//    those deletes failed and were swallowed by a `console.log` — while the
//    function still answered `success: true`.
//
// `leaderboard_totals` is deliberately absent: it is a view over `points_events`,
// so it needs no deletion. `account_deletion_events` is absent by design — it
// keeps only a salted hash of the user id, no personal data.
// ---------------------------------------------------------------------------
const USER_TABLES: [table: string, columns: string[]][] = [
  ["accountability_groups", ["owner_id"]],
  ["accountability_members", ["user_id"]],
  ["achievements", ["user_id"]],
  ["activity_hypes", ["user_id"]],
  ["athlete_position", ["user_id"]],
  ["avatar_items", ["user_id"]],
  ["avatars", ["user_id"]],
  ["basket_items", ["user_id"]],
  ["challenge_participants", ["user_id"]],
  ["challenges", ["creator_id"]],
  ["chest_claims", ["user_id"]],
  ["coach_bookings", ["coach_id"]],
  ["coach_conversations", ["user_id"]],
  ["coach_memories", ["user_id"]],
  ["coach_messages", ["user_id"]],
  ["coin_transactions", ["user_id"]],
  ["communities", ["owner_id"]],
  ["community_members", ["user_id"]],
  ["community_pinned_avatars", ["user_id"]],
  ["community_posts", ["user_id"]],
  ["competition_sessions", ["user_id"]],
  ["creator_profiles", ["user_id"]],
  ["credit_transactions", ["user_id"]],
  ["cue_words", ["user_id"]],
  ["daily_action_logs", ["user_id"]],
  ["daily_actions", ["user_id"]],
  ["equipment", ["user_id"]],
  ["event_pack_ownership", ["user_id"]],
  ["event_rivals", ["user_id"]],
  ["events", ["user_id"]],
  ["fair_usage_events", ["user_id"]],
  ["friend_codes", ["user_id"]],
  ["friend_requests", ["from_user_id", "to_user_id"]],
  ["friendships", ["user_id", "friend_id"]],
  ["health_connections", ["user_id"]],
  ["health_samples", ["user_id"]],
  ["health_sync_state", ["user_id"]],
  ["health_workouts", ["user_id"]],
  ["hrv_baselines", ["user_id"]],
  ["injury_logs", ["user_id"]],
  ["learning_feedback", ["user_id"]],
  ["learning_progress", ["user_id"]],
  ["marketplace_listings", ["creator_id"]],
  ["meal_logs", ["user_id"]],
  ["mental_checkins", ["user_id"]],
  ["mental_reviews", ["user_id"]],
  ["notification_prefs", ["user_id"]],
  ["notifications", ["user_id"]],
  ["nutrition_plans", ["user_id"]],
  ["outcome_goals", ["user_id"]],
  ["performance_logs", ["user_id"]],
  ["performance_metrics", ["user_id"]],
  ["plan_events", ["user_id"]],
  ["points_events", ["user_id"]],
  ["privacy_settings", ["user_id"]],
  ["process_goals", ["user_id"]],
  ["profiles", ["user_id"]],
  ["purchase_analytics", ["user_id"]],
  ["recovery_logs", ["user_id"]],
  ["referral_codes", ["user_id"]],
  ["referrals", ["referrer_id", "referee_id"]],
  ["shared_activities", ["user_id"]],
  ["streaks", ["user_id"]],
  ["subscriptions", ["user_id"]],
  ["tactical_plans", ["user_id"]],
  ["team_assignments", ["assigned_to", "assigned_by"]],
  ["team_members", ["user_id"]],
  ["teams", ["owner_id"]],
  ["training_loads", ["user_id"]],
  ["training_plans", ["user_id"]],
  ["user_consumables", ["user_id"]],
  ["user_profile_cosmetics", ["user_id"]],
  ["user_purchases", ["user_id"]],
  ["user_region", ["user_id"]],
  ["user_rewards", ["user_id"]],
  ["user_roles", ["user_id"]],
  ["user_segments", ["user_id"]],
  ["user_settings", ["user_id"]],
  ["video_form_analyses", ["user_id"]],
  ["vpr_snapshots", ["user_id"]],
  ["water_logs", ["user_id"]],
  ["weekly_reviews", ["user_id"]],
  ["workouts", ["user_id"]],
];

/**
 * Rows that hang off a container the athlete owns. These are removed by the
 * container's id before the container itself, so a child row can never be left
 * behind pointing at a parent that no longer exists.
 */
const CONTAINER_CHILDREN: { child: string; childColumn: string; parent: string; parentColumn: string }[] = [
  { child: "team_assignments", childColumn: "team_id", parent: "teams", parentColumn: "owner_id" },
  { child: "team_members", childColumn: "team_id", parent: "teams", parentColumn: "owner_id" },
  { child: "community_posts", childColumn: "community_id", parent: "communities", parentColumn: "owner_id" },
  { child: "community_members", childColumn: "community_id", parent: "communities", parentColumn: "owner_id" },
  { child: "community_pinned_avatars", childColumn: "community_id", parent: "communities", parentColumn: "owner_id" },
  { child: "challenge_participants", childColumn: "challenge_id", parent: "challenges", parentColumn: "creator_id" },
  { child: "accountability_members", childColumn: "group_id", parent: "accountability_groups", parentColumn: "owner_id" },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let userId: string | null = null;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Not authenticated" }, 401);
    const token = authHeader.replace("Bearer ", "").trim();

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: { user }, error: authError } = await admin.auth.getUser(token);
    if (authError || !user) return json({ error: "Unauthorized" }, 401);

    // The caller can only ever delete the identity attached to their own token.
    userId = user.id;

    // Require recent authentication (fresh token) before destructive action.
    try {
      const payload = JSON.parse(atob(token.split(".")[1]));
      const issuedAt = Number(payload.iat ?? 0);
      const age = Math.floor(Date.now() / 1000) - issuedAt;
      if (!issuedAt || age > MAX_TOKEN_AGE_SECONDS) {
        return json({ error: "reauth_required", message: "Please sign in again before deleting your account." }, 403);
      }
    } catch (_) {
      return json({ error: "reauth_required" }, 403);
    }

    // An explicit confirmation is required, and it is required in the BODY.
    //
    // This function has no action parameter and no dry run: before this, any
    // authenticated POST with a fresh token deleted the account, including one
    // with a malformed or unexpected body. That is one stray client bug, one
    // replayed request, or one careless probe away from destroying an account
    // that cannot be recovered. The client-side confirmation screen is a
    // courtesy to the athlete, not a control on the server.
    //
    // `dry_run` answers with what would be removed, which is what a deletion
    // screen should be able to show and what makes this endpoint safe to probe.
    let dryRun = false;
    try {
      const parsed = (await req.clone().json()) as { confirm?: unknown; dry_run?: unknown };
      dryRun = parsed.dry_run === true;
      if (parsed.confirm !== true && !dryRun) {
        return json(
          { error: "confirmation_required", message: "Send { confirm: true } to delete the account." },
          400
        );
      }
    } catch {
      return json(
        { error: "confirmation_required", message: "Send { confirm: true } to delete the account." },
        400
      );
    }

    if (inFlight.has(userId)) {
      return json({ error: "in_progress", message: "A deletion request is already being processed." }, 429);
    }
    inFlight.add(userId);

    const userRef = await hashRef(userId);

    // Reject rapid repeat attempts using the anonymous audit log.
    const { data: recent } = await admin
      .from("account_deletion_events")
      .select("id, created_at")
      .eq("user_ref", userRef)
      .gte("created_at", new Date(Date.now() - 60_000).toISOString())
      .limit(1);
    if (recent && recent.length > 0) {
      inFlight.delete(userId);
      return json({ error: "too_many_requests", message: "Deletion already requested. Please wait a moment." }, 429);
    }

    const failures: string[] = [];

    // Nothing above this line has touched a row, so a dry run can stop here and
    // report the shape of the deletion without performing any of it.
    if (dryRun) {
      inFlight.delete(userId);
      return json({
        success: true,
        dry_run: true,
        tables_checked: USER_TABLES.length,
        dependent_relations: CONTAINER_CHILDREN.length,
        message: "Nothing was deleted. Send { confirm: true } to proceed.",
      });
    }

    // --- 1. Dependent rows of containers this athlete owns -------------------
    for (const { child, childColumn, parent, parentColumn } of CONTAINER_CHILDREN) {
      const { data: owned, error: lookupErr } = await admin
        .from(parent)
        .select("id")
        .eq(parentColumn, userId);
      if (lookupErr) { failures.push(`lookup ${parent}: ${lookupErr.message}`); continue; }
      const ids = (owned ?? []).map((r) => r.id);
      if (ids.length === 0) continue;
      const { error } = await admin.from(child).delete().in(childColumn, ids);
      if (error) failures.push(`${child} by ${childColumn}: ${error.message}`);
    }

    // --- 2. Every row keyed to the athlete -----------------------------------
    for (const [table, columns] of USER_TABLES) {
      for (const column of columns) {
        const { error } = await admin.from(table).delete().eq(column, userId);
        if (error) failures.push(`${table}.${column}: ${error.message}`);
      }
    }

    // --- 3. Uploaded files ---------------------------------------------------
    // The app has no upload feature today, so this normally finds nothing. Kept
    // so that adding uploads later can't silently leave files behind.
    try {
      const { data: buckets } = await admin.storage.listBuckets();
      for (const bucket of buckets ?? []) {
        const { data: files } = await admin.storage.from(bucket.name).list(userId, { limit: 1000 });
        if (files?.length) {
          const { error } = await admin.storage.from(bucket.name).remove(files.map((f) => `${userId}/${f.name}`));
          if (error) failures.push(`storage ${bucket.name}: ${error.message}`);
        }
      }
    } catch (e) {
      failures.push(`storage: ${e instanceof Error ? e.message : String(e)}`);
    }

    // --- 4. The identity itself (cascades any remaining foreign keys) --------
    const { error: delErr } = await admin.auth.admin.deleteUser(userId);
    if (delErr) {
      inFlight.delete(userId);
      console.error("delete-account: auth deletion failed:", delErr.message);
      return json({ error: "deletion_failed", message: delErr.message }, 500);
    }

    // --- 5. Verify the wipe --------------------------------------------------
    // Counting after the identity is gone catches anything the deletes missed:
    // a wrong column name, a table missing from the registry, or a policy that
    // silently refused. Nothing here is reported as success on trust.
    const residuals: { table: string; column: string; rows: number }[] = [];
    for (const [table, columns] of USER_TABLES) {
      for (const column of columns) {
        const { count, error } = await admin
          .from(table)
          .select("*", { count: "exact", head: true })
          .eq(column, userId);
        if (error) {
          // A count can legitimately fail if the table was dropped; report it
          // rather than pretending the table is clean.
          residuals.push({ table, column, rows: -1 });
          continue;
        }
        if ((count ?? 0) > 0) residuals.push({ table, column, rows: count ?? 0 });
      }
    }

    // The identity must be unrecoverable too.
    const { data: stillThere } = await admin.auth.admin.getUserById(userId);
    const identityGone = !stillThere?.user;

    if (residuals.length > 0 || !identityGone || failures.length > 0) {
      inFlight.delete(userId);
      console.error("delete-account: INCOMPLETE", JSON.stringify({ residuals, identityGone, failures }));
      return json({
        error: "incomplete",
        message: "Some data could not be deleted. This has been logged — please contact support.",
        residuals,
        identity_removed: identityGone,
        failures,
      }, 500);
    }

    // --- 6. Anonymous audit trail — no personal data retained -----------------
    await admin.from("account_deletion_events").insert({ user_ref: userRef, status: "completed" });

    inFlight.delete(userId);
    return json({
      success: true,
      verified: true,
      tables_checked: USER_TABLES.length,
      deleted_at: new Date().toISOString(),
    });
  } catch (e) {
    if (userId) inFlight.delete(userId);
    console.error("delete-account error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
