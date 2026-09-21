-- Catalog of Event Packs (admin managed; also used to override built-in packs)
CREATE TABLE public.event_packs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  pack_id text NOT NULL UNIQUE,
  name text NOT NULL,
  sport text NOT NULL,
  category text NOT NULL DEFAULT 'General',
  target_event text,
  description text,
  weeks integer NOT NULL DEFAULT 8,
  price_cents integer NOT NULL DEFAULT 1999,
  difficulty text NOT NULL DEFAULT 'Intermediate',
  designed_for text,
  includes text[] NOT NULL DEFAULT ARRAY[]::text[],
  version text NOT NULL DEFAULT '1.0',
  future_updates_included boolean NOT NULL DEFAULT true,
  featured boolean NOT NULL DEFAULT false,
  sections text[] NOT NULL DEFAULT ARRAY[]::text[],
  popularity integer NOT NULL DEFAULT 0,
  retired boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.event_packs TO anon;
GRANT SELECT ON public.event_packs TO authenticated;
GRANT ALL ON public.event_packs TO service_role;

ALTER TABLE public.event_packs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Event packs are publicly viewable"
  ON public.event_packs FOR SELECT USING (true);

CREATE POLICY "Admins manage event packs"
  ON public.event_packs FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_event_packs_updated
  BEFORE UPDATE ON public.event_packs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_event_packs_sport ON public.event_packs (sport);
CREATE INDEX idx_event_packs_featured ON public.event_packs (featured) WHERE featured;

-- Permanent (lifetime) ownership of packs
CREATE TABLE public.event_pack_ownership (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  pack_id text NOT NULL,
  pack_name text,
  sport text,
  price_cents integer NOT NULL DEFAULT 0,
  version_at_purchase text,
  source text NOT NULL DEFAULT 'app',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, pack_id)
);

GRANT SELECT, INSERT ON public.event_pack_ownership TO authenticated;
GRANT ALL ON public.event_pack_ownership TO service_role;

ALTER TABLE public.event_pack_ownership ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view their own event pack ownership"
  ON public.event_pack_ownership FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users record their own event pack ownership"
  ON public.event_pack_ownership FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_event_pack_ownership_user ON public.event_pack_ownership (user_id);

-- Records a purchase; duplicate purchases are ignored (ownership is permanent)
CREATE OR REPLACE FUNCTION public.claim_event_pack(
  p_pack_id text,
  p_pack_name text DEFAULT NULL,
  p_sport text DEFAULT NULL,
  p_price_cents integer DEFAULT 0,
  p_version text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_user uuid := auth.uid(); v_existing uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_pack_id IS NULL OR length(p_pack_id) = 0 THEN RAISE EXCEPTION 'Missing pack'; END IF;

  SELECT id INTO v_existing FROM public.event_pack_ownership
    WHERE user_id = v_user AND pack_id = p_pack_id;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'pack_id', p_pack_id);
  END IF;

  INSERT INTO public.event_pack_ownership (user_id, pack_id, pack_name, sport, price_cents, version_at_purchase)
  VALUES (v_user, p_pack_id, p_pack_name, p_sport, GREATEST(COALESCE(p_price_cents,0),0), p_version);

  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'pack_id', p_pack_id);
END $$;