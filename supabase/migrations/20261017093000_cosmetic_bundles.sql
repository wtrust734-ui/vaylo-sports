-- ============================================================================
-- COSMETIC BUNDLES — honest, all-or-nothing set purchases
-- ----------------------------------------------------------------------------
-- Research finding (§14-D): bundles are the flagship conversion pattern, but
-- buying the pieces one RPC at a time is all-or-nothing-safe only as a single
-- server transaction. This adds a server-configured bundle catalogue:
--
--   * `cosmetic_bundles`      — the set (id, name, one-line description, price)
--   * `cosmetic_bundle_items` — membership, FK'ed to reward_definitions
--   * `purchase_cosmetic_bundle(bundle_id)` — validates activity, sellability,
--     windows and non-ownership for EVERY item, then spends once and grants
--     everything in one transaction. If any item is already owned, it refuses
--     rather than granting a partial set (the honest failure the research
--     called for) and the client steers to single-item purchase.
--
-- Bundle definitions live server-side; the client mirrors them for display in
-- src/lib/cosmeticCatalog.ts. Prices are set here, never trusted from the wire.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.cosmetic_bundles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  coin_cost INTEGER NOT NULL CHECK (coin_cost > 0),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_bundle_updated BEFORE UPDATE ON public.cosmetic_bundles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

GRANT SELECT ON public.cosmetic_bundles TO anon, authenticated;
GRANT ALL ON public.cosmetic_bundles TO service_role;
ALTER TABLE public.cosmetic_bundles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cosmetic_bundles_read" ON public.cosmetic_bundles FOR SELECT USING (true);

CREATE TABLE IF NOT EXISTS public.cosmetic_bundle_items (
  bundle_id TEXT NOT NULL REFERENCES public.cosmetic_bundles(id) ON DELETE CASCADE,
  reward_id TEXT NOT NULL REFERENCES public.reward_definitions(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bundle_id, reward_id)
);
GRANT SELECT ON public.cosmetic_bundle_items TO anon, authenticated;
GRANT ALL ON public.cosmetic_bundle_items TO service_role;
ALTER TABLE public.cosmetic_bundle_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cosmetic_bundle_items_read" ON public.cosmetic_bundle_items FOR SELECT USING (true);

-- ---------------------------------------------------------------------------
-- Seed: three bundles priced against the existing coin ladder (rarity prices:
-- common 150 · rare 400 · epic 900 · legendary 2400).
--   starter_look   150+400+400 = 950  → 500  (47% off — fills an empty profile)
--   champions_look 900×3 = 2700       → 2200 (19% off — the flagship set)
--   glow_set       400+400+2400 = 3200 → 2900
-- ---------------------------------------------------------------------------
INSERT INTO public.cosmetic_bundles (id, name, description, coin_cost) VALUES
  ('starter_look',
   'Starter Look',
   'A title, a border and a backdrop — everything an empty profile needs to stop looking bare.',
   500),
  ('champions_look',
   'Champions Look',
   'Gold everything: the Champion title, the gold border and the summit backdrop.',
   2200),
  ('glow_set',
   'Electric Glow Set',
   'Electric blue name, tap sparks and the animated neon border.',
   2900)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.cosmetic_bundle_items (bundle_id, reward_id, position) VALUES
  ('starter_look', 'title_winner',  1),
  ('starter_look', 'border_silver', 2),
  ('starter_look', 'bg_arena',      3),
  ('champions_look', 'title_champion', 1),
  ('champions_look', 'border_gold',    2),
  ('champions_look', 'bg_summit',      3),
  ('glow_set', 'name_blue',     1),
  ('glow_set', 'fx_click_spark',2),
  ('glow_set', 'border_neon',   3)
ON CONFLICT (bundle_id, reward_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- The bundle purchase RPC.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.purchase_cosmetic_bundle(p_bundle_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_bundle public.cosmetic_bundles%ROWTYPE;
  v_item record;
  v_owned_count integer := 0;
  v_new_coins integer;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_bundle FROM public.cosmetic_bundles WHERE id = p_bundle_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown bundle'; END IF;
  IF NOT v_bundle.active THEN RAISE EXCEPTION 'This bundle is not available'; END IF;

  -- An empty bundle would charge coins and grant nothing: refuse up front.
  IF NOT EXISTS (SELECT 1 FROM public.cosmetic_bundle_items WHERE bundle_id = p_bundle_id) THEN
    RAISE EXCEPTION 'This bundle has no contents';
  END IF;

  -- Validate every item BEFORE spending anything: active, sellable with a
  -- price, inside its season window, and not already owned.
  FOR v_item IN
    SELECT d.* FROM public.cosmetic_bundle_items bi
    JOIN public.reward_definitions d ON d.id = bi.reward_id
    WHERE bi.bundle_id = p_bundle_id
  LOOP
    IF NOT v_item.active THEN
      RAISE EXCEPTION 'This bundle is not available: % is unavailable', v_item.name;
    END IF;
    IF v_item.type NOT IN ('title','border','background','name_color','effect') THEN
      RAISE EXCEPTION 'This bundle contains a non-purchasable item';
    END IF;
    IF v_item.coin_cost IS NULL OR v_item.coin_cost <= 0 THEN
      RAISE EXCEPTION 'This bundle contains an unpriced item';
    END IF;
    IF v_item.available_from IS NOT NULL AND now() < v_item.available_from THEN
      RAISE EXCEPTION 'This bundle is not available yet';
    END IF;
    IF v_item.available_to IS NOT NULL AND now() > v_item.available_to THEN
      RAISE EXCEPTION 'This bundle has ended';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.user_rewards ur
      WHERE ur.user_id = v_user AND ur.reward_id = v_item.id
    ) THEN
      v_owned_count := v_owned_count + 1;
    END IF;
  END LOOP;

  IF v_owned_count > 0 THEN
    RAISE EXCEPTION 'You already own part of this bundle — buy the missing pieces individually';
  END IF;

  -- One spend, one transaction, all grants.
  v_new_coins := public.spend_coins(v_bundle.coin_cost, 'cosmetic-bundle:' || v_bundle.id);

  FOR v_item IN
    SELECT d.* FROM public.cosmetic_bundle_items bi
    JOIN public.reward_definitions d ON d.id = bi.reward_id
    WHERE bi.bundle_id = p_bundle_id
  LOOP
    INSERT INTO public.user_rewards (user_id, reward_id, type, category, rarity, source)
    VALUES (v_user, v_item.id, v_item.type, v_item.category, v_item.rarity, 'coins');
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true, 'bundle', v_bundle.id, 'cost', v_bundle.coin_cost, 'coins', v_new_coins
  );
END; $$;

REVOKE ALL ON FUNCTION public.purchase_cosmetic_bundle(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purchase_cosmetic_bundle(text) TO authenticated;

COMMENT ON FUNCTION public.purchase_cosmetic_bundle(text) IS
  'Buys a cosmetic_bundles set in one transaction: validates availability and non-ownership for every item, spends the server price once, grants the whole set.';
