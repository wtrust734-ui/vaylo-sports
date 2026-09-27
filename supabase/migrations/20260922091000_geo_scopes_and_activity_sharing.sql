-- ============================================================================
-- VAYLO SPORTS — geo leaderboards + explicit activity sharing
-- ----------------------------------------------------------------------------
-- Two product changes that both needed schema work:
--
-- 1. Country rankings. The geo leaderboard scope was removed because no client
--    could read another athlete's country. `user_region` already exists for
--    exactly this (country + currency per athlete) but had never been written
--    to, and its only policy was self-only. Country is now publicly readable —
--    and ONLY country: `currency` is the athlete's price tier, so the SELECT
--    privilege is narrowed to (user_id, country) at the column level rather
--    than opening the whole row.
--
-- 2. Activity sharing. The feed used to aggregate `workouts`, `achievements`
--    and `outcome_goals` across a friendship graph. All three are self-read-only
--    under RLS, so it only ever showed the signed-in athlete their own rows —
--    and loosening RLS to make friends' training visible would have exposed
--    private health data. Sharing is now an explicit per-activity act:
--    `shared_activities` holds exactly the rows an athlete chose to publish.
--
-- Also fixes hype: counts lived in localStorage, so every athlete saw their own
-- numbers and a shared post's count was meaningless. `activity_hypes` makes it real.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Athlete country, publicly readable
-- ---------------------------------------------------------------------------

-- Normalise the country to an ISO alpha-2 code so the client can map it to a
-- continent deterministically.
ALTER TABLE public.user_region
  ADD CONSTRAINT user_region_country_code CHECK (country ~ '^[A-Z]{2}$');

-- Everyone signed in may see which country an athlete represents, which is what
-- a country/continental ranking requires.
CREATE POLICY "Countries are publicly readable"
  ON public.user_region FOR SELECT TO authenticated USING (true);

-- ...but only the two columns that ranking needs. `currency` (the athlete's
-- price tier) and the detection timestamps stay private. The athlete can still
-- INSERT/UPDATE their own row through the existing self-only ALL policy.
REVOKE SELECT ON public.user_region FROM authenticated;
GRANT SELECT (user_id, country) ON public.user_region TO authenticated;


-- ---------------------------------------------------------------------------
-- 2. Explicit activity sharing
-- ---------------------------------------------------------------------------

CREATE TABLE public.shared_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_kind text NOT NULL
    CHECK (source_kind IN ('workout', 'achievement', 'goal', 'personal_best', 'note')),
  -- The row being shared, when the share refers to something the athlete owns.
  -- Kept as text so a non-uuid source key can never break the insert.
  source_id text,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 140),
  detail text CHECK (detail IS NULL OR char_length(detail) <= 280),
  sport text,
  shared_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.shared_activities IS
  'Activities an athlete explicitly chose to publish. Reading private training tables cross-user is deliberately not possible; this table is the only public activity surface.';

-- Re-sharing the same workout is idempotent instead of creating duplicates.
CREATE UNIQUE INDEX shared_activities_one_share_per_source
  ON public.shared_activities (user_id, source_kind, source_id)
  WHERE source_id IS NOT NULL;

-- The feed reads newest-first across all athletes.
CREATE INDEX shared_activities_shared_at_idx
  ON public.shared_activities (shared_at DESC);

CREATE INDEX shared_activities_user_idx
  ON public.shared_activities (user_id, shared_at DESC);

ALTER TABLE public.shared_activities ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shared_activities TO authenticated;
GRANT ALL ON public.shared_activities TO service_role;

CREATE POLICY "Shared activities are viewable by everyone"
  ON public.shared_activities FOR SELECT TO authenticated USING (true);
CREATE POLICY "Athletes share their own activity"
  ON public.shared_activities FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Athletes edit their own share"
  ON public.shared_activities FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Athletes unshare their own activity"
  ON public.shared_activities FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER update_shared_activities_updated_at
  BEFORE UPDATE ON public.shared_activities
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- ---------------------------------------------------------------------------
-- 3. Hype, persisted
-- ---------------------------------------------------------------------------

CREATE TABLE public.activity_hypes (
  activity_id uuid NOT NULL REFERENCES public.shared_activities(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (activity_id, user_id)
);

-- Counting a post's hype is a public read; the primary key makes one hype per
-- athlete per activity structurally impossible to duplicate.
CREATE INDEX activity_hypes_activity_idx ON public.activity_hypes (activity_id);

ALTER TABLE public.activity_hypes ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, DELETE ON public.activity_hypes TO authenticated;
GRANT ALL ON public.activity_hypes TO service_role;

CREATE POLICY "Hypes are viewable by everyone"
  ON public.activity_hypes FOR SELECT TO authenticated USING (true);
CREATE POLICY "Athletes add their own hype"
  ON public.activity_hypes FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Athletes remove their own hype"
  ON public.activity_hypes FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Hype is a reaction from someone else; a self-hype would inflate a count that
-- the feed presents as social proof.
CREATE OR REPLACE FUNCTION public.block_self_hype()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.shared_activities
    WHERE id = NEW.activity_id AND user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'You cannot hype your own activity';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER activity_hypes_prevent_self_hype
  BEFORE INSERT ON public.activity_hypes
  FOR EACH ROW EXECUTE FUNCTION public.block_self_hype();
