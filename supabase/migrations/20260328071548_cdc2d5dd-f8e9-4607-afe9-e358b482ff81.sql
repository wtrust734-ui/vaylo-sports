
-- Events table for race countdowns and result tracking
CREATE TABLE public.events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  sport TEXT NOT NULL DEFAULT 'Running',
  event_date TIMESTAMPTZ NOT NULL,
  location TEXT,
  notes TEXT,
  strategy TEXT,
  prediction_time TEXT,
  actual_time TEXT,
  actual_position INTEGER,
  distance_km NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own events" ON public.events FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Event rival results
CREATE TABLE public.event_rivals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id UUID REFERENCES public.events(id) ON DELETE CASCADE NOT NULL,
  user_id UUID NOT NULL,
  rival_name TEXT NOT NULL,
  result_time TEXT,
  position INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.event_rivals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own event rivals" ON public.event_rivals FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Friends system
CREATE TABLE public.friend_codes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  code TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.friend_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view all friend codes" ON public.friend_codes FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can insert own code" ON public.friend_codes FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.friend_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  from_user_id UUID NOT NULL,
  to_user_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(from_user_id, to_user_id)
);
ALTER TABLE public.friend_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own requests" ON public.friend_requests FOR SELECT TO authenticated USING (auth.uid() = from_user_id OR auth.uid() = to_user_id);
CREATE POLICY "Users can send requests" ON public.friend_requests FOR INSERT TO authenticated WITH CHECK (auth.uid() = from_user_id);
CREATE POLICY "Users can update requests to them" ON public.friend_requests FOR UPDATE TO authenticated USING (auth.uid() = to_user_id);

CREATE TABLE public.friendships (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  friend_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, friend_id)
);
ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own friendships" ON public.friendships FOR SELECT TO authenticated USING (auth.uid() = user_id OR auth.uid() = friend_id);
CREATE POLICY "Users can insert friendships" ON public.friendships FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete friendships" ON public.friendships FOR DELETE TO authenticated USING (auth.uid() = user_id OR auth.uid() = friend_id);

-- Market basket
CREATE TABLE public.basket_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  price_cents INTEGER NOT NULL DEFAULT 0,
  product_type TEXT NOT NULL DEFAULT 'feature',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.basket_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own basket" ON public.basket_items FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Nutrition plans
CREATE TABLE public.nutrition_plans (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  goal TEXT,
  calories_target INTEGER,
  protein_target INTEGER,
  carbs_target INTEGER,
  fat_target INTEGER,
  plan_data JSONB,
  weeks INTEGER NOT NULL DEFAULT 1,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.nutrition_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own nutrition plans" ON public.nutrition_plans FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Performance logs for pace calc / training logs
CREATE TABLE public.performance_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  log_type TEXT NOT NULL DEFAULT 'race',
  title TEXT,
  distance_km NUMERIC,
  time_seconds INTEGER,
  pace_per_km TEXT,
  sport TEXT,
  notes TEXT,
  log_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.performance_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own performance logs" ON public.performance_logs FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Add unique constraint for friend_codes user lookup
CREATE INDEX idx_friend_codes_code ON public.friend_codes(code);
CREATE INDEX idx_friendships_user ON public.friendships(user_id);
CREATE INDEX idx_friendships_friend ON public.friendships(friend_id);
CREATE INDEX idx_events_user ON public.events(user_id);
CREATE INDEX idx_performance_logs_user ON public.performance_logs(user_id);
