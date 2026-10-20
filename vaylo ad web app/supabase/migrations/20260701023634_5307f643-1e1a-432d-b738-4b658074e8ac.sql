
-- Extend challenges table
ALTER TABLE public.challenges
  ADD COLUMN IF NOT EXISTS sport text,
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'custom',
  ADD COLUMN IF NOT EXISTS reward_credits integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS reward_points integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS icon text,
  ADD COLUMN IF NOT EXISTS is_official boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS participant_count integer NOT NULL DEFAULT 0;

-- Challenge participants
CREATE TABLE IF NOT EXISTS public.challenge_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id uuid NOT NULL REFERENCES public.challenges(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  progress numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active',
  joined_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (challenge_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.challenge_participants TO authenticated;
GRANT ALL ON public.challenge_participants TO service_role;
ALTER TABLE public.challenge_participants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read participants" ON public.challenge_participants FOR SELECT TO authenticated USING (true);
CREATE POLICY "join self" ON public.challenge_participants FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "update self" ON public.challenge_participants FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "leave self" ON public.challenge_participants FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Points ledger (scoring engine backbone)
CREATE TABLE IF NOT EXISTS public.points_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  points integer NOT NULL,
  source text NOT NULL,
  sport text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_points_user_time ON public.points_events(user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_points_sport_time ON public.points_events(sport, occurred_at DESC);
GRANT SELECT, INSERT ON public.points_events TO authenticated;
GRANT ALL ON public.points_events TO service_role;
ALTER TABLE public.points_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read points" ON public.points_events FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert self points" ON public.points_events FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- Award points (SECURITY DEFINER; capped)
CREATE OR REPLACE FUNCTION public.award_points(p_points integer, p_source text, p_sport text DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_points IS NULL OR p_points <= 0 THEN RAISE EXCEPTION 'Invalid points'; END IF;
  IF p_points > 5000 THEN RAISE EXCEPTION 'Points exceed limit'; END IF;
  INSERT INTO public.points_events(user_id, points, source, sport) VALUES (v_user, p_points, p_source, p_sport);
  RETURN p_points;
END $$;

-- Participant count maintenance
CREATE OR REPLACE FUNCTION public.sync_challenge_participant_count()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.challenges SET participant_count = participant_count + 1 WHERE id = NEW.challenge_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.challenges SET participant_count = GREATEST(0, participant_count - 1) WHERE id = OLD.challenge_id;
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_challenge_participant_count ON public.challenge_participants;
CREATE TRIGGER trg_challenge_participant_count AFTER INSERT OR DELETE ON public.challenge_participants
  FOR EACH ROW EXECUTE FUNCTION public.sync_challenge_participant_count();

-- Join / leave / progress RPCs
CREATE OR REPLACE FUNCTION public.join_challenge(p_challenge uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user uuid := auth.uid(); v_id uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  INSERT INTO public.challenge_participants(challenge_id, user_id) VALUES (p_challenge, v_user)
    ON CONFLICT (challenge_id, user_id) DO UPDATE SET status='active' RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.leave_challenge(p_challenge uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  DELETE FROM public.challenge_participants WHERE challenge_id = p_challenge AND user_id = v_user;
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.update_challenge_progress(p_challenge uuid, p_delta numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_row public.challenge_participants%ROWTYPE;
  v_ch public.challenges%ROWTYPE;
  v_completed boolean := false;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO v_ch FROM public.challenges WHERE id = p_challenge;
  IF NOT FOUND THEN RAISE EXCEPTION 'Challenge not found'; END IF;
  SELECT * INTO v_row FROM public.challenge_participants
    WHERE challenge_id = p_challenge AND user_id = v_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Not joined'; END IF;
  IF v_row.status = 'completed' THEN
    RETURN jsonb_build_object('progress', v_row.progress, 'completed', true, 'awarded', false);
  END IF;
  UPDATE public.challenge_participants
    SET progress = progress + p_delta
    WHERE id = v_row.id RETURNING * INTO v_row;
  IF v_row.progress >= v_ch.target_value THEN
    UPDATE public.challenge_participants SET status='completed', completed_at=now() WHERE id = v_row.id;
    v_completed := true;
    INSERT INTO public.points_events(user_id, points, source, sport)
      VALUES (v_user, v_ch.reward_points, 'challenge:'||v_ch.id, v_ch.sport);
    INSERT INTO public.achievements(user_id, type, title, description, icon)
      VALUES (v_user, 'challenge', 'Completed: '||v_ch.title, v_ch.description, COALESCE(v_ch.icon,'trophy'));
  END IF;
  RETURN jsonb_build_object('progress', v_row.progress, 'target', v_ch.target_value,
    'completed', v_completed, 'reward_points', v_ch.reward_points);
END $$;

-- Auto-award points from workouts & performance logs (scoring engine)
CREATE OR REPLACE FUNCTION public.award_activity_points()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pts integer := 0; v_sport text; v_uid uuid; v_dur integer; v_dist numeric; v_intensity integer;
BEGIN
  IF TG_TABLE_NAME = 'workouts' THEN
    IF NEW.completed IS NOT TRUE THEN RETURN NEW; END IF;
    IF TG_OP = 'UPDATE' AND OLD.completed IS TRUE THEN RETURN NEW; END IF;
    v_uid := NEW.user_id; v_sport := NEW.type; v_dur := COALESCE(NEW.duration_minutes,0);
    v_dist := COALESCE(NEW.distance_km,0); v_intensity := COALESCE(NEW.heart_rate_avg,0);
  ELSE
    v_uid := NEW.user_id; v_sport := NEW.sport;
    v_dur := COALESCE(NEW.time_seconds,0)/60; v_dist := COALESCE(NEW.distance_km,0);
    v_intensity := COALESCE(NEW.perceived_exertion,0)*10;
  END IF;
  -- Scoring: volume (duration+distance) + intensity + base
  v_pts := 20 + (v_dur * 2) + (v_dist * 5)::int + (v_intensity / 10);
  IF v_pts > 500 THEN v_pts := 500; END IF;
  IF v_pts > 0 THEN
    INSERT INTO public.points_events(user_id, points, source, sport)
      VALUES (v_uid, v_pts, TG_TABLE_NAME, v_sport);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_award_workout_points ON public.workouts;
CREATE TRIGGER trg_award_workout_points AFTER INSERT OR UPDATE OF completed ON public.workouts
  FOR EACH ROW EXECUTE FUNCTION public.award_activity_points();
DROP TRIGGER IF EXISTS trg_award_perflog_points ON public.performance_logs;
CREATE TRIGGER trg_award_perflog_points AFTER INSERT ON public.performance_logs
  FOR EACH ROW EXECUTE FUNCTION public.award_activity_points();

-- Leaderboard view (aggregate by period)
CREATE OR REPLACE VIEW public.leaderboard_totals AS
SELECT user_id, sport, SUM(points)::int AS points, MAX(occurred_at) AS last_event
FROM public.points_events GROUP BY user_id, sport;
GRANT SELECT ON public.leaderboard_totals TO authenticated, anon;
