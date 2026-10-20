
-- 1. Trial + tier expansion on subscriptions
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS billing_interval text DEFAULT 'monthly';

-- 2. Streaks
CREATE TABLE IF NOT EXISTS public.streaks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  current_streak int NOT NULL DEFAULT 0,
  longest_streak int NOT NULL DEFAULT 0,
  last_activity_date date,
  grace_used_on date,
  freezes_available int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.streaks TO authenticated;
GRANT ALL ON public.streaks TO service_role;
ALTER TABLE public.streaks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own streak" ON public.streaks FOR ALL TO authenticated USING (auth.uid()=user_id) WITH CHECK (auth.uid()=user_id);

-- 3. Notifications
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  type text NOT NULL,
  title text NOT NULL,
  body text,
  link text,
  read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own notifications" ON public.notifications FOR ALL TO authenticated USING (auth.uid()=user_id) WITH CHECK (auth.uid()=user_id);
CREATE INDEX IF NOT EXISTS idx_notifs_user ON public.notifications(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.notification_prefs (
  user_id uuid PRIMARY KEY,
  workout_reminders boolean NOT NULL DEFAULT true,
  friend_activity boolean NOT NULL DEFAULT true,
  streak_alerts boolean NOT NULL DEFAULT true,
  challenge_deadlines boolean NOT NULL DEFAULT true,
  reengagement boolean NOT NULL DEFAULT true,
  quiet_start time,
  quiet_end time,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.notification_prefs TO authenticated;
GRANT ALL ON public.notification_prefs TO service_role;
ALTER TABLE public.notification_prefs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own prefs" ON public.notification_prefs FOR ALL TO authenticated USING (auth.uid()=user_id) WITH CHECK (auth.uid()=user_id);

-- 4. Referrals
CREATE TABLE IF NOT EXISTS public.referral_codes (
  user_id uuid PRIMARY KEY,
  code text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.referral_codes TO authenticated;
GRANT ALL ON public.referral_codes TO service_role;
ALTER TABLE public.referral_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Codes readable" ON public.referral_codes FOR SELECT TO authenticated USING (true);
CREATE POLICY "Own code insert" ON public.referral_codes FOR INSERT TO authenticated WITH CHECK (auth.uid()=user_id);

CREATE TABLE IF NOT EXISTS public.referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id uuid NOT NULL,
  referee_id uuid NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending',
  reward_granted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.referrals TO authenticated;
GRANT ALL ON public.referrals TO service_role;
ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "See own referrals" ON public.referrals FOR SELECT TO authenticated USING (auth.uid()=referrer_id OR auth.uid()=referee_id);
CREATE POLICY "Insert as referee" ON public.referrals FOR INSERT TO authenticated WITH CHECK (auth.uid()=referee_id);

-- 5. Achievement shares
ALTER TABLE public.achievements ADD COLUMN IF NOT EXISTS share_count int NOT NULL DEFAULT 0;

-- 6. Creator marketplace
CREATE TABLE IF NOT EXISTS public.creator_profiles (
  user_id uuid PRIMARY KEY,
  display_name text NOT NULL,
  bio text,
  specialties text[],
  verified boolean NOT NULL DEFAULT false,
  payout_email text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.creator_profiles TO authenticated, anon;
GRANT INSERT, UPDATE ON public.creator_profiles TO authenticated;
GRANT ALL ON public.creator_profiles TO service_role;
ALTER TABLE public.creator_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read creators" ON public.creator_profiles FOR SELECT USING (true);
CREATE POLICY "Own creator profile" ON public.creator_profiles FOR ALL TO authenticated USING (auth.uid()=user_id) WITH CHECK (auth.uid()=user_id);

CREATE TABLE IF NOT EXISTS public.marketplace_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL,
  title text NOT NULL,
  description text,
  category text NOT NULL,
  price_cents int NOT NULL DEFAULT 0,
  duration_minutes int,
  cover_url text,
  active boolean NOT NULL DEFAULT true,
  rating numeric DEFAULT 0,
  sales_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.marketplace_listings TO authenticated, anon;
GRANT INSERT, UPDATE, DELETE ON public.marketplace_listings TO authenticated;
GRANT ALL ON public.marketplace_listings TO service_role;
ALTER TABLE public.marketplace_listings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read listings" ON public.marketplace_listings FOR SELECT USING (active);
CREATE POLICY "Creator manages own listings" ON public.marketplace_listings FOR ALL TO authenticated USING (auth.uid()=creator_id) WITH CHECK (auth.uid()=creator_id);

-- 7. Human coach bookings
CREATE TABLE IF NOT EXISTS public.coach_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id uuid NOT NULL,
  client_id uuid NOT NULL,
  starts_at timestamptz NOT NULL,
  duration_minutes int NOT NULL DEFAULT 30,
  price_cents int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  video_link text,
  rating int,
  review text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.coach_bookings TO authenticated;
GRANT ALL ON public.coach_bookings TO service_role;
ALTER TABLE public.coach_bookings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Booking participants read" ON public.coach_bookings FOR SELECT TO authenticated USING (auth.uid()=coach_id OR auth.uid()=client_id);
CREATE POLICY "Client books" ON public.coach_bookings FOR INSERT TO authenticated WITH CHECK (auth.uid()=client_id);
CREATE POLICY "Participants update" ON public.coach_bookings FOR UPDATE TO authenticated USING (auth.uid()=coach_id OR auth.uid()=client_id);

-- 8. Teams (proper)
CREATE TABLE IF NOT EXISTS public.teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  sport text,
  owner_id uuid NOT NULL,
  tier text NOT NULL DEFAULT 'starter',
  seat_limit int NOT NULL DEFAULT 10,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.teams TO authenticated;
GRANT ALL ON public.teams TO service_role;
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.team_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'athlete',
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(team_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.team_members TO authenticated;
GRANT ALL ON public.team_members TO service_role;
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_team_member(_team uuid, _user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.team_members WHERE team_id=_team AND user_id=_user)
$$;

CREATE POLICY "Members view team" ON public.teams FOR SELECT TO authenticated USING (auth.uid()=owner_id OR public.is_team_member(id, auth.uid()));
CREATE POLICY "Owners manage team" ON public.teams FOR ALL TO authenticated USING (auth.uid()=owner_id) WITH CHECK (auth.uid()=owner_id);

CREATE POLICY "Members view members" ON public.team_members FOR SELECT TO authenticated USING (public.is_team_member(team_id, auth.uid()) OR EXISTS(SELECT 1 FROM public.teams t WHERE t.id=team_members.team_id AND t.owner_id=auth.uid()));
CREATE POLICY "Owners add members" ON public.team_members FOR INSERT TO authenticated WITH CHECK (EXISTS(SELECT 1 FROM public.teams t WHERE t.id=team_id AND t.owner_id=auth.uid()) OR user_id=auth.uid());
CREATE POLICY "Owners remove members" ON public.team_members FOR DELETE TO authenticated USING (EXISTS(SELECT 1 FROM public.teams t WHERE t.id=team_id AND t.owner_id=auth.uid()) OR user_id=auth.uid());

CREATE TABLE IF NOT EXISTS public.team_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL,
  assigned_by uuid NOT NULL,
  assigned_to uuid,
  title text NOT NULL,
  description text,
  due_date date,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.team_assignments TO authenticated;
GRANT ALL ON public.team_assignments TO service_role;
ALTER TABLE public.team_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Team assignment access" ON public.team_assignments FOR ALL TO authenticated 
  USING (public.is_team_member(team_id, auth.uid()) OR EXISTS(SELECT 1 FROM public.teams t WHERE t.id=team_id AND t.owner_id=auth.uid()))
  WITH CHECK (public.is_team_member(team_id, auth.uid()) OR EXISTS(SELECT 1 FROM public.teams t WHERE t.id=team_id AND t.owner_id=auth.uid()));

-- 9. Streak update RPC (server-side logic)
CREATE OR REPLACE FUNCTION public.touch_streak()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_row public.streaks%ROWTYPE;
  v_today date := CURRENT_DATE;
  v_yesterday date := CURRENT_DATE - 1;
  v_two_ago date := CURRENT_DATE - 2;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO v_row FROM public.streaks WHERE user_id=v_user FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.streaks(user_id, current_streak, longest_streak, last_activity_date)
    VALUES (v_user, 1, 1, v_today) RETURNING * INTO v_row;
  ELSIF v_row.last_activity_date = v_today THEN
    -- already counted today
    NULL;
  ELSIF v_row.last_activity_date = v_yesterday THEN
    UPDATE public.streaks SET current_streak=current_streak+1,
      longest_streak=GREATEST(longest_streak, current_streak+1),
      last_activity_date=v_today, updated_at=now()
    WHERE user_id=v_user RETURNING * INTO v_row;
  ELSIF v_row.last_activity_date = v_two_ago AND (v_row.grace_used_on IS NULL OR v_row.grace_used_on < v_today - 14) THEN
    -- use grace day
    UPDATE public.streaks SET current_streak=current_streak+1,
      longest_streak=GREATEST(longest_streak, current_streak+1),
      last_activity_date=v_today, grace_used_on=v_today, updated_at=now()
    WHERE user_id=v_user RETURNING * INTO v_row;
  ELSIF v_row.freezes_available > 0 AND v_row.last_activity_date < v_yesterday THEN
    UPDATE public.streaks SET freezes_available=freezes_available-1,
      last_activity_date=v_today, updated_at=now()
    WHERE user_id=v_user RETURNING * INTO v_row;
  ELSE
    -- streak broken
    UPDATE public.streaks SET current_streak=1, last_activity_date=v_today, updated_at=now()
    WHERE user_id=v_user RETURNING * INTO v_row;
  END IF;
  RETURN jsonb_build_object('current', v_row.current_streak, 'longest', v_row.longest_streak, 'last', v_row.last_activity_date);
END $$;

-- 10. Referral attribution RPC
CREATE OR REPLACE FUNCTION public.redeem_referral(p_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_referrer uuid;
  v_existing uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT user_id INTO v_referrer FROM public.referral_codes WHERE code = upper(p_code);
  IF v_referrer IS NULL THEN RAISE EXCEPTION 'Invalid code'; END IF;
  IF v_referrer = v_user THEN RAISE EXCEPTION 'Cannot refer yourself'; END IF;
  SELECT id INTO v_existing FROM public.referrals WHERE referee_id = v_user;
  IF v_existing IS NOT NULL THEN RAISE EXCEPTION 'Already referred'; END IF;
  INSERT INTO public.referrals(referrer_id, referee_id, status, reward_granted_at)
  VALUES (v_referrer, v_user, 'granted', now());
  RETURN jsonb_build_object('ok', true, 'referrer', v_referrer);
END $$;
