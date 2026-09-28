-- Three cleanups from the security/performance audit.

-- ---------------------------------------------------------------------------
-- (1) 22 foreign keys without a covering index
-- ---------------------------------------------------------------------------
-- Postgres does not index the referencing side of a foreign key, so every
-- `delete from profiles/communities/challenges/...` currently seq-scans each of
-- these tables to find (or prove the absence of) children. Cheap now, not cheap
-- at scale. `if not exists` keeps this idempotent against any index added since.
create index if not exists idx_achievements_user_id on public.achievements (user_id);
create index if not exists idx_activity_hypes_user_id on public.activity_hypes (user_id);
create index if not exists idx_brand_placements_brand_id on public.brand_placements (brand_id);
create index if not exists idx_challenges_sponsor_brand_id on public.challenges (sponsor_brand_id);
create index if not exists idx_chest_claims_reward_id on public.chest_claims (reward_id);
create index if not exists idx_coach_messages_conversation_id on public.coach_messages (conversation_id);
create index if not exists idx_community_posts_community_id on public.community_posts (community_id);
create index if not exists idx_country_pricing_map_tier_code on public.country_pricing_map (tier_code);
create index if not exists idx_event_rivals_event_id on public.event_rivals (event_id);
create index if not exists idx_health_samples_workout_id on public.health_samples (workout_id);
create index if not exists idx_training_plans_user_id on public.training_plans (user_id);
create index if not exists idx_user_consumables_reward_id on public.user_consumables (reward_id);
create index if not exists idx_user_profile_cosmetics_background_id on public.user_profile_cosmetics (background_id);
create index if not exists idx_user_profile_cosmetics_badge_id on public.user_profile_cosmetics (badge_id);
create index if not exists idx_user_profile_cosmetics_border_id on public.user_profile_cosmetics (border_id);
create index if not exists idx_user_profile_cosmetics_effect_id on public.user_profile_cosmetics (effect_id);
create index if not exists idx_user_profile_cosmetics_name_color_id on public.user_profile_cosmetics (name_color_id);
create index if not exists idx_user_profile_cosmetics_theme_id on public.user_profile_cosmetics (theme_id);
create index if not exists idx_user_profile_cosmetics_title_id on public.user_profile_cosmetics (title_id);
create index if not exists idx_user_rewards_reward_id on public.user_rewards (reward_id);
create index if not exists idx_workouts_training_plan_id on public.workouts (training_plan_id);
create index if not exists idx_workouts_user_id on public.workouts (user_id);

-- ---------------------------------------------------------------------------
-- (2) Mutable search_path on a trigger function
-- ---------------------------------------------------------------------------
-- The only function in the schema that did not pin it. A SECURITY INVOKER
-- trigger with a caller-controlled search_path is a hijack vector: a role that
-- could create objects in a schema earlier on the path could shadow a name the
-- trigger body resolves. Every other function here already sets it.
alter function public.tg_health_connections_touch() set search_path to 'public';

-- ---------------------------------------------------------------------------
-- (3) Self-service points
-- ---------------------------------------------------------------------------
-- `award_points(p_points, p_source, p_sport)` let the caller name its own score
-- — capped at 500 per call and 2500 per 24h, but still a signed-in user writing
-- arbitrary rows into `points_events`, which is exactly what the leaderboard and
-- public profiles rank on. `award_activity_points()` is the same shape.
--
-- Neither has a live caller: `award_activity_points` is referenced nowhere at
-- all, and the client wrapper for `award_points` (src/lib/scoring.ts) is
-- exported but never invoked, so nothing in the app can be awarding points
-- today. Granting them back is a one-liner the moment scoring moves
-- server-side — which is the right shape, because the amount has to be decided
-- by the server for the number to mean anything.
revoke execute on function public.award_points(integer, text, text) from authenticated;
revoke execute on function public.award_activity_points() from authenticated;
