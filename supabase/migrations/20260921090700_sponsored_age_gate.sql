-- ============================================================================
-- SPONSORED CONTENT — SERVER-ENFORCED 18+ GATE
-- ----------------------------------------------------------------------------
-- VAYLO's athletes span roughly 12–30, so sponsored content must never reach a
-- minor. The rule is enforced HERE, in the database, not in the client: a client
-- check can be bypassed from a browser console or a raw API call, and this is
-- the one area where that mistake has legal consequences (UK AADC / GDPR-K,
-- COPPA, and both stores' rules on advertising to children).
--
-- The gate is `public.viewer_is_adult()`, which derives adult status from the
-- athlete's own `profiles.date_of_birth` at read time. It is deliberately NOT a
-- stored boolean:
--   * nothing to go stale — an athlete starts seeing sponsored content on their
--     18th birthday, not 18 years after some flag was written,
--   * nothing for a client to write — there is no column to flip,
--   * no date of birth (the default for every existing athlete) means NOT an
--     adult, which is the safe way round.
--
-- Nothing in `brands` is readable by an athlete: it holds contracted prices and
-- internal notes. Sponsors are only ever surfaced through `sponsored_placements()`,
-- which returns a whitelisted set of fields and an empty result for minors.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. The gate
-- ---------------------------------------------------------------------------

-- STABLE, not IMMUTABLE: the answer depends on today's date (an athlete becomes
-- an adult on their birthday without any row changing).
CREATE OR REPLACE FUNCTION public.is_adult_birthdate(p_dob date)
RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT p_dob IS NOT NULL AND p_dob <= (CURRENT_DATE - INTERVAL '18 years')
$$;

COMMENT ON FUNCTION public.is_adult_birthdate(date) IS
  'True when a date of birth is at least 18 years before the statement date.';

/**
 * Is the *current* viewer an adult? Reads the athlete's own profile only —
 * there is no user_id argument, so it cannot be used to check anyone else.
 */
CREATE OR REPLACE FUNCTION public.viewer_is_adult()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((
    SELECT public.is_adult_birthdate(date_of_birth)
    FROM public.profiles
    WHERE user_id = auth.uid()
  ), false)
$$;

REVOKE ALL ON FUNCTION public.viewer_is_adult() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.viewer_is_adult() TO authenticated;

COMMENT ON FUNCTION public.viewer_is_adult() IS
  'Server-side age gate for sponsored content. Derived from profiles.date_of_birth; NULL/unknown means not an adult.';


-- ---------------------------------------------------------------------------
-- 2. Brands and placements (service-role only)
-- ---------------------------------------------------------------------------
-- `status` and the contract columns are commercial data. They are never granted
-- to anon/authenticated, so no client role can read them even by guessing rows.

CREATE TABLE IF NOT EXISTS public.brands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  logo_url text,
  website text,
  contact_email text,
  status text NOT NULL DEFAULT 'prospect',   -- prospect | active | paused | ended
  -- Contracted price lives here for YOUR invoicing. It is deliberately NOT part
  -- of the app's money model (src/config/*, moneyCatalog) — see SPONSORSHIP.md.
  contract_price_cents integer,
  contract_currency text NOT NULL DEFAULT 'GBP',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.brand_placements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  placement text NOT NULL,                   -- challenge | ai_slot | learning | post_session
  headline text NOT NULL,
  body text,
  cta_label text,
  cta_url text,
  sports text[] NOT NULL DEFAULT '{}',       -- empty = all sports
  regions text[] NOT NULL DEFAULT '{}',      -- empty = all regions
  min_age integer NOT NULL DEFAULT 18,       -- never below 18: the whole surface is adult-only
  starts_at timestamptz,
  ends_at timestamptz,
  weight integer NOT NULL DEFAULT 1,
  active boolean NOT NULL DEFAULT true,
  disclosure_label text NOT NULL DEFAULT 'Sponsored',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT brand_placements_min_age_adult CHECK (min_age >= 18)
);

CREATE INDEX IF NOT EXISTS idx_brand_placements_lookup
  ON public.brand_placements (placement, active) WHERE active;

ALTER TABLE public.brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_placements ENABLE ROW LEVEL SECURITY;

-- No client role gets anything, not even SELECT: RLS with no policy denies all,
-- and the grants below make that explicit. Manage rows with the service role
-- (Supabase Studio, or an admin edge function) — see SPONSORSHIP.md.
REVOKE ALL ON public.brands FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.brand_placements FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.brands TO service_role;
GRANT ALL ON public.brand_placements TO service_role;


-- ---------------------------------------------------------------------------
-- 3. Aggregate delivery metrics (never per-athlete ad profiles)
-- ---------------------------------------------------------------------------
-- One row per placement, day and event kind. No user_id: you can report reach
-- to a brand without building a behavioural profile of a 15-year-old, and no
-- brand ever receives athlete-level data.

CREATE TABLE IF NOT EXISTS public.brand_metrics (
  placement_id uuid NOT NULL REFERENCES public.brand_placements(id) ON DELETE CASCADE,
  day date NOT NULL DEFAULT CURRENT_DATE,
  kind text NOT NULL,                        -- impression | click
  count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (placement_id, day, kind)
);

ALTER TABLE public.brand_metrics ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.brand_metrics FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.brand_metrics TO service_role;


-- ---------------------------------------------------------------------------
-- 4. Read path — the only way a client can see a sponsor
-- ---------------------------------------------------------------------------

/**
 * Active sponsors for a surface, for an adult viewer only.
 * Returns an empty set for minors, for unknown placement names, and when the
 * window has expired — so "no sponsored content" is the default, not the
 * exception. Only non-commercial fields are exposed.
 */
CREATE OR REPLACE FUNCTION public.sponsored_placements(
  p_placement text,
  p_sport text DEFAULT NULL
)
RETURNS TABLE (
  placement_id uuid,
  brand_name text,
  brand_slug text,
  brand_logo_url text,
  brand_website text,
  headline text,
  body text,
  cta_label text,
  cta_url text,
  disclosure_label text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;

  -- The gate. A minor gets nothing back, from any client, any way.
  IF NOT public.viewer_is_adult() THEN RETURN; END IF;

  IF p_placement IS NULL
     OR p_placement NOT IN ('challenge', 'ai_slot', 'learning', 'post_session') THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT pl.id, b.name, b.slug, b.logo_url, b.website,
         pl.headline, pl.body, pl.cta_label, pl.cta_url, pl.disclosure_label
  FROM public.brand_placements pl
  JOIN public.brands b ON b.id = pl.brand_id
  WHERE pl.placement = p_placement
    AND pl.active
    AND b.status = 'active'
    AND (pl.starts_at IS NULL OR pl.starts_at <= now())
    AND (pl.ends_at IS NULL OR pl.ends_at > now())
    AND (cardinality(pl.sports) = 0 OR p_sport IS NULL OR p_sport = ANY (pl.sports))
  ORDER BY pl.weight DESC, pl.created_at DESC
  LIMIT 5;
END $$;

REVOKE ALL ON FUNCTION public.sponsored_placements(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sponsored_placements(text, text) TO authenticated;

COMMENT ON FUNCTION public.sponsored_placements(text, text) IS
  'Active sponsors for a surface. Adult viewers only; returns nothing for minors or expired/unknown placements.';

/**
 * Counts an impression or click. Adult viewers only, whitelisted kinds, and it
 * only records against a placement that is currently servable — so it cannot be
 * used to inflate a brand report from a crafted request.
 */
CREATE OR REPLACE FUNCTION public.record_brand_event(p_placement_id uuid, p_kind text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('impression', 'click') THEN RETURN false; END IF;
  IF NOT public.viewer_is_adult() THEN RETURN false; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.brand_placements pl
    JOIN public.brands b ON b.id = pl.brand_id
    WHERE pl.id = p_placement_id AND pl.active AND b.status = 'active'
      AND (pl.starts_at IS NULL OR pl.starts_at <= now())
      AND (pl.ends_at IS NULL OR pl.ends_at > now())
  ) THEN
    RETURN false;
  END IF;

  INSERT INTO public.brand_metrics (placement_id, day, kind, count)
  VALUES (p_placement_id, CURRENT_DATE, p_kind, 1)
  ON CONFLICT (placement_id, day, kind)
    DO UPDATE SET count = public.brand_metrics.count + 1;

  RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.record_brand_event(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_brand_event(uuid, text) TO authenticated;


-- ---------------------------------------------------------------------------
-- 5. Sponsored challenges
-- ---------------------------------------------------------------------------
-- A brand challenge is an existing challenge with a sponsor attached, so the
-- athlete-facing shape does not change. `sponsor_name` is denormalised for
-- display; the underlying placement rules stay in the two functions above.

ALTER TABLE public.challenges
  ADD COLUMN IF NOT EXISTS sponsor_brand_id uuid REFERENCES public.brands(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sponsor_name text,
  ADD COLUMN IF NOT EXISTS sponsor_disclosure text;

COMMENT ON COLUMN public.challenges.sponsor_name IS
  'Display name of the sponsoring brand. Set only for brand challenges.';

-- Under-18s must not see sponsored challenges at all — including the challenge
-- copy and any brand marks. Non-sponsored challenges are unaffected.
DROP POLICY IF EXISTS "Anyone can view challenges" ON public.challenges;
CREATE POLICY "View challenges (sponsored only for adults)"
  ON public.challenges FOR SELECT TO authenticated
  USING (sponsor_brand_id IS NULL OR public.viewer_is_adult());
