// ============================================================================
// USER TABLE REGISTRY — generated, do not hand-edit
// ----------------------------------------------------------------------------
// One list of every table that can hold a row belonging to an athlete, and the
// column(s) that identify them. Two functions depend on it:
//
//   delete-account  must DELETE every one of these
//   export-my-data   must RETURN every one of these
//
// They used to be separate lists, which is a trap: a table added for export but
// forgotten in deletion leaves personal data behind forever, and a table added
// for deletion but forgotten in export quietly under-delivers on an Article 20
// request. Sharing the list makes that failure impossible.
//
// Built by extracting the list from delete-account/index.ts, then adding
// user_blocks and content_reports. src/lib/safetyCompliance.test.ts asserts the
// tables named here still exist in supabase/migrations.
//
// `leaderboard_totals` is deliberately absent: it is a view over
// `points_events`, which IS listed, so its data is already exported.
// `account_deletion_events` is absent by design — it holds only a salted hash
// of a user id and no personal data.
// ============================================================================

/** table -> the column(s) that identify the athlete who owns the row. */
export const USER_TABLES: [table: string, columns: string[]][] = [
  ["accountability_groups", ["owner_id"]],
  ["accountability_members", ["user_id"]],
  ["achievements", ["user_id"]],
  ["activity_hypes", ["user_id"]],
  ["ai_call_events", ["user_id"]],
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
  // --- coach marketplace ---------------------------------------------------
  // Every row the marketplace can hold about a person. The two-sided tables
  // name BOTH columns: an order belongs to the buyer who paid and the coach who
  // is owed, and a delivery is written by one and read by the other, so either
  // account's deletion and export must see it. `coach_credit_wallet` and
  // `coach_credit_entries` are money-equivalent balances — they delete with the
  // account for the same reason `user_purchases` does, and any balance a coach
  // is still owed should be paid out before an account is closed (see
  // docs/COACH-MARKETPLACE.md §5).
  ["coach_applications", ["user_id"]],
  ["coach_credit_entries", ["user_id"]],
  ["coach_credit_wallet", ["user_id"]],
  ["coach_deliveries", ["coach_id", "buyer_id"]],
  ["coach_earnings", ["coach_id"]],
  ["coach_orders", ["buyer_id", "coach_id"]],
  ["coin_transactions", ["user_id"]],
  ["communities", ["owner_id"]],
  ["community_members", ["user_id"]],
  ["community_pinned_avatars", ["user_id"]],
  ["community_posts", ["user_id"]],
  ["competition_sessions", ["user_id"]],
  ["content_reports", ["reporter_id"]],
  ["creator_profiles", ["user_id"]],
  ["credit_transactions", ["user_id"]],
  ["cue_words", ["user_id"]],
  ["daily_action_logs", ["user_id"]],
  ["daily_actions", ["user_id"]],
  // Two-sided by nature: a message belongs to the sender who wrote it and the
  // recipient who was sent it, and deleting either account must take it away.
  ["direct_messages", ["sender_id", "recipient_id"]],
  ["equipment", ["user_id"]],
  ["event_pack_ownership", ["user_id"]],
  ["event_rivals", ["user_id"]],
  ["events", ["user_id"]],
  ["fair_usage_events", ["user_id"]],
  ["friend_codes", ["user_id"]],
  ["friend_requests", ["from_user_id", "to_user_id"]],
  ["friendships", ["user_id", "friend_id"]],
  // Guardian access is keyed on two people rather than one: the row belongs to
  // the pair, so either party's export and deletion must see it. The database
  // cascades a deletion from either `auth.users` side as well, but deletion and
  // export must agree, and this list is the only place that guarantees it.
  ["guardian_invites", ["athlete_user_id"]],
  ["guardian_links", ["guardian_user_id", "athlete_user_id"]],
  ["health_connections", ["user_id"]],
  // The provider credentials behind a connection. These were missing from the
  // registry until src/integrations/supabase/types.ts was regenerated and stopped
  // hiding them, which is precisely the failure this file's header warns about:
  // an OAuth access/refresh token is the athlete's, it is a credential, and a
  // "delete my account" that left it behind would leave a live grant to somebody's
  // wearable data with nothing to revoke it.
  ["health_connection_tokens", ["user_id"]],
  ["health_samples", ["user_id"]],
  ["health_sync_state", ["user_id"]],
  ["health_workouts", ["user_id"]],
  ["hrv_baselines", ["user_id"]],
  ["injury_logs", ["user_id"]],
  ["learning_feedback", ["user_id"]],
  ["learning_progress", ["user_id"]],
  // An athlete's breaks and unavailability. Deleted with the account like any
  // other own-row table: a recorded illness or wellbeing break is some of the
  // most personal data the app holds, and it must not outlive the account.
  ["life_events", ["user_id"]],
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
  // Ad-studio pipeline (admin-only surface, but the rows are athlete-scoped):
  // a deletion must not leave either table holding the account's jobs or chat.
  ["pipeline_chat", ["owner_id"]],
  ["pipeline_jobs", ["owner_id"]],
  ["plan_events", ["user_id"]],
  ["points_events", ["user_id"]],
  ["privacy_settings", ["user_id"]],
  ["process_goals", ["user_id"]],
  ["profiles", ["user_id"]],
  ["purchase_analytics", ["user_id"]],
  ["push_tokens", ["user_id"]],
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
  ["user_blocks", ["blocker_id"]],
  ["user_consumables", ["user_id"]],
  ["user_profile_cosmetics", ["user_id"]],
  ["user_purchases", ["user_id"]],
  ["user_region", ["user_id"]],
  ["user_rewards", ["user_id"]],
  ["user_roles", ["user_id"]],
  ["user_segments", ["user_id"]],
  ["user_settings", ["user_id"]],
  ["video_analysis_quota_reservations", ["user_id"]],
  ["video_analysis_request_claims", ["user_id"]],
  ["video_form_analyses", ["user_id"]],
  ["vpr_snapshots", ["user_id"]],
  ["water_logs", ["user_id"]],
  // In-flight OAuth state for a wearable connect. Short-lived, and still the
  // athlete's row: it names them and their provider, and there is no reason for it
  // to outlive the account.
  ["wearable_auth_states", ["user_id"]],
  ["weekly_reviews", ["user_id"]],
  // One row per historical import the athlete ran, holding how it ended and the
  // starting analysis they were shown. Their own record, so it exports and
  // deletes with them.
  ["workout_imports", ["user_id"]],
  ["workouts", ["user_id"]],
];

/** Columns that hold a user id but are owned by someone else (team assignment). */
export const isOwnedBy = (userId: string, row: Record<string, unknown>, columns: string[]): boolean =>
  columns.some((c) => row[c] === userId);
