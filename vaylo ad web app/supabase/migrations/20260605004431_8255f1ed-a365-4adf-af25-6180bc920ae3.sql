
-- Economy config (remote-tunable)
CREATE TABLE public.economy_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL,
  region text NOT NULL DEFAULT 'GLOBAL',
  value jsonb NOT NULL,
  ab_variant text DEFAULT 'default',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (key, region, ab_variant)
);
GRANT SELECT ON public.economy_config TO anon, authenticated;
GRANT ALL ON public.economy_config TO service_role;
ALTER TABLE public.economy_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read economy config" ON public.economy_config FOR SELECT USING (active = true);

-- Special offers
CREATE TABLE public.special_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  description text,
  offer_type text NOT NULL, -- starter | limited | double_credits | loyalty | winback
  pack_id text,
  bonus_multiplier numeric DEFAULT 1.0,
  bonus_flat int DEFAULT 0,
  price_cents int,
  region text DEFAULT 'GLOBAL',
  starts_at timestamptz,
  ends_at timestamptz,
  target_audience text DEFAULT 'all', -- all | new | inactive | whale | returning
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.special_offers TO anon, authenticated;
GRANT ALL ON public.special_offers TO service_role;
ALTER TABLE public.special_offers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read active offers" ON public.special_offers FOR SELECT USING (active = true);

-- Purchase analytics
CREATE TABLE public.purchase_analytics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  event_type text NOT NULL, -- view | add_to_basket | purchase | offer_view | offer_convert
  pack_id text,
  offer_slug text,
  region text,
  currency text DEFAULT 'USD',
  amount_cents int DEFAULT 0,
  credits_granted int DEFAULT 0,
  bonus_granted int DEFAULT 0,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.purchase_analytics TO authenticated;
GRANT ALL ON public.purchase_analytics TO service_role;
ALTER TABLE public.purchase_analytics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users insert own analytics" ON public.purchase_analytics FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users read own analytics" ON public.purchase_analytics FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- User region/currency
CREATE TABLE public.user_region (
  user_id uuid PRIMARY KEY,
  country text NOT NULL DEFAULT 'US',
  currency text NOT NULL DEFAULT 'USD',
  detected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.user_region TO authenticated;
GRANT ALL ON public.user_region TO service_role;
ALTER TABLE public.user_region ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own region" ON public.user_region FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Infinite credits flag on profiles (best-effort: ignore if not possible)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS infinite_credits boolean DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS infinite_credits_until timestamptz;

-- Seed default economy config (global)
INSERT INTO public.economy_config (key, region, value) VALUES
  ('credit_packs', 'GLOBAL', '[
    {"id":"pack_25","credits":25,"bonus":0,"price_cents":249,"label":"Starter"},
    {"id":"pack_50","credits":50,"bonus":10,"price_cents":499,"label":"Boost"},
    {"id":"pack_120","credits":120,"bonus":25,"price_cents":999,"label":"Popular","popular":true},
    {"id":"pack_200","credits":200,"bonus":50,"price_cents":1499,"label":"Power"},
    {"id":"pack_500","credits":500,"bonus":150,"price_cents":2499,"label":"Elite","best_value":true}
  ]'::jsonb),
  ('infinite_packs', 'GLOBAL', '[
    {"id":"infinite_lifetime","price_cents":4999,"period":"lifetime","label":"Lifetime"},
    {"id":"infinite_monthly","price_cents":299,"period":"month","label":"Monthly"},
    {"id":"infinite_yearly","price_cents":2499,"period":"year","label":"Yearly","best_value":true}
  ]'::jsonb),
  ('feature_costs', 'GLOBAL', '{
    "archetype_view": 2,
    "development_trajectory": 5,
    "cross_sport_unlock": 49,
    "training_plan_week": 7,
    "form_analysis_unlock": 59,
    "injury_management_unlock": 49,
    "calorie_scan": 17,
    "nutrition_plan_week": 16,
    "mental_gym_unlock": 49,
    "vaylo_coach_message": 2,
    "learning_unlock": 29
  }'::jsonb);

-- Seed sample offers
INSERT INTO public.special_offers (slug, title, description, offer_type, pack_id, bonus_flat, price_cents, target_audience, ends_at) VALUES
  ('starter_pack', 'Welcome Bundle', '120 Credits + 80 Bonus — first-time only', 'starter', 'pack_120', 80, 799, 'new', now() + interval '7 days'),
  ('double_weekend', 'Double Credits Weekend', 'All packs come with 2x bonus credits', 'double_credits', null, 0, null, 'all', now() + interval '3 days'),
  ('winback_30', 'We Miss You', 'Come back and grab 200 credits + 100 bonus for $9.99', 'winback', 'pack_200', 100, 999, 'inactive', now() + interval '30 days');
