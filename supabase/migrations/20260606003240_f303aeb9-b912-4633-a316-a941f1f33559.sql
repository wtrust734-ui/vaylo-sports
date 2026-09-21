
-- =========================================================
-- PRICING TIERS
-- =========================================================
CREATE TABLE public.pricing_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  packs jsonb NOT NULL DEFAULT '[]'::jsonb,
  infinite jsonb NOT NULL DEFAULT '[]'::jsonb,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.pricing_tiers TO anon, authenticated;
GRANT ALL ON public.pricing_tiers TO service_role;
ALTER TABLE public.pricing_tiers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read pricing_tiers" ON public.pricing_tiers FOR SELECT USING (true);
CREATE POLICY "Admins manage pricing_tiers" ON public.pricing_tiers FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_pricing_tiers_updated BEFORE UPDATE ON public.pricing_tiers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================
-- COUNTRY → TIER MAPPING
-- =========================================================
CREATE TABLE public.country_pricing_map (
  country_code text PRIMARY KEY,
  country_name text NOT NULL,
  tier_code text NOT NULL REFERENCES public.pricing_tiers(code) ON UPDATE CASCADE,
  currency text NOT NULL DEFAULT 'USD',
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.country_pricing_map TO anon, authenticated;
GRANT ALL ON public.country_pricing_map TO service_role;
ALTER TABLE public.country_pricing_map ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read country_pricing_map" ON public.country_pricing_map FOR SELECT USING (true);
CREATE POLICY "Admins manage country_pricing_map" ON public.country_pricing_map FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_country_pricing_map_updated BEFORE UPDATE ON public.country_pricing_map
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================
-- USER SEGMENTS
-- =========================================================
CREATE TABLE public.user_segments (
  user_id uuid PRIMARY KEY,
  segment text NOT NULL DEFAULT 'new',
  purchase_count integer NOT NULL DEFAULT 0,
  lifetime_value_cents integer NOT NULL DEFAULT 0,
  last_purchase_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.user_segments TO authenticated;
GRANT ALL ON public.user_segments TO service_role;
ALTER TABLE public.user_segments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own segment" ON public.user_segments FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "Admins read all segments" ON public.user_segments FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Recompute a user's segment from their purchase history
CREATE OR REPLACE FUNCTION public.recompute_user_segment(p_user uuid)
RETURNS public.user_segments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count integer;
  v_total integer;
  v_last timestamptz;
  v_account_age interval;
  v_segment text;
  v_p95 integer;
  v_row public.user_segments%ROWTYPE;
BEGIN
  SELECT COUNT(*), COALESCE(SUM(price_cents),0), MAX(created_at)
    INTO v_count, v_total, v_last
    FROM public.user_purchases WHERE user_id = p_user;

  SELECT now() - created_at INTO v_account_age FROM auth.users WHERE id = p_user;

  -- VIP threshold = top-5% spender (95th percentile of LTV among purchasers)
  SELECT COALESCE(
    (SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY total)
     FROM (SELECT SUM(price_cents) AS total FROM public.user_purchases GROUP BY user_id) s),
    0)::integer INTO v_p95;

  IF v_count = 0 AND v_account_age < interval '30 days' THEN
    v_segment := 'new';
  ELSIF v_count >= 3 AND v_total >= GREATEST(v_p95, 1) THEN
    v_segment := 'vip';
  ELSIF v_count >= 3 THEN
    v_segment := 'active';
  ELSIF v_count BETWEEN 1 AND 2 THEN
    v_segment := 'casual';
  ELSE
    v_segment := 'new';
  END IF;

  INSERT INTO public.user_segments(user_id, segment, purchase_count, lifetime_value_cents, last_purchase_at)
  VALUES (p_user, v_segment, v_count, v_total, v_last)
  ON CONFLICT (user_id) DO UPDATE SET
    segment = EXCLUDED.segment,
    purchase_count = EXCLUDED.purchase_count,
    lifetime_value_cents = EXCLUDED.lifetime_value_cents,
    last_purchase_at = EXCLUDED.last_purchase_at,
    updated_at = now()
  RETURNING * INTO v_row;
  RETURN v_row;
END $$;

GRANT EXECUTE ON FUNCTION public.recompute_user_segment(uuid) TO authenticated, service_role;

-- =========================================================
-- SEED TIERS
-- =========================================================
INSERT INTO public.pricing_tiers (code, name, description, sort_order, packs, infinite) VALUES
('A', 'Premium Markets', 'High-income economies (UK, US, CA, AU, NZ, CH, NO, DK, SE, FI, DE, NL)', 1,
  '[
    {"id":"pack_25","credits":25,"bonus":0,"price_cents":249,"label":"Starter"},
    {"id":"pack_50","credits":50,"bonus":10,"price_cents":499,"label":"Boost"},
    {"id":"pack_120","credits":120,"bonus":25,"price_cents":999,"label":"Popular","popular":true},
    {"id":"pack_200","credits":200,"bonus":50,"price_cents":1499,"label":"Power"},
    {"id":"pack_500","credits":500,"bonus":150,"price_cents":2499,"label":"Elite","best_value":true}
  ]'::jsonb,
  '[
    {"id":"infinite_lifetime","period":"lifetime","price_cents":4999,"label":"Lifetime"},
    {"id":"infinite_monthly","period":"month","price_cents":299,"label":"Monthly"},
    {"id":"infinite_yearly","period":"year","price_cents":2499,"label":"Yearly","best_value":true}
  ]'::jsonb),
('B', 'Developed Markets', 'Spain, Italy, Portugal, Greece, Poland, Czech, Japan, Korea', 2,
  '[
    {"id":"pack_25","credits":25,"bonus":0,"price_cents":199,"label":"Starter"},
    {"id":"pack_50","credits":50,"bonus":10,"price_cents":399,"label":"Boost"},
    {"id":"pack_120","credits":120,"bonus":25,"price_cents":799,"label":"Popular","popular":true},
    {"id":"pack_200","credits":200,"bonus":50,"price_cents":1199,"label":"Power"},
    {"id":"pack_500","credits":500,"bonus":150,"price_cents":1999,"label":"Elite","best_value":true}
  ]'::jsonb,
  '[
    {"id":"infinite_lifetime","period":"lifetime","price_cents":3999,"label":"Lifetime"},
    {"id":"infinite_monthly","period":"month","price_cents":249,"label":"Monthly"},
    {"id":"infinite_yearly","period":"year","price_cents":1999,"label":"Yearly","best_value":true}
  ]'::jsonb),
('C', 'Emerging Markets', 'Brazil, Mexico, Turkey, South Africa, Thailand, Malaysia, Indonesia, Colombia', 3,
  '[
    {"id":"pack_25","credits":25,"bonus":0,"price_cents":99,"label":"Starter"},
    {"id":"pack_50","credits":50,"bonus":10,"price_cents":199,"label":"Boost"},
    {"id":"pack_120","credits":120,"bonus":25,"price_cents":499,"label":"Popular","popular":true},
    {"id":"pack_200","credits":200,"bonus":50,"price_cents":799,"label":"Power"},
    {"id":"pack_500","credits":500,"bonus":150,"price_cents":1499,"label":"Elite","best_value":true}
  ]'::jsonb,
  '[
    {"id":"infinite_lifetime","period":"lifetime","price_cents":2499,"label":"Lifetime"},
    {"id":"infinite_monthly","period":"month","price_cents":199,"label":"Monthly"},
    {"id":"infinite_yearly","period":"year","price_cents":1499,"label":"Yearly","best_value":true}
  ]'::jsonb),
('D', 'Growth Markets', 'India, Pakistan, Bangladesh, Nigeria, Kenya, Egypt, Vietnam, Philippines', 4,
  '[
    {"id":"pack_25","credits":25,"bonus":0,"price_cents":49,"label":"Starter"},
    {"id":"pack_50","credits":50,"bonus":10,"price_cents":99,"label":"Boost"},
    {"id":"pack_120","credits":120,"bonus":25,"price_cents":299,"label":"Popular","popular":true},
    {"id":"pack_200","credits":200,"bonus":50,"price_cents":499,"label":"Power"},
    {"id":"pack_500","credits":500,"bonus":150,"price_cents":999,"label":"Elite","best_value":true}
  ]'::jsonb,
  '[
    {"id":"infinite_lifetime","period":"lifetime","price_cents":1499,"label":"Lifetime"},
    {"id":"infinite_monthly","period":"month","price_cents":99,"label":"Monthly"},
    {"id":"infinite_yearly","period":"year","price_cents":999,"label":"Yearly","best_value":true}
  ]'::jsonb);

-- =========================================================
-- SEED COUNTRY MAP
-- =========================================================
INSERT INTO public.country_pricing_map (country_code, country_name, tier_code, currency) VALUES
-- Tier A
('GB','United Kingdom','A','GBP'),
('US','United States','A','USD'),
('CA','Canada','A','CAD'),
('AU','Australia','A','AUD'),
('NZ','New Zealand','A','NZD'),
('CH','Switzerland','A','CHF'),
('NO','Norway','A','NOK'),
('DK','Denmark','A','DKK'),
('SE','Sweden','A','SEK'),
('FI','Finland','A','EUR'),
('DE','Germany','A','EUR'),
('NL','Netherlands','A','EUR'),
-- Tier B
('ES','Spain','B','EUR'),
('IT','Italy','B','EUR'),
('PT','Portugal','B','EUR'),
('GR','Greece','B','EUR'),
('PL','Poland','B','PLN'),
('CZ','Czech Republic','B','CZK'),
('JP','Japan','B','JPY'),
('KR','South Korea','B','KRW'),
-- Tier C
('BR','Brazil','C','BRL'),
('MX','Mexico','C','MXN'),
('TR','Turkey','C','TRY'),
('ZA','South Africa','C','ZAR'),
('TH','Thailand','C','THB'),
('MY','Malaysia','C','MYR'),
('ID','Indonesia','C','IDR'),
('CO','Colombia','C','COP'),
-- Tier D
('IN','India','D','INR'),
('PK','Pakistan','D','PKR'),
('BD','Bangladesh','D','BDT'),
('NG','Nigeria','D','NGN'),
('KE','Kenya','D','KES'),
('EG','Egypt','D','EGP'),
('VN','Vietnam','D','VND'),
('PH','Philippines','D','PHP');
