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

    // Every table that stores personal data keyed by user_id.
    const tables = [
      "profiles", "subscriptions", "user_purchases", "purchase_analytics", "user_segments",
      "credit_transactions", "coin_transactions", "basket_items", "user_region", "user_settings",
      "notification_prefs", "notifications",
      "workouts", "performance_metrics", "performance_logs", "training_loads", "training_plans",
      "plan_events", "team_assignments", "vpr_snapshots",
      "recovery_logs", "hrv_baselines", "injury_logs", "equipment",
      "meal_logs", "water_logs", "nutrition_plans",
      "achievements", "points_events", "streaks", "challenge_participants", "challenges",
      "events", "event_rivals", "competition_sessions", "tactical_plans",
      "outcome_goals", "process_goals", "daily_actions", "daily_action_logs", "weekly_reviews",
      "accountability_groups", "accountability_members",
      "mental_checkins", "mental_reviews", "cue_words",
      "coach_conversations", "coach_messages", "coach_memories", "coach_bookings",
      "video_form_analyses", "learning_progress", "athlete_position",
      "avatars", "avatar_items", "user_profile_cosmetics", "user_rewards", "user_consumables",
      "chest_claims", "creator_profiles", "marketplace_listings",
      "communities", "community_members", "community_posts", "community_pinned_avatars",
      "teams", "team_members",
      "privacy_settings", "friend_codes", "friend_requests", "friendships",
      "referral_codes", "referrals", "user_roles",
    ];

    for (const t of tables) {
      const { error } = await admin.from(t).delete().eq("user_id", userId);
      if (error) console.log(`skip ${t}: ${error.message}`);
    }

    // Ownership / relationship columns that are not named user_id.
    const extras: Array<[string, string]> = [
      ["communities", "owner_id"],
      ["accountability_groups", "owner_id"],
      ["teams", "owner_id"],
      ["friendships", "friend_id"],
      ["friend_requests", "from_user_id"],
      ["friend_requests", "to_user_id"],
      ["referrals", "referrer_id"],
      ["referrals", "referee_id"],
      ["coach_bookings", "coach_id"],
    ];
    for (const [t, col] of extras) {
      const { error } = await admin.from(t).delete().eq(col, userId);
      if (error) console.log(`skip ${t}.${col}: ${error.message}`);
    }

    // Remove any uploaded files owned by the user across all storage buckets.
    try {
      const { data: buckets } = await admin.storage.listBuckets();
      for (const bucket of buckets ?? []) {
        const { data: files } = await admin.storage.from(bucket.name).list(userId, { limit: 1000 });
        if (files?.length) {
          await admin.storage.from(bucket.name).remove(files.map((f) => `${userId}/${f.name}`));
        }
      }
    } catch (e) {
      console.log("storage cleanup skipped:", e instanceof Error ? e.message : e);
    }

    // Remove authentication credentials last (cascades any remaining FKs).
    const { error: delErr } = await admin.auth.admin.deleteUser(userId);
    if (delErr) throw delErr;

    // Anonymous audit trail — no personal data retained.
    await admin.from("account_deletion_events").insert({ user_ref: userRef, status: "completed" });

    inFlight.delete(userId);
    return json({ success: true, deleted_at: new Date().toISOString() });
  } catch (e) {
    if (userId) inFlight.delete(userId);
    console.error("delete-account error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
