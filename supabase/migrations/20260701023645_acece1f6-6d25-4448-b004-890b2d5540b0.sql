DROP VIEW IF EXISTS public.leaderboard_totals;
CREATE VIEW public.leaderboard_totals WITH (security_invoker=true) AS
SELECT user_id, sport, SUM(points)::int AS points, MAX(occurred_at) AS last_event
FROM public.points_events GROUP BY user_id, sport;
GRANT SELECT ON public.leaderboard_totals TO authenticated, anon;