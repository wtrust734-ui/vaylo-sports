
-- Subscriptions table for Google Play readiness
CREATE TABLE public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  plan_type text NOT NULL DEFAULT 'free' CHECK (plan_type IN ('free', 'minimum', 'pro', 'elite')),
  status text NOT NULL DEFAULT 'free' CHECK (status IN ('free', 'trial', 'active', 'expired', 'cancelled')),
  started_at timestamp with time zone DEFAULT now(),
  expires_at timestamp with time zone,
  cancelled_at timestamp with time zone,
  purchase_token text,
  platform text DEFAULT 'web',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own subscription" ON public.subscriptions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own subscription" ON public.subscriptions
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own subscription" ON public.subscriptions
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);

-- Create default free subscription on new user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, credits)
  VALUES (NEW.id, 15);
  INSERT INTO public.subscriptions (user_id, plan_type, status)
  VALUES (NEW.id, 'free', 'free');
  RETURN NEW;
END;
$$;

-- Add perceived_exertion and form_rating to performance_logs
ALTER TABLE public.performance_logs ADD COLUMN IF NOT EXISTS perceived_exertion integer;
ALTER TABLE public.performance_logs ADD COLUMN IF NOT EXISTS form_rating integer;
ALTER TABLE public.performance_logs ADD COLUMN IF NOT EXISTS heart_rate_avg integer;
ALTER TABLE public.performance_logs ADD COLUMN IF NOT EXISTS calories_burned integer;

-- Enable realtime for subscriptions
ALTER PUBLICATION supabase_realtime ADD TABLE public.subscriptions;
